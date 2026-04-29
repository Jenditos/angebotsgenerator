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
  CustomerDraftGroup,
  CustomerDraftState,
  CustomerDraftSubitem,
  PROJECT_STATUS_VALUES,
  ProjectStatus,
  StoredProjectRecord,
} from "@/types/offer";
import {
  ensureRuntimeDataDirReady,
  resolveRuntimeDataDir,
} from "@/server/services/store-runtime-paths";

type ProjectStore = {
  lastProjectSequence: number;
  projects: StoredProjectRecord[];
};

type ProjectStorePaths = {
  dataDir: string;
  storePath: string;
  lockPath: string;
};

export type UpsertStoredProjectInput = {
  projectNumber?: string;
  customerNumber?: string;
  customerType: "person" | "company";
  companyName?: string;
  salutation?: "herr" | "frau";
  firstName?: string;
  lastName?: string;
  street: string;
  postalCode: string;
  city: string;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  projectName: string;
  projectAddress?: string;
  status?: ProjectStatus;
  note?: string;
  draftState?: unknown;
  referenceDate?: Date;
};

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_INTERVAL_MS = 30;
const STALE_LOCK_AFTER_MS = 15_000;
const PROJECT_NUMBER_PATTERN = /^PRJ-(\d{6,})$/;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTextForComparison(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatProjectNumber(sequence: number): string {
  return `PRJ-${String(sequence).padStart(6, "0")}`;
}

function parseProjectNumber(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }

  const match = value.trim().toUpperCase().match(PROJECT_NUMBER_PATTERN);
  if (!match) {
    return 0;
  }

  const sequence = Number(match[1]);
  return Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 0;
}

function parseProjectSequence(value: unknown): number {
  const fromPattern = parseProjectNumber(value);
  if (fromPattern > 0) {
    return fromPattern;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function sanitizeProjectStatus(value: unknown): ProjectStatus {
  return PROJECT_STATUS_VALUES.includes(value as ProjectStatus)
    ? (value as ProjectStatus)
    : "new";
}

function sanitizeCustomerDraftSubitem(
  value: unknown,
): CustomerDraftSubitem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<CustomerDraftSubitem>;
  const description = asTrimmedString(record.description);
  const quantity = asTrimmedString(record.quantity);
  const unit = asTrimmedString(record.unit);
  const price = asTrimmedString(record.price);

  if (!description && !quantity && !price) {
    return null;
  }

  return {
    description,
    quantity,
    unit,
    price,
  };
}

function sanitizeCustomerDraftGroup(
  value: unknown,
): CustomerDraftGroup | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<CustomerDraftGroup>;
  const label = asTrimmedString(record.label);
  const subitems = Array.isArray(record.subitems)
    ? record.subitems
        .map((entry) => sanitizeCustomerDraftSubitem(entry))
        .filter((entry): entry is CustomerDraftSubitem => Boolean(entry))
    : [];

  if (!label && subitems.length === 0) {
    return null;
  }

  return {
    label,
    subitems,
  };
}

function sanitizeCustomerDraftState(value: unknown): CustomerDraftState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Partial<CustomerDraftState>;
  const positions = Array.isArray(record.positions)
    ? record.positions
        .map((entry) => sanitizeCustomerDraftGroup(entry))
        .filter((entry): entry is CustomerDraftGroup => Boolean(entry))
    : [];

  return {
    serviceDescription: asTrimmedString(record.serviceDescription),
    hours: asTrimmedString(record.hours),
    hourlyRate: asTrimmedString(record.hourlyRate),
    materialCost: asTrimmedString(record.materialCost),
    invoiceDate: asTrimmedString(record.invoiceDate),
    serviceDate: asTrimmedString(record.serviceDate),
    paymentDueDays: asTrimmedString(record.paymentDueDays),
    positions,
  };
}

function sanitizeProjectRecord(value: unknown): StoredProjectRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<StoredProjectRecord>;
  const sequence = parseProjectSequence(record.projectNumber);
  if (!sequence) {
    return null;
  }

  const customerName = asTrimmedString(record.customerName);
  const customerAddress = asTrimmedString(record.customerAddress);
  const customerEmail = asTrimmedString(record.customerEmail);
  const projectName = asTrimmedString(record.projectName);
  const projectAddress =
    asTrimmedString(record.projectAddress) || customerAddress;
  const createdAtRaw = asTrimmedString(record.createdAt);
  const updatedAtRaw = asTrimmedString(record.updatedAt);
  const resolvedCreatedAt =
    createdAtRaw || updatedAtRaw || new Date().toISOString();
  const resolvedUpdatedAt = updatedAtRaw || resolvedCreatedAt;

  if (!projectName) {
    return null;
  }

  return {
    projectNumber: formatProjectNumber(sequence),
    customerNumber:
      typeof record.customerNumber === "string" &&
      record.customerNumber.trim().length > 0
        ? record.customerNumber.trim()
        : undefined,
    customerType: record.customerType === "person" ? "person" : "company",
    companyName: asTrimmedString(record.companyName),
    salutation: record.salutation === "frau" ? "frau" : "herr",
    firstName: asTrimmedString(record.firstName),
    lastName: asTrimmedString(record.lastName),
    street: asTrimmedString(record.street),
    postalCode: asTrimmedString(record.postalCode),
    city: asTrimmedString(record.city),
    customerName,
    customerAddress,
    customerEmail,
    projectName,
    projectAddress,
    status: sanitizeProjectStatus(record.status),
    note: asTrimmedString(record.note),
    draftState: sanitizeCustomerDraftState(record.draftState),
    createdAt: resolvedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };
}

