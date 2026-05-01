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
  DocumentType,
  OfferPdfLineItem,
  OfferText,
  StoredOfferRecord,
} from "@/types/offer";
import {
  ensureRuntimeDataDirReady,
  resolveRuntimeDataDir,
} from "@/server/services/store-runtime-paths";

type OfferStore = {
  lastOfferNumber: string;
  lastInvoiceNumber?: string;
  nextOfferNumber?: number;
  nextInvoiceNumber?: number;
  offers: StoredOfferRecord[];
};

type OfferStorePaths = {
  dataDir: string;
  storePath: string;
  lockPath: string;
};

export type CreateStoredOfferInput = {
  documentType?: DocumentType;
  customerNumber?: string;
  projectNumber?: string;
  projectName?: string;
  projectAddress?: string;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  serviceDescription: string;
  lineItems: OfferPdfLineItem[];
  offer: OfferText;
  configuredLastOfferNumber?: string;
  configuredLastInvoiceNumber?: string;
  referenceDate?: Date;
};

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_INTERVAL_MS = 30;
const STALE_LOCK_AFTER_MS = 15_000;

const OFFER_NUMBER_PATTERN = /^ANG-(\d{4})-(\d{3,})$/;
const INVOICE_NUMBER_PATTERN = /^RE-(\d{4})-(\d{3,})$/;
const YEAR_TOKEN_PATTERN = /(19\d{2}|20\d{2}|21\d{2})/g;
const LAST_YEAR_TOKEN_PATTERN =
  /(19\d{2}|20\d{2}|21\d{2})(?!.*(19\d{2}|20\d{2}|21\d{2}))/;

function resolveDocumentType(value: unknown): DocumentType {
  return value === "invoice" ? "invoice" : "offer";
}

function formatDocumentNumber(
  documentType: DocumentType,
  year: number,
  sequence: number,
): string {
  const prefix = documentType === "invoice" ? "RE" : "ANG";
  return `${prefix}-${year}-${String(sequence).padStart(3, "0")}`;
}

function resolveYearToken(value: string, fallbackYear: number): number {
  const matches = Array.from(value.matchAll(YEAR_TOKEN_PATTERN));
  const token = matches.length > 0 ? matches[matches.length - 1]?.[1] : undefined;
  if (!token) {
    return fallbackYear;
  }

  const year = Number(token);
  return Number.isFinite(year) ? year : fallbackYear;
}

function findLastDigitRun(value: string): {
  start: number;
  end: number;
  value: string;
} | null {
  const pattern = /\d+/g;
  let match = pattern.exec(value);
  let lastMatch: RegExpExecArray | null = null;
  while (match) {
    lastMatch = match;
    match = pattern.exec(value);
  }

  if (!lastMatch) {
    return null;
  }

  return {
    start: lastMatch.index,
    end: lastMatch.index + lastMatch[0].length,
    value: lastMatch[0],
  };
}

function replaceLastYearToken(value: string, year: number): string {
  return value.replace(LAST_YEAR_TOKEN_PATTERN, String(year));
}

