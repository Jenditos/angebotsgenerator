import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/supabase/config";

export type BusinessRecordType =
  | "customer"
  | "project"
  | "document"
  | "appointment"
  | "activity";

type BusinessRecordRow = {
  payload: unknown;
};

type SupabaseErrorLike = {
  code?: unknown;
};

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_ALLOCATABLE_SAFE_INTEGER = Number.MAX_SAFE_INTEGER - 1;

function isVercelProductionRuntime(): boolean {
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
}

export function shouldUseSupabaseBusinessStore(
  hasLocalPathOverrides = false,
): boolean {
  if (hasLocalPathOverrides) {
    if (isVercelProductionRuntime()) {
      throw new Error(
        "Lokale Geschäftsdaten-Speicherung ist in Vercel-Produktion nicht zulässig.",
      );
    }
    return false;
  }

  const configuredProvider = (
    process.env.BUSINESS_DATA_STORAGE_PROVIDER ?? ""
  )
    .trim()
    .toLowerCase();
  if (configuredProvider === "local") {
    if (isVercelProductionRuntime()) {
      throw new Error(
        "Lokale Geschäftsdaten-Speicherung ist in Vercel-Produktion nicht zulässig.",
      );
    }
    return false;
  }

  if (configuredProvider && configuredProvider !== "supabase") {
    throw new Error("Unbekannter Geschäftsdaten-Speicherprovider.");
  }

  if (configuredProvider === "supabase" || isVercelProductionRuntime()) {
    if (!isSupabaseAdminConfigured()) {
      throw new Error(
        "Supabase-Geschäftsdaten-Speicherung ist aktiviert, aber Supabase Admin ist nicht konfiguriert.",
      );
    }
    return true;
  }

  return false;
}

function assertIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} fehlt.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | undefined,
): string | null {
  return value?.trim() || null;
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  label: string,
  maximum: number,
): number {
  if (typeof value !== "undefined" && !Number.isFinite(value)) {
    throw new Error(`${label} ist ungueltig.`);
  }
  const normalized = Math.max(0, Math.floor(value ?? 0));
  if (!Number.isSafeInteger(normalized) || normalized > maximum) {
    throw new Error(`${label} ist ungueltig.`);
  }
  return normalized;
}

function createStoreError(message: string, cause: unknown): Error {
  const rawCode =
    typeof (cause as SupabaseErrorLike | null)?.code === "string"
      ? (cause as { code: string }).code
      : "UNKNOWN";
  const code = /^[A-Z0-9_]{1,32}$/i.test(rawCode) ? rawCode : "UNKNOWN";
  return new Error(`${message} (${code}).`, { cause });
}

export async function listBusinessRecords<T>(
  userId: string,
  entityType: BusinessRecordType,
): Promise<T[]> {
  const normalizedUserId = assertIdentifier(userId, "User-ID");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("business_records")
    .select("payload")
    .eq("user_id", normalizedUserId)
    .eq("entity_type", entityType)
    .order("updated_at", { ascending: false });

  if (error) {
    throw createStoreError("Geschaeftsdaten konnten nicht geladen werden", error);
  }

  return (Array.isArray(data) ? data : []).map(
    (row) => (row as BusinessRecordRow).payload as T,
  );
}

export async function findBusinessRecord<T>(
  userId: string,
  entityType: BusinessRecordType,
  entityKey: string,
): Promise<T | null> {
  const normalizedUserId = assertIdentifier(userId, "User-ID");
  const normalizedEntityKey = assertIdentifier(entityKey, "Datensatzschluessel");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("business_records")
    .select("payload")
    .eq("user_id", normalizedUserId)
    .eq("entity_type", entityType)
    .eq("entity_key", normalizedEntityKey)
    .maybeSingle();

  if (error) {
    throw createStoreError(
      "Geschaeftsdatensatz konnte nicht geladen werden",
      error,
    );
  }

  return data ? ((data as BusinessRecordRow).payload as T) : null;
}

