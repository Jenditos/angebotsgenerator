import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  APPOINTMENT_STATUS_VALUES,
  APPOINTMENT_TYPE_VALUES,
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
  DocumentType,
  StoredAppointmentRecord,
} from "@/types/offer";
import {
  ensureRuntimeDataDirReady,
  resolveRuntimeDataDir,
} from "@/server/services/store-runtime-paths";

type AppointmentStore = {
  lastAppointmentSequence: number;
  appointments: StoredAppointmentRecord[];
};

type AppointmentStorePaths = {
  dataDir: string;
  storePath: string;
  lockPath: string;
};

export type UpsertStoredAppointmentInput = {
  userId: string;
  appointmentNumber?: string;
  title: string;
  type?: AppointmentType;
  status?: AppointmentStatus;
  startAt: string;
  endAt: string;
  customerNumber?: string;
  projectNumber?: string;
  customerName?: string;
  projectName?: string;
  documentNumber?: string;
  documentType?: DocumentType;
  address?: string;
  note?: string;
  reminderEnabled?: boolean;
  reminderMinutesBefore?: number;
  source?: AppointmentSource;
  referenceDate?: Date;
};

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_INTERVAL_MS = 30;
const STALE_LOCK_AFTER_MS = 15_000;
const APPOINTMENT_NUMBER_PATTERN = /^TER-(\d{6,})$/;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isOwnedByUser(
  recordUserId: unknown,
  userId: string,
  includeLegacyUnscoped: boolean,
): boolean {
  const normalizedUserId = normalizeUserId(recordUserId);
  if (normalizedUserId) {
    return normalizedUserId === userId;
  }

  return includeLegacyUnscoped;
}

function parseAppointmentNumber(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }

  const match = value.trim().toUpperCase().match(APPOINTMENT_NUMBER_PATTERN);
  if (!match) {
    return 0;
  }

  const sequence = Number(match[1]);
  return Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 0;
}

function formatAppointmentNumber(sequence: number): string {
  return `TER-${String(sequence).padStart(6, "0")}`;
}

function sanitizeAppointmentType(value: unknown): AppointmentType {
  return APPOINTMENT_TYPE_VALUES.includes(value as AppointmentType)
    ? (value as AppointmentType)
    : "site_visit";
}

function sanitizeAppointmentStatus(value: unknown): AppointmentStatus {
  return APPOINTMENT_STATUS_VALUES.includes(value as AppointmentStatus)
    ? (value as AppointmentStatus)
    : "planned";
}

function sanitizeAppointmentSource(value: unknown): AppointmentSource {
  return value === "voice" || value === "text" ? value : "manual";
}

function sanitizeDocumentType(value: unknown): DocumentType | undefined {
  return value === "offer" || value === "invoice" ? value : undefined;
}

function sanitizeReminderMinutes(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.min(10_080, Math.max(5, Math.floor(parsed)));
}

function normalizeIsoDate(value: unknown): string {
  const rawValue = asTrimmedString(value);
  if (!rawValue) {
    return "";
  }

  const timestamp = Date.parse(rawValue);
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Date(timestamp).toISOString();
}

function sanitizeAppointmentRecord(value: unknown): StoredAppointmentRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<StoredAppointmentRecord>;
  const sequence = parseAppointmentNumber(record.appointmentNumber);
  const title = asTrimmedString(record.title);
  const startAt = normalizeIsoDate(record.startAt);
  const endAt = normalizeIsoDate(record.endAt);
  const createdAt =
    normalizeIsoDate(record.createdAt) ||
    normalizeIsoDate(record.updatedAt) ||
    new Date().toISOString();
  const updatedAt = normalizeIsoDate(record.updatedAt) || createdAt;

  if (!sequence || !title || !startAt || !endAt) {
    return null;
  }

  return {
    userId: normalizeUserId(record.userId) || undefined,
    appointmentNumber: formatAppointmentNumber(sequence),
    title,
    type: sanitizeAppointmentType(record.type),
    status: sanitizeAppointmentStatus(record.status),
    startAt,
    endAt,
    customerNumber: asTrimmedString(record.customerNumber) || undefined,
    projectNumber: asTrimmedString(record.projectNumber) || undefined,
    customerName: asTrimmedString(record.customerName),
    projectName: asTrimmedString(record.projectName) || undefined,
    documentNumber: asTrimmedString(record.documentNumber) || undefined,
    documentType: sanitizeDocumentType(record.documentType),
    address: asTrimmedString(record.address) || undefined,
    note: asTrimmedString(record.note) || undefined,
    reminderEnabled: record.reminderEnabled === true,
    reminderMinutesBefore: sanitizeReminderMinutes(record.reminderMinutesBefore),
    source: sanitizeAppointmentSource(record.source),
    createdAt,
    updatedAt,
  };
}

