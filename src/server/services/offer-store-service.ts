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
import { resolveRuntimeDataDir } from "@/server/services/store-runtime-paths";

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

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function getYearFromDateString(value: string): number {
  const parsed = new Date(value);
  const year = parsed.getFullYear();
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

function parseDocumentNumber(
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

function normalizeDocumentNumber(
  documentType: DocumentType,
  rawValue: unknown,
  fallbackYear: number,
): { year: number; sequence: number; value: string } | null {
  const parsed = parseDocumentNumber(documentType, rawValue);
  if (parsed) {
    return {
      ...parsed,
      value: formatDocumentNumber(documentType, parsed.year, parsed.sequence),
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
  };
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  const createdAtLegacy =
    typeof record.created_at === "string" ? record.created_at : "";
  const normalizedCreatedAt = createdAt || createdAtLegacy;

  const fallbackYear = normalizedCreatedAt
    ? getYearFromDateString(normalizedCreatedAt)
    : new Date().getFullYear();
  const inferredDocumentType =
    record.documentType === "invoice" || record.documentType === "offer"
      ? record.documentType
      : parseDocumentNumber("invoice", record.offerNumber)
        ? "invoice"
        : "offer";
  const normalizedOfferNumber = normalizeDocumentNumber(
    inferredDocumentType,
    record.offerNumber,
    fallbackYear,
  );

  if (
    !normalizedOfferNumber ||
    !normalizedCreatedAt ||
    typeof record.customerName !== "string" ||
    typeof record.customerAddress !== "string" ||
    typeof record.customerEmail !== "string" ||
    typeof record.serviceDescription !== "string" ||
    !Array.isArray(record.lineItems) ||
    !record.offer ||
    typeof record.offer !== "object" ||
    typeof record.offer.subject !== "string" ||
    typeof record.offer.intro !== "string" ||
    typeof record.offer.details !== "string" ||
    typeof record.offer.closing !== "string"
  ) {
    return null;
  }

  return {
    documentType: inferredDocumentType,
    offerNumber: normalizedOfferNumber.value,
    customerNumber:
      typeof record.customerNumber === "string" &&
      record.customerNumber.trim().length > 0
        ? record.customerNumber.trim()
        : undefined,
    createdAt: normalizedCreatedAt,
    created_at: normalizedCreatedAt,
    customerName: record.customerName,
    customerAddress: record.customerAddress,
    customerEmail: record.customerEmail,
    serviceDescription: record.serviceDescription,
    lineItems: record.lineItems,
    offer: {
      subject: record.offer.subject,
      intro: record.offer.intro,
      details: record.offer.details,
      closing: record.offer.closing,
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

    const parsed = parseDocumentNumber(documentType, offer.offerNumber);
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
    storePath: overrides?.storePath ?? path.join(dataDir, "offers-store.json"),
    lockPath: overrides?.lockPath ?? path.join(dataDir, "offers-store.lock"),
  };
}

async function readStoreUnsafe(storePath: string): Promise<OfferStore> {
  try {
    const raw = await readFile(storePath, "utf-8");
    return sanitizeStore(JSON.parse(raw));
  } catch {
    return { lastOfferNumber: "", offers: [] };
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
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });

  const releaseLock = await acquireStoreLock(paths.lockPath);

  try {
    const store = await readStoreUnsafe(paths.storePath);
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
    const assignedOfferNumber = formatDocumentNumber(
      documentType,
      currentYear,
      nextSequence,
    );

    const nextRecord: StoredOfferRecord = {
      documentType,
      offerNumber: assignedOfferNumber,
      customerNumber: input.customerNumber?.trim() || undefined,
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
  const paths = resolvePaths(overrides);
  const store = await readStoreUnsafe(paths.storePath);

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