export async function findIdempotentDocumentRecord<T>(
  userId: string,
  documentType: string,
  idempotencyKey: string,
): Promise<T | null> {
  const normalizedKey = idempotencyKey.trim();
  if (!normalizedKey) {
    return null;
  }

  const normalizedUserId = assertIdentifier(userId, "User-ID");
  const normalizedDocumentType = assertIdentifier(documentType, "Dokumentart");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("business_records")
    .select("payload")
    .eq("user_id", normalizedUserId)
    .eq("entity_type", "document")
    .eq("document_type", normalizedDocumentType)
    .eq("idempotency_key", normalizedKey)
    .maybeSingle();

  if (error) {
    throw createStoreError(
      "Idempotenter Dokumentdatensatz konnte nicht geladen werden",
      error,
    );
  }

  return data ? ((data as BusinessRecordRow).payload as T) : null;
}

export async function upsertBusinessRecord<T>(input: {
  userId: string;
  entityType: BusinessRecordType;
  entityKey: string;
  payload: T;
  documentType?: string;
  idempotencyKey?: string;
}): Promise<void> {
  const normalizedUserId = assertIdentifier(input.userId, "User-ID");
  const normalizedEntityKey = assertIdentifier(
    input.entityKey,
    "Datensatzschluessel",
  );
  const normalizedDocumentType = normalizeOptionalIdentifier(input.documentType);
  const normalizedIdempotencyKey = normalizeOptionalIdentifier(
    input.idempotencyKey,
  );
  if (
    input.entityType !== "document" &&
    (normalizedDocumentType || normalizedIdempotencyKey)
  ) {
    throw new Error(
      "Dokumentart und Idempotenzschluessel sind nur fuer Dokumente zulaessig.",
    );
  }
  if (normalizedIdempotencyKey && !normalizedDocumentType) {
    throw new Error(
      "Fuer einen Idempotenzschluessel muss eine Dokumentart angegeben werden.",
    );
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("business_records").upsert(
    {
      user_id: normalizedUserId,
      entity_type: input.entityType,
      entity_key: normalizedEntityKey,
      document_type: normalizedDocumentType,
      idempotency_key: normalizedIdempotencyKey,
      payload: input.payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,entity_type,entity_key" },
  );

  if (error) {
    throw createStoreError(
      "Geschaeftsdatensatz konnte nicht gespeichert werden",
      error,
    );
  }
}

export async function removeBusinessRecord(
  userId: string,
  entityType: BusinessRecordType,
  entityKey: string,
): Promise<boolean> {
  const normalizedUserId = assertIdentifier(userId, "User-ID");
  const normalizedEntityKey = assertIdentifier(entityKey, "Datensatzschluessel");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("business_records")
    .delete()
    .eq("user_id", normalizedUserId)
    .eq("entity_type", entityType)
    .eq("entity_key", normalizedEntityKey)
    .select("entity_key");

  if (error) {
    throw createStoreError(
      "Geschaeftsdatensatz konnte nicht geloescht werden",
      error,
    );
  }

  return Array.isArray(data) && data.length > 0;
}

export async function allocateBusinessSequence(input: {
  userId: string;
  counterType: string;
  counterYear?: number;
  floor?: number;
}): Promise<number> {
  const normalizedUserId = assertIdentifier(input.userId, "User-ID");
  const normalizedCounterType = assertIdentifier(
    input.counterType,
    "Zaehlerart",
  );
  const normalizedCounterYear = normalizeNonNegativeInteger(
    input.counterYear,
    "Zaehlerjahr",
    MAX_POSTGRES_INTEGER,
  );
  const normalizedFloor = normalizeNonNegativeInteger(
    input.floor,
    "Mindestwert",
    MAX_ALLOCATABLE_SAFE_INTEGER,
  );
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("allocate_business_sequence", {
    p_user_id: normalizedUserId,
    p_counter_type: normalizedCounterType,
    p_counter_year: normalizedCounterYear,
    p_floor: normalizedFloor,
  });

  if (error) {
    throw createStoreError(
      "Geschaeftsnummer konnte nicht vergeben werden",
      error,
    );
  }

  const sequence = Number(data);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error("Geschaeftsnummer konnte nicht vergeben werden.");
  }
  return sequence;
}