function formatDocumentNumberWithTemplate(input: {
  documentType: DocumentType;
  template: unknown;
  year: number;
  sequence: number;
}): string {
  const defaultValue = formatDocumentNumber(
    input.documentType,
    input.year,
    input.sequence,
  );
  const template = asTrimmedString(input.template);
  if (!template) {
    return defaultValue;
  }

  if (parseStrictDocumentNumber(input.documentType, template)) {
    return defaultValue;
  }

  const digitRun = findLastDigitRun(template);
  if (!digitRun) {
    return defaultValue;
  }

  const before = replaceLastYearToken(template.slice(0, digitRun.start), input.year);
  const after = template.slice(digitRun.end);
  if (!before.trim() && !after.trim()) {
    return defaultValue;
  }

  const sequenceWidth = Math.max(3, digitRun.value.length);
  const sequenceValue = String(input.sequence).padStart(sequenceWidth, "0");

  return `${before}${sequenceValue}${after}`;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function asTrimmedString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

function getYearFromDateString(value: string): number {
  const parsed = new Date(value);
  const year = parsed.getFullYear();
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

function parseStrictDocumentNumber(
  documentType: DocumentType,
  value: unknown,
): { year: number; sequence: number } | null {
  if (typeof value !== "string") {
    return null;
  }

  const pattern =
    documentType === "invoice" ? INVOICE_NUMBER_PATTERN : OFFER_NUMBER_PATTERN;
  const match = value.trim().match(pattern);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const sequence = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(sequence) || sequence <= 0) {
    return null;
  }

  return {
    year,
    sequence: Math.floor(sequence),
  };
}

function parseDocumentNumber(
  documentType: DocumentType,
  value: unknown,
  fallbackYear: number,
): { year: number; sequence: number } | null {
  const strict = parseStrictDocumentNumber(documentType, value);
  if (strict) {
    return strict;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Preserve legacy behavior for offer numbers that were saved as plain integers.
  if (documentType === "offer" && /^\d+$/.test(trimmed)) {
    return null;
  }

  const digitRun = findLastDigitRun(trimmed);
  if (!digitRun) {
    return null;
  }

  const sequence = Number(digitRun.value);
  if (!Number.isFinite(sequence) || sequence <= 0) {
    return null;
  }

  return {
    year: resolveYearToken(trimmed, fallbackYear),
    sequence: Math.floor(sequence),
  };
}

function normalizeDocumentNumber(
  documentType: DocumentType,
  rawValue: unknown,
  fallbackYear: number,
): { year: number; sequence: number; value: string } | null {
  const parsed = parseDocumentNumber(documentType, rawValue, fallbackYear);
  if (parsed) {
    const rawTemplate = asTrimmedString(rawValue);
    return {
      ...parsed,
      value: formatDocumentNumberWithTemplate({
        documentType,
        template: rawTemplate,
        year: parsed.year,
        sequence: parsed.sequence,
      }),
    };
  }

  if (documentType === "invoice") {
    return null;
  }

  const legacySequence = toPositiveInteger(rawValue);
  if (!legacySequence) {
    return null;
  }

  return {
    year: fallbackYear,
    sequence: legacySequence,
    value: formatDocumentNumber(documentType, fallbackYear, legacySequence),
  };
}

function sanitizeOfferRecord(value: unknown): StoredOfferRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<StoredOfferRecord> & {
    offerNumber?: unknown;
    customerNumber?: unknown;
    projectNumber?: unknown;
  };
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  const createdAtLegacy =
    typeof record.created_at === "string" ? record.created_at : "";
  const normalizedCreatedAt =
    createdAt || createdAtLegacy || new Date().toISOString();

  const fallbackYear = normalizedCreatedAt
    ? getYearFromDateString(normalizedCreatedAt)
    : new Date().getFullYear();
  const inferredDocumentType =
    record.documentType === "invoice" || record.documentType === "offer"
      ? record.documentType
      : parseStrictDocumentNumber("invoice", record.offerNumber)
        ? "invoice"
        : "offer";
  const normalizedOfferNumber = normalizeDocumentNumber(
    inferredDocumentType,
    record.offerNumber,
    fallbackYear,
  );
  const fallbackOfferNumber = asTrimmedString(record.offerNumber);
  const resolvedOfferNumber =
    normalizedOfferNumber?.value || fallbackOfferNumber;

  if (!resolvedOfferNumber) {
    return null;
  }

  const customerName =
    asTrimmedString(record.customerName) ||
    asTrimmedString(record.customerEmail) ||
    "Kunde";
  const customerAddress = asTrimmedString(record.customerAddress);
  const customerEmail = asTrimmedString(record.customerEmail);
  const serviceDescription = asTrimmedString(record.serviceDescription);
  const lineItems = Array.isArray(record.lineItems)
    ? (record.lineItems as OfferPdfLineItem[])
    : [];
  const offerRecord =
    record.offer && typeof record.offer === "object"
      ? (record.offer as Partial<OfferText>)
      : {};

  return {
    documentType: inferredDocumentType,
    offerNumber: resolvedOfferNumber,
    customerNumber:
      typeof record.customerNumber === "string" &&
      record.customerNumber.trim().length > 0
        ? record.customerNumber.trim()
        : undefined,
    projectNumber:
      typeof record.projectNumber === "string" &&
      record.projectNumber.trim().length > 0
        ? record.projectNumber.trim()
        : undefined,
    projectName:
      typeof record.projectName === "string" && record.projectName.trim().length > 0
        ? record.projectName.trim()
        : undefined,
    projectAddress:
      typeof record.projectAddress === "string" &&
      record.projectAddress.trim().length > 0
        ? record.projectAddress.trim()
        : undefined,
    createdAt: normalizedCreatedAt,
    created_at: normalizedCreatedAt,
    customerName,
    customerAddress,
    customerEmail,
    serviceDescription,
    lineItems,
    offer: {
      subject: asTrimmedString(offerRecord.subject),
      intro: asTrimmedString(offerRecord.intro),
      details: asTrimmedString(offerRecord.details),
      closing: asTrimmedString(offerRecord.closing),
    },
  };
}

function highestSequenceForYear(
  offers: StoredOfferRecord[],
  year: number,
  documentType: DocumentType,
): number {
  return offers.reduce((highest, offer) => {
    const offerDocumentType = resolveDocumentType(offer.documentType);
    if (offerDocumentType !== documentType) {
      return highest;
    }

    const parsed = parseDocumentNumber(documentType, offer.offerNumber, year);
    if (!parsed || parsed.year !== year) {
      return highest;
    }

    return Math.max(highest, parsed.sequence);
  }, 0);
}

function sanitizeStore(payload: unknown): OfferStore {
  if (!payload || typeof payload !== "object") {
    return { lastOfferNumber: "", offers: [] };
  }

  const parsed = payload as Partial<OfferStore> & {
    nextOfferNumber?: unknown;
    nextInvoiceNumber?: unknown;
    lastOfferNumber?: unknown;
    lastInvoiceNumber?: unknown;
  };

  const offers = Array.isArray(parsed.offers)
    ? parsed.offers
        .map((entry) => sanitizeOfferRecord(entry))
        .filter((entry): entry is StoredOfferRecord => Boolean(entry))
    : [];

  const currentYear = new Date().getFullYear();
  const parsedLastOfferNumber = normalizeDocumentNumber(
    "offer",
    parsed.lastOfferNumber,
    currentYear,
  );
  const parsedLastInvoiceNumber = normalizeDocumentNumber(
    "invoice",
    parsed.lastInvoiceNumber,
    currentYear,
  );
  const legacyNextOfferNumber = toPositiveInteger(parsed.nextOfferNumber);
  const legacyLastSequence =
    legacyNextOfferNumber && legacyNextOfferNumber > 1
      ? legacyNextOfferNumber - 1
      : 0;

  const highestCurrentYearOfferSequence = highestSequenceForYear(
    offers,
    currentYear,
    "offer",
  );
  const configuredCurrentYearOfferSequence =
    parsedLastOfferNumber?.year === currentYear
      ? parsedLastOfferNumber.sequence
      : 0;
  const resolvedCurrentYearOfferSequence = Math.max(
    highestCurrentYearOfferSequence,
    configuredCurrentYearOfferSequence,
    legacyLastSequence,
  );

  const highestCurrentYearInvoiceSequence = highestSequenceForYear(
    offers,
    currentYear,
    "invoice",
  );
  const configuredCurrentYearInvoiceSequence =
    parsedLastInvoiceNumber?.year === currentYear
      ? parsedLastInvoiceNumber.sequence
      : 0;
  const resolvedCurrentYearInvoiceSequence = Math.max(
    highestCurrentYearInvoiceSequence,
    configuredCurrentYearInvoiceSequence,
  );

  const normalizedStore: OfferStore = {
    lastOfferNumber: parsedLastOfferNumber?.value ?? "",
    offers,
  };

  if (resolvedCurrentYearOfferSequence > 0) {
    normalizedStore.lastOfferNumber = formatDocumentNumber(
      "offer",
      currentYear,
      resolvedCurrentYearOfferSequence,
    );
    normalizedStore.nextOfferNumber = resolvedCurrentYearOfferSequence + 1;
  } else if (parsedLastOfferNumber?.value) {
    normalizedStore.lastOfferNumber = parsedLastOfferNumber.value;
  }

  if (resolvedCurrentYearInvoiceSequence > 0) {
    normalizedStore.lastInvoiceNumber = formatDocumentNumber(
      "invoice",
      currentYear,
      resolvedCurrentYearInvoiceSequence,
    );
    normalizedStore.nextInvoiceNumber = resolvedCurrentYearInvoiceSequence + 1;
  } else if (parsedLastInvoiceNumber?.value) {
    normalizedStore.lastInvoiceNumber = parsedLastInvoiceNumber.value;
  }

  return normalizedStore;
}

function resolvePaths(overrides?: Partial<OfferStorePaths>): OfferStorePaths {
  const dataDir = overrides?.dataDir ?? resolveRuntimeDataDir();
  return {
    dataDir,
    storePath:
      overrides?.storePath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "offers-store.json"),
    lockPath:
      overrides?.lockPath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "offers-store.lock"),
  };
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT";
}

