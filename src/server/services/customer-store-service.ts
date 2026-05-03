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
import { normalizeDocumentTaxInfo } from "@/lib/document-tax";
import {
  CustomerDraftGroup,
  CustomerDraftState,
  CustomerDraftSubitem,
  StoredCustomerRecord,
} from "@/types/offer";
import {
  ensureRuntimeDataDirReady,
  resolveRuntimeDataDir,
} from "@/server/services/store-runtime-paths";

type CustomerStore = {
  lastCustomerSequence: number;
  customers: StoredCustomerRecord[];
};

type CustomerStorePaths = {
  dataDir: string;
  storePath: string;
  lockPath: string;
};

export type UpsertStoredCustomerInput = {
  customerType: "person" | "company";
  companyName?: string;
  salutation?: "herr" | "frau";
  firstName?: string;
  lastName?: string;
  street: string;
  postalCode: string;
  city: string;
  customerEmail: string;
  customerName: string;
  customerAddress: string;
  draftState?: CustomerDraftState;
  referenceDate?: Date;
};

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_INTERVAL_MS = 30;
const STALE_LOCK_AFTER_MS = 15_000;
const CUSTOMER_NUMBER_PATTERN = /^KDN-(\d{6,})$/;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTextForComparison(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeEmailForComparison(value: string): string {
  return normalizeTextForComparison(value);
}

function formatCustomerNumber(sequence: number): string {
  return `KDN-${String(sequence).padStart(6, "0")}`;
}

function parseCustomerNumber(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }

  const match = value.trim().match(CUSTOMER_NUMBER_PATTERN);
  if (!match) {
    return 0;
  }

  const sequence = Number(match[1]);
  return Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 0;
}

function parseCustomerSequence(value: unknown): number {
  const fromPattern = parseCustomerNumber(value);
  if (fromPattern > 0) {
    return fromPattern;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
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
    documentTax: normalizeDocumentTaxInfo(record.documentTax) ?? null,
  };
}

function sanitizeCustomerRecord(value: unknown): StoredCustomerRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<StoredCustomerRecord>;
  const sequence = parseCustomerSequence(record.customerNumber);
  const customerType = record.customerType === "company" ? "company" : "person";
  const salutation = record.salutation === "frau" ? "frau" : "herr";
  const street = asTrimmedString(record.street);
  const postalCode = asTrimmedString(record.postalCode);
  const city = asTrimmedString(record.city);
  const customerEmail = asTrimmedString(record.customerEmail);
  const fallbackCustomerName =
    asTrimmedString(record.customerName) ||
    [asTrimmedString(record.firstName), asTrimmedString(record.lastName)]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    asTrimmedString(record.companyName);
  const fallbackCustomerAddress = [street, postalCode, city]
    .filter(Boolean)
    .join(", ");
  const customerName = asTrimmedString(record.customerName) || fallbackCustomerName;
  const customerAddress =
    asTrimmedString(record.customerAddress) || fallbackCustomerAddress;

  const createdAtRaw = asTrimmedString(record.createdAt);
  const updatedAtRaw = asTrimmedString(record.updatedAt);
  const resolvedCreatedAt =
    createdAtRaw || updatedAtRaw || new Date().toISOString();
  const resolvedUpdatedAt = updatedAtRaw || resolvedCreatedAt;

  if (!sequence) {
    return null;
  }

  if (!customerName && !street && !city && !customerEmail) {
    return null;
  }

  return {
    customerNumber: formatCustomerNumber(sequence),
    customerType,
    companyName: asTrimmedString(record.companyName),
    salutation,
    firstName: asTrimmedString(record.firstName),
    lastName: asTrimmedString(record.lastName),
    street,
    postalCode,
    city,
    customerEmail,
    customerName,
    customerAddress,
    draftState: sanitizeCustomerDraftState(record.draftState),
    createdAt: resolvedCreatedAt,
    updatedAt: resolvedUpdatedAt,
  };
}

function sanitizeStore(payload: unknown): CustomerStore {
  if (!payload || typeof payload !== "object") {
    return { lastCustomerSequence: 0, customers: [] };
  }

  const parsed = payload as Partial<CustomerStore> & {
    lastCustomerSequence?: unknown;
  };

  const customers = Array.isArray(parsed.customers)
    ? parsed.customers
        .map((entry) => sanitizeCustomerRecord(entry))
        .filter((entry): entry is StoredCustomerRecord => Boolean(entry))
    : [];

  const highestSequence = customers.reduce(
    (highest, customer) =>
      Math.max(highest, parseCustomerNumber(customer.customerNumber)),
    0,
  );

  const parsedSequence = Number(parsed.lastCustomerSequence);
  const sanitizedSequence =
    Number.isFinite(parsedSequence) && parsedSequence > 0
      ? Math.floor(parsedSequence)
      : 0;

  return {
    lastCustomerSequence: Math.max(highestSequence, sanitizedSequence),
    customers,
  };
}

function resolvePaths(overrides?: Partial<CustomerStorePaths>): CustomerStorePaths {
  const dataDir = overrides?.dataDir ?? resolveRuntimeDataDir();
  return {
    dataDir,
    storePath:
      overrides?.storePath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "customers-store.json"),
    lockPath:
      overrides?.lockPath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "customers-store.lock"),
  };
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT";
}

async function readStoreUnsafe(storePath: string): Promise<CustomerStore> {
  const raw = await readFile(storePath, "utf8");
  return sanitizeStore(JSON.parse(raw));
}

async function readStoreWithDataLossProtection(
  storePath: string,
): Promise<CustomerStore> {
  try {
    return await readStoreUnsafe(storePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return { lastCustomerSequence: 0, customers: [] };
    }

    throw new Error(
      `Customer-Store konnte nicht gelesen werden. Schreibvorgang zum Schutz bestehender Daten abgebrochen: ${storePath}`,
      { cause: error },
    );
  }
}