function sanitizeStore(payload: unknown): ProjectStore {
  if (!payload || typeof payload !== "object") {
    return { lastProjectSequence: 0, projects: [] };
  }

  const parsed = payload as Partial<ProjectStore> & {
    lastProjectSequence?: unknown;
  };

  const projects = Array.isArray(parsed.projects)
    ? parsed.projects
        .map((entry) => sanitizeProjectRecord(entry))
        .filter((entry): entry is StoredProjectRecord => Boolean(entry))
    : [];

  const highestSequence = projects.reduce(
    (highest, project) =>
      Math.max(highest, parseProjectNumber(project.projectNumber)),
    0,
  );

  const parsedSequence = Number(parsed.lastProjectSequence);
  const sanitizedSequence =
    Number.isFinite(parsedSequence) && parsedSequence > 0
      ? Math.floor(parsedSequence)
      : 0;

  return {
    lastProjectSequence: Math.max(highestSequence, sanitizedSequence),
    projects,
  };
}

function resolvePaths(overrides?: Partial<ProjectStorePaths>): ProjectStorePaths {
  const dataDir = overrides?.dataDir ?? resolveRuntimeDataDir();
  return {
    dataDir,
    storePath:
      overrides?.storePath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "projects-store.json"),
    lockPath:
      overrides?.lockPath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "projects-store.lock"),
  };
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT";
}

async function readStoreUnsafe(storePath: string): Promise<ProjectStore> {
  const raw = await readFile(storePath, "utf8");
  return sanitizeStore(JSON.parse(raw));
}

async function readStoreWithDataLossProtection(
  storePath: string,
): Promise<ProjectStore> {
  try {
    return await readStoreUnsafe(storePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { lastProjectSequence: 0, projects: [] };
    }

    throw new Error(
      `Project-Store konnte nicht gelesen werden. Schreibvorgang zum Schutz bestehender Daten abgebrochen: ${storePath}`,
      { cause: error },
    );
  }
}

async function ensureRuntimeDataDirIfNeeded(
  overrides?: Partial<ProjectStorePaths>,
): Promise<void> {
  if (!overrides?.dataDir) {
    await ensureRuntimeDataDirReady();
  }
}

async function writeStoreUnsafe(
  storePath: string,
  payload: ProjectStore,
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

async function acquireStoreLock(
  lockPath: string,
): Promise<() => Promise<void>> {
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
        throw new Error("Could not acquire project store lock in time.");
      }

      await delay(LOCK_POLL_INTERVAL_MS);
    }
  }
}

function findMatchingProjectIndex(
  projects: StoredProjectRecord[],
  input: UpsertStoredProjectInput,
): number {
  const requestedProjectSequence = parseProjectNumber(input.projectNumber);
  if (requestedProjectSequence > 0) {
    const normalizedProjectNumber = formatProjectNumber(requestedProjectSequence);
    const directIndex = projects.findIndex(
      (project) => project.projectNumber === normalizedProjectNumber,
    );
    if (directIndex >= 0) {
      return directIndex;
    }
  }

    const inputCustomerNumber = asTrimmedString(input.customerNumber);
    const inputCustomerName = normalizeTextForComparison(input.customerName);
    const inputStreet = normalizeTextForComparison(input.street);
    const inputPostalCode = normalizeTextForComparison(input.postalCode);
    const inputCity = normalizeTextForComparison(input.city);
    const inputProjectName = normalizeTextForComparison(input.projectName);
  const inputProjectAddress = normalizeTextForComparison(
    input.projectAddress || input.customerAddress,
  );

  return projects.findIndex((project) => {
    const matchesProjectName =
      normalizeTextForComparison(project.projectName) === inputProjectName;
    const matchesProjectAddress =
      normalizeTextForComparison(project.projectAddress) === inputProjectAddress;
    const matchesCustomerNumber =
      inputCustomerNumber &&
      project.customerNumber &&
      project.customerNumber === inputCustomerNumber;
    const matchesCustomerName =
      normalizeTextForComparison(project.customerName) === inputCustomerName;

    return matchesProjectName && matchesProjectAddress && (
      matchesCustomerNumber ||
      matchesCustomerName ||
      (
        normalizeTextForComparison(project.street) === inputStreet &&
        normalizeTextForComparison(project.postalCode) === inputPostalCode &&
        normalizeTextForComparison(project.city) === inputCity
      )
    );
  });
}