async function readStoreUnsafe(storePath: string): Promise<OfferStore> {
  const raw = await readFile(storePath, "utf-8");
  return sanitizeStore(JSON.parse(raw));
}

async function readStoreWithDataLossProtection(
  storePath: string,
): Promise<OfferStore> {
  try {
    return await readStoreUnsafe(storePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { lastOfferNumber: "", offers: [] };
    }

    throw new Error(
      `Offer-Store konnte nicht gelesen werden. Schreibvorgang zum Schutz bestehender Daten abgebrochen: ${storePath}`,
      { cause: error },
    );
  }
}

async function ensureRuntimeDataDirIfNeeded(
  overrides?: Partial<OfferStorePaths>,
): Promise<void> {
  if (!overrides?.dataDir) {
    await ensureRuntimeDataDirReady();
  }
}

async function writeStoreUnsafe(
  storePath: string,
  payload: OfferStore,
): Promise<void> {
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf-8");
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
        throw new Error("Could not acquire offer store lock in time.");
      }

      await delay(LOCK_POLL_INTERVAL_MS);
    }
  }
}

function resolveBaseSequenceForCurrentYear(input: {
  store: OfferStore;
  documentType: DocumentType;
  configuredLastNumber?: string;
  currentYear: number;
}): number {
  const currentDocumentLastNumber =
    input.documentType === "invoice"
      ? input.store.lastInvoiceNumber
      : input.store.lastOfferNumber;
  const storeLast = normalizeDocumentNumber(
    input.documentType,
    currentDocumentLastNumber,
    input.currentYear,
  );
  const configuredLast = normalizeDocumentNumber(
    input.documentType,
    input.configuredLastNumber,
    input.currentYear,
  );

  const storeCurrentYearSequence =
    storeLast?.year === input.currentYear ? storeLast.sequence : 0;
  const configuredCurrentYearSequence =
    configuredLast?.year === input.currentYear ? configuredLast.sequence : 0;
  const highestPersistedCurrentYearSequence = highestSequenceForYear(
    input.store.offers,
    input.currentYear,
    input.documentType,
  );

  return Math.max(
    storeCurrentYearSequence,
    configuredCurrentYearSequence,
    highestPersistedCurrentYearSequence,
  );
}