function sanitizeStore(payload: unknown): AppointmentStore {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { lastAppointmentSequence: 0, appointments: [] };
  }

  const parsed = payload as Partial<AppointmentStore> & {
    lastAppointmentSequence?: unknown;
  };
  const appointments = Array.isArray(parsed.appointments)
    ? parsed.appointments
        .map((entry) => sanitizeAppointmentRecord(entry))
        .filter((entry): entry is StoredAppointmentRecord => Boolean(entry))
    : [];
  const highestSequence = appointments.reduce(
    (highest, appointment) =>
      Math.max(highest, parseAppointmentNumber(appointment.appointmentNumber)),
    0,
  );
  const parsedSequence = Number(parsed.lastAppointmentSequence);
  const sanitizedSequence =
    Number.isFinite(parsedSequence) && parsedSequence > 0
      ? Math.floor(parsedSequence)
      : 0;

  return {
    lastAppointmentSequence: Math.max(highestSequence, sanitizedSequence),
    appointments,
  };
}

function resolvePaths(
  overrides?: Partial<AppointmentStorePaths>,
): AppointmentStorePaths {
  const dataDir = overrides?.dataDir ?? resolveRuntimeDataDir();
  return {
    dataDir,
    storePath:
      overrides?.storePath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "appointments-store.json"),
    lockPath:
      overrides?.lockPath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "appointments-store.lock"),
  };
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT";
}

async function ensureRuntimeDataDirIfNeeded(
  overrides?: Partial<AppointmentStorePaths>,
): Promise<void> {
  if (!overrides?.dataDir) {
    await ensureRuntimeDataDirReady();
  }
}

async function readStoreWithDataLossProtection(
  storePath: string,
): Promise<AppointmentStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    return sanitizeStore(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) {
      return { lastAppointmentSequence: 0, appointments: [] };
    }

    throw new Error(
      `Termin-Store konnte nicht gelesen werden. Schreibvorgang zum Schutz bestehender Daten abgebrochen: ${storePath}`,
      { cause: error },
    );
  }
}

async function writeStoreUnsafe(
  storePath: string,
  payload: AppointmentStore,
): Promise<void> {
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, storePath);
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const lockStats = await stat(lockPath);
    return Date.now() - lockStats.mtimeMs > STALE_LOCK_AFTER_MS;
  } catch {
    return false;
  }
}