export async function listStoredProjects(
  overrides?: Partial<ProjectStorePaths>,
): Promise<StoredProjectRecord[]> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });
  const store = await readStoreWithDataLossProtection(paths.storePath);

  return [...store.projects].sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return rightTime - leftTime;
    }

    return right.projectNumber.localeCompare(left.projectNumber);
  });
}

export async function findStoredProjectByNumber(
  projectNumber: string,
  overrides?: Partial<ProjectStorePaths>,
): Promise<StoredProjectRecord | null> {
  const normalizedSequence = parseProjectNumber(projectNumber);
  if (!normalizedSequence) {
    return null;
  }

  const normalizedProjectNumber = formatProjectNumber(normalizedSequence);
  const projects = await listStoredProjects(overrides);
  return (
    projects.find((project) => project.projectNumber === normalizedProjectNumber) ??
    null
  );
}

export async function removeStoredProject(
  projectNumber: string,
  overrides?: Partial<ProjectStorePaths>,
): Promise<boolean> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });

  const normalizedSequence = parseProjectNumber(projectNumber);
  if (!normalizedSequence) {
    return false;
  }

  const normalizedProjectNumber = formatProjectNumber(normalizedSequence);
  const releaseLock = await acquireStoreLock(paths.lockPath);

  try {
    const store = await readStoreWithDataLossProtection(paths.storePath);
    const nextProjects = store.projects.filter(
      (project) => project.projectNumber !== normalizedProjectNumber,
    );
    if (nextProjects.length === store.projects.length) {
      return false;
    }

    await writeStoreUnsafe(paths.storePath, {
      ...store,
      projects: nextProjects,
    });
    return true;
  } finally {
    await releaseLock();
  }
}

export async function upsertStoredProject(
  input: UpsertStoredProjectInput,
  overrides?: Partial<ProjectStorePaths>,
): Promise<StoredProjectRecord> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });

  const releaseLock = await acquireStoreLock(paths.lockPath);

  try {
    const now = input.referenceDate ?? new Date();
    const nowIso = now.toISOString();
    const store = await readStoreWithDataLossProtection(paths.storePath);
    const existingIndex = findMatchingProjectIndex(store.projects, input);
    const normalizedDraftState = sanitizeCustomerDraftState(input.draftState);
    const resolvedProjectAddress =
      asTrimmedString(input.projectAddress) ||
      asTrimmedString(input.customerAddress);

    if (existingIndex >= 0) {
      const existing = store.projects[existingIndex];
      const updated: StoredProjectRecord = {
        ...existing,
        customerNumber: asTrimmedString(input.customerNumber) || existing.customerNumber,
        customerType: input.customerType,
        companyName: asTrimmedString(input.companyName),
        salutation: input.salutation === "frau" ? "frau" : "herr",
        firstName: asTrimmedString(input.firstName),
        lastName: asTrimmedString(input.lastName),
        street: asTrimmedString(input.street),
        postalCode: asTrimmedString(input.postalCode),
        city: asTrimmedString(input.city),
        customerName: asTrimmedString(input.customerName) || existing.customerName,
        customerAddress:
          asTrimmedString(input.customerAddress) || existing.customerAddress,
        customerEmail: asTrimmedString(input.customerEmail) || existing.customerEmail,
        projectName: asTrimmedString(input.projectName) || existing.projectName,
        projectAddress: resolvedProjectAddress || existing.projectAddress,
        status: sanitizeProjectStatus(input.status ?? existing.status),
        note: asTrimmedString(input.note),
        draftState: normalizedDraftState,
        updatedAt: nowIso,
      };

      const projects = [...store.projects];
      projects[existingIndex] = updated;
      await writeStoreUnsafe(paths.storePath, {
        ...store,
        projects,
      });
      return updated;
    }

    const nextSequence = store.lastProjectSequence + 1;
    const created: StoredProjectRecord = {
      projectNumber: formatProjectNumber(nextSequence),
      customerNumber: asTrimmedString(input.customerNumber) || undefined,
      customerType: input.customerType,
      companyName: asTrimmedString(input.companyName),
      salutation: input.salutation === "frau" ? "frau" : "herr",
      firstName: asTrimmedString(input.firstName),
      lastName: asTrimmedString(input.lastName),
      street: asTrimmedString(input.street),
      postalCode: asTrimmedString(input.postalCode),
      city: asTrimmedString(input.city),
      customerName: asTrimmedString(input.customerName),
      customerAddress: asTrimmedString(input.customerAddress),
      customerEmail: asTrimmedString(input.customerEmail),
      projectName: asTrimmedString(input.projectName),
      projectAddress: resolvedProjectAddress,
      status: sanitizeProjectStatus(input.status),
      note: asTrimmedString(input.note),
      draftState: normalizedDraftState,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await writeStoreUnsafe(paths.storePath, {
      lastProjectSequence: nextSequence,
      projects: [...store.projects, created],
    });
    return created;
  } finally {
    await releaseLock();
  }
}