// Angebotsnummern werden zentral serverseitig vergeben und in einem Store persistiert.
// Die Lock-Datei verhindert doppelte Nummern bei nahezu gleichzeitigen Requests.
export async function createStoredOfferRecord(
  input: CreateStoredOfferInput,
  overrides?: Partial<OfferStorePaths>,
): Promise<StoredOfferRecord> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });

  const releaseLock = await acquireStoreLock(paths.lockPath);

  try {
    const store = await readStoreWithDataLossProtection(paths.storePath);
    const documentType = resolveDocumentType(input.documentType);
    const generatedAt = input.referenceDate ?? new Date();
    const currentYear = generatedAt.getFullYear();
    const configuredLastNumber =
      documentType === "invoice"
        ? input.configuredLastInvoiceNumber
        : input.configuredLastOfferNumber;

    const baseSequence = resolveBaseSequenceForCurrentYear({
      store,
      documentType,
      configuredLastNumber,
      currentYear,
    });
    const nextSequence = baseSequence + 1;
    const currentDocumentLastNumber =
      documentType === "invoice"
        ? store.lastInvoiceNumber
        : store.lastOfferNumber;
    const assignedOfferNumber = formatDocumentNumberWithTemplate({
      documentType,
      template: configuredLastNumber || currentDocumentLastNumber,
      year: currentYear,
      sequence: nextSequence,
    });

    const nextRecord: StoredOfferRecord = {
      documentType,
      offerNumber: assignedOfferNumber,
      customerNumber: input.customerNumber?.trim() || undefined,
      projectNumber: input.projectNumber?.trim() || undefined,
      projectName: input.projectName?.trim() || undefined,
      projectAddress: input.projectAddress?.trim() || undefined,
      createdAt: generatedAt.toISOString(),
      created_at: "",
      customerName: input.customerName,
      customerAddress: input.customerAddress,
      customerEmail: input.customerEmail,
      serviceDescription: input.serviceDescription,
      lineItems: input.lineItems,
      offer: input.offer,
    };
    nextRecord.created_at = nextRecord.createdAt;

    await writeStoreUnsafe(paths.storePath, {
      ...store,
      lastOfferNumber:
        documentType === "offer" ? assignedOfferNumber : store.lastOfferNumber,
      nextOfferNumber:
        documentType === "offer"
          ? nextSequence + 1
          : store.nextOfferNumber,
      lastInvoiceNumber:
        documentType === "invoice"
          ? assignedOfferNumber
          : store.lastInvoiceNumber,
      nextInvoiceNumber:
        documentType === "invoice"
          ? nextSequence + 1
          : store.nextInvoiceNumber,
      offers: [...store.offers, nextRecord],
    });

    return nextRecord;
  } finally {
    await releaseLock();
  }
}

export async function listStoredOfferRecords(
  overrides?: Partial<OfferStorePaths>,
): Promise<StoredOfferRecord[]> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  const store = await readStoreWithDataLossProtection(paths.storePath);

  return [...store.offers].sort((left, right) => {
    const rightTs = Date.parse(right.createdAt);
    const leftTs = Date.parse(left.createdAt);
    if (Number.isFinite(rightTs) && Number.isFinite(leftTs) && rightTs !== leftTs) {
      return rightTs - leftTs;
    }

    return right.offerNumber.localeCompare(left.offerNumber);
  });
}

export async function findStoredOfferRecordByNumber(
  offerNumber: string,
  overrides?: Partial<OfferStorePaths>,
): Promise<StoredOfferRecord | null> {
  const normalizedOfferNumber = offerNumber.trim().toUpperCase();
  if (!normalizedOfferNumber) {
    return null;
  }

  const records = await listStoredOfferRecords(overrides);
  return (
    records.find(
      (record) => record.offerNumber.trim().toUpperCase() === normalizedOfferNumber,
    ) ?? null
  );
}