async function acquireStoreLock(lockPath: string): Promise<() => Promise<void>> {
  const timeoutAt = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}:${Date.now()}`);

      return async () => {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";

      if (code !== "EEXIST") {
        throw error;
      }

      if (await isLockStale(lockPath)) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }

      if (Date.now() >= timeoutAt) {
        throw new Error("Could not acquire appointment store lock in time.");
      }

      await delay(LOCK_POLL_INTERVAL_MS);
    }
  }
}

export async function listStoredAppointments(
  userId: string,
  overrides?: Partial<AppointmentStorePaths>,
): Promise<StoredAppointmentRecord[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return [];
  }

  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });
  const store = await readStoreWithDataLossProtection(paths.storePath);
  const includeLegacyUnscoped = process.env.NODE_ENV !== "production";

  return store.appointments
    .filter((appointment) =>
      isOwnedByUser(appointment.userId, normalizedUserId, includeLegacyUnscoped),
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.startAt);
      const rightTime = Date.parse(right.startAt);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        return leftTime - rightTime;
      }

      return left.appointmentNumber.localeCompare(right.appointmentNumber);
    });
}

export async function upsertStoredAppointment(
  input: UpsertStoredAppointmentInput,
  overrides?: Partial<AppointmentStorePaths>,
): Promise<StoredAppointmentRecord> {
  const normalizedUserId = input.userId.trim();
  if (!normalizedUserId) {
    throw new Error("User-ID fuer Termin-Speicherung fehlt.");
  }

  const title = asTrimmedString(input.title);
  const startAt = normalizeIsoDate(input.startAt);
  const endAt = normalizeIsoDate(input.endAt);
  if (!title || !startAt || !endAt) {
    throw new Error("Termin ist unvollstaendig.");
  }

  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });
  const releaseLock = await acquireStoreLock(paths.lockPath);

  try {
    const nowIso = (input.referenceDate ?? new Date()).toISOString();
    const store = await readStoreWithDataLossProtection(paths.storePath);
    const includeLegacyUnscoped = process.env.NODE_ENV !== "production";
    const requestedSequence = parseAppointmentNumber(input.appointmentNumber);
    const requestedNumber =
      requestedSequence > 0 ? formatAppointmentNumber(requestedSequence) : "";
    const existingIndex = requestedNumber
      ? store.appointments.findIndex(
          (appointment) =>
            appointment.appointmentNumber === requestedNumber &&
            isOwnedByUser(
              appointment.userId,
              normalizedUserId,
              includeLegacyUnscoped,
            ),
        )
      : -1;

    if (existingIndex >= 0) {
      const existing = store.appointments[existingIndex];
      const updated: StoredAppointmentRecord = {
        ...existing,
        userId: normalizedUserId,
        title,
        type: sanitizeAppointmentType(input.type),
        status: sanitizeAppointmentStatus(input.status ?? existing.status),
        startAt,
        endAt,
        customerNumber:
          asTrimmedString(input.customerNumber) || existing.customerNumber,
        projectNumber:
          asTrimmedString(input.projectNumber) || existing.projectNumber,
        customerName: asTrimmedString(input.customerName),
        projectName: asTrimmedString(input.projectName) || undefined,
        documentNumber: asTrimmedString(input.documentNumber) || undefined,
        documentType: sanitizeDocumentType(input.documentType),
        address: asTrimmedString(input.address) || undefined,
        note: asTrimmedString(input.note) || undefined,
        reminderEnabled: input.reminderEnabled === true,
        reminderMinutesBefore: sanitizeReminderMinutes(
          input.reminderMinutesBefore,
        ),
        source: sanitizeAppointmentSource(input.source),
        updatedAt: nowIso,
      };
      const appointments = [...store.appointments];
      appointments[existingIndex] = updated;
      await writeStoreUnsafe(paths.storePath, { ...store, appointments });
      return updated;
    }

    const nextSequence = store.lastAppointmentSequence + 1;
    const created: StoredAppointmentRecord = {
      userId: normalizedUserId,
      appointmentNumber: formatAppointmentNumber(nextSequence),
      title,
      type: sanitizeAppointmentType(input.type),
      status: sanitizeAppointmentStatus(input.status),
      startAt,
      endAt,
      customerNumber: asTrimmedString(input.customerNumber) || undefined,
      projectNumber: asTrimmedString(input.projectNumber) || undefined,
      customerName: asTrimmedString(input.customerName),
      projectName: asTrimmedString(input.projectName) || undefined,
      documentNumber: asTrimmedString(input.documentNumber) || undefined,
      documentType: sanitizeDocumentType(input.documentType),
      address: asTrimmedString(input.address) || undefined,
      note: asTrimmedString(input.note) || undefined,
      reminderEnabled: input.reminderEnabled === true,
      reminderMinutesBefore: sanitizeReminderMinutes(input.reminderMinutesBefore),
      source: sanitizeAppointmentSource(input.source),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await writeStoreUnsafe(paths.storePath, {
      lastAppointmentSequence: nextSequence,
      appointments: [...store.appointments, created],
    });
    return created;
  } finally {
    await releaseLock();
  }
}

export async function removeStoredAppointment(
  userId: string,
  appointmentNumber: string,
  overrides?: Partial<AppointmentStorePaths>,
): Promise<boolean> {
  const normalizedUserId = userId.trim();
  const normalizedSequence = parseAppointmentNumber(appointmentNumber);
  if (!normalizedUserId || !normalizedSequence) {
    return false;
  }

  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });
  const releaseLock = await acquireStoreLock(paths.lockPath);

  try {
    const normalizedNumber = formatAppointmentNumber(normalizedSequence);
    const store = await readStoreWithDataLossProtection(paths.storePath);
    const includeLegacyUnscoped = process.env.NODE_ENV !== "production";
    const nextAppointments = store.appointments.filter(
      (appointment) =>
        appointment.appointmentNumber !== normalizedNumber ||
        !isOwnedByUser(
          appointment.userId,
          normalizedUserId,
          includeLegacyUnscoped,
        ),
    );
    if (nextAppointments.length === store.appointments.length) {
      return false;
    }

    await writeStoreUnsafe(paths.storePath, {
      ...store,
      appointments: nextAppointments,
    });
    return true;
  } finally {
    await releaseLock();
  }
}