async function ensureRuntimeDataDirIfNeeded(
  overrides?: Partial<CustomerStorePaths>,
): Promise<void> {
  if (!overrides?.dataDir) {
    await ensureRuntimeDataDirReady();
  }
}

async function writeStoreUnsafe(
  storePath: string,
  payload: CustomerStore,
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
        throw new Error("Could not acquire customer store lock in time.");
      }

      await delay(LOCK_POLL_INTERVAL_MS);
    }
  }
}

function findMatchingCustomerIndex(
  customers: StoredCustomerRecord[],
  input: UpsertStoredCustomerInput,
): number {
  const inputEmail = normalizeEmailForComparison(input.customerEmail);
  const inputType = input.customerType;
  const inputCompany = normalizeTextForComparison(input.companyName ?? "");
  const inputFirstName = normalizeTextForComparison(input.firstName ?? "");
  const inputLastName = normalizeTextForComparison(input.lastName ?? "");
  const inputStreet = normalizeTextForComparison(input.street);
  const inputPostalCode = normalizeTextForComparison(input.postalCode);
  const inputCity = normalizeTextForComparison(input.city);

  return customers.findIndex((customer) => {
    const customerEmail = normalizeEmailForComparison(customer.customerEmail);
    if (inputEmail && customerEmail && inputEmail === customerEmail) {
      return true;
    }

    return (
      customer.customerType === inputType &&
      normalizeTextForComparison(customer.companyName) === inputCompany &&
      normalizeTextForComparison(customer.firstName) === inputFirstName &&
      normalizeTextForComparison(customer.lastName) === inputLastName &&
      normalizeTextForComparison(customer.street) === inputStreet &&
      normalizeTextForComparison(customer.postalCode) === inputPostalCode &&
      normalizeTextForComparison(customer.city) === inputCity
    );
  });
}

export async function listStoredCustomers(
  overrides?: Partial<CustomerStorePaths>,
): Promise<StoredCustomerRecord[]> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });
  const store = await readStoreWithDataLossProtection(paths.storePath);

  return [...store.customers].sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return rightTime - leftTime;
    }

    return right.customerNumber.localeCompare(left.customerNumber);
  });
}

export async function removeStoredCustomer(
  customerNumber: string,
  overrides?: Partial<CustomerStorePaths>,
): Promise<boolean> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });

  const normalizedSequence = parseCustomerNumber(customerNumber);
  if (!normalizedSequence) {
    return false;
  }

  const normalizedCustomerNumber = formatCustomerNumber(normalizedSequence);
  const releaseLock = await acquireStoreLock(paths.lockPath);

  try {
    const store = await readStoreWithDataLossProtection(paths.storePath);
    const nextCustomers = store.customers.filter(
      (customer) => customer.customerNumber !== normalizedCustomerNumber,
    );
    if (nextCustomers.length === store.customers.length) {
      return false;
    }

    await writeStoreUnsafe(paths.storePath, {
      ...store,
      customers: nextCustomers,
    });
    return true;
  } finally {
    await releaseLock();
  }
}

export async function upsertStoredCustomer(
  input: UpsertStoredCustomerInput,
  overrides?: Partial<CustomerStorePaths>,
): Promise<StoredCustomerRecord> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });

  const releaseLock = await acquireStoreLock(paths.lockPath);

  try {
    const now = input.referenceDate ?? new Date();
    const nowIso = now.toISOString();
    const store = await readStoreWithDataLossProtection(paths.storePath);
    const existingIndex = findMatchingCustomerIndex(store.customers, input);
    const normalizedDraftState = sanitizeCustomerDraftState(input.draftState);

    if (existingIndex >= 0) {
      const existing = store.customers[existingIndex];
      const updated: StoredCustomerRecord = {
        ...existing,
        customerType: input.customerType,
        companyName: asTrimmedString(input.companyName),
        salutation: input.salutation === "frau" ? "frau" : "herr",
        firstName: asTrimmedString(input.firstName),
        lastName: asTrimmedString(input.lastName),
        street: asTrimmedString(input.street),
        postalCode: asTrimmedString(input.postalCode),
        city: asTrimmedString(input.city),
        customerEmail: asTrimmedString(input.customerEmail),
        customerName: asTrimmedString(input.customerName),
        customerAddress: asTrimmedString(input.customerAddress),
        draftState: normalizedDraftState,
        updatedAt: nowIso,
      };

      const customers = [...store.customers];
      customers[existingIndex] = updated;
      await writeStoreUnsafe(paths.storePath, {
        ...store,
        customers,
      });
      return updated;
    }

    const nextSequence = store.lastCustomerSequence + 1;
    const created: StoredCustomerRecord = {
      customerNumber: formatCustomerNumber(nextSequence),
      customerType: input.customerType,
      companyName: asTrimmedString(input.companyName),
      salutation: input.salutation === "frau" ? "frau" : "herr",
      firstName: asTrimmedString(input.firstName),
      lastName: asTrimmedString(input.lastName),
      street: asTrimmedString(input.street),
      postalCode: asTrimmedString(input.postalCode),
      city: asTrimmedString(input.city),
      customerEmail: asTrimmedString(input.customerEmail),
      customerName: asTrimmedString(input.customerName),
      customerAddress: asTrimmedString(input.customerAddress),
      draftState: normalizedDraftState,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await writeStoreUnsafe(paths.storePath, {
      lastCustomerSequence: nextSequence,
      customers: [...store.customers, created],
    });
    return created;
  } finally {
    await releaseLock();
  }
}
