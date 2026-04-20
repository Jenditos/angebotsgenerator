export const USER_ACCESS_SETUP_PUBLIC_MESSAGE =
  "Testzugang ist aktuell nicht vollständig eingerichtet.";

type UserAccessErrorClassification = {
  status: number;
  publicMessage: string;
};

type SupabaseErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readSupabaseLikeError(error: unknown): SupabaseErrorLike {
  if (error instanceof UserAccessSetupError) {
    return readSupabaseLikeError(error.technicalCause);
  }
  const record = asRecord(error);
  if (!record) {
    return {};
  }

  return {
    code: record.code,
    message: record.message,
    details: record.details,
    hint: record.hint,
  };
}

function buildSearchText(parts: Array<unknown>): string {
  return parts
    .map((part) => asString(part).trim().toLowerCase())
    .filter(Boolean)
    .join(" | ");
}

const SETUP_ERROR_CODES = new Set([
  "42P01", // relation does not exist
  "42703", // undefined column
  "42501", // insufficient privilege / grants
  "3F000", // invalid schema name
  "PGRST204", // unknown column in schema cache
  "PGRST205", // unknown table/view in schema cache
]);

const SETUP_ERROR_MARKERS = [
  'relation "public.user_access" does not exist',
  'relation "user_access" does not exist',
  "permission denied for table user_access",
  'column "',
  "could not find the table",
  "could not find the relation",
  "schema cache",
];

export class UserAccessSetupError extends Error {
  readonly technicalCause: unknown;

  constructor(technicalCause: unknown) {
    super(USER_ACCESS_SETUP_PUBLIC_MESSAGE);
    this.name = "UserAccessSetupError";
    this.technicalCause = technicalCause;
  }
}

export function isUserAccessSetupError(error: unknown): boolean {
  if (error instanceof UserAccessSetupError) {
    return true;
  }

  const supabaseError = readSupabaseLikeError(error);
  const code = asString(supabaseError.code).toUpperCase();
  if (code && SETUP_ERROR_CODES.has(code)) {
    return true;
  }

  const searchText = buildSearchText([
    supabaseError.message,
    supabaseError.details,
    supabaseError.hint,
  ]);
  if (!searchText) {
    return false;
  }

  return SETUP_ERROR_MARKERS.some((marker) => searchText.includes(marker));
}

export function toUserAccessSetupError(error: unknown): UserAccessSetupError {
  if (error instanceof UserAccessSetupError) {
    return error;
  }
  return new UserAccessSetupError(error);
}

export function classifyUserAccessError(
  error: unknown,
  fallbackMessage: string,
): UserAccessErrorClassification {
  if (isUserAccessSetupError(error)) {
    return {
      status: 503,
      publicMessage: USER_ACCESS_SETUP_PUBLIC_MESSAGE,
    };
  }

  return {
    status: 500,
    publicMessage: fallbackMessage,
  };
}

export function logUserAccessError(
  context: string,
  error: unknown,
  metadata: Record<string, unknown> = {},
): void {
  const supabaseError = readSupabaseLikeError(error);
  const technicalCause =
    error instanceof UserAccessSetupError ? error.technicalCause : error;
  console.error(`[access] ${context}`, {
    ...metadata,
    code: asString(supabaseError.code) || undefined,
    message: asString(supabaseError.message) || undefined,
    details: asString(supabaseError.details) || undefined,
    hint: asString(supabaseError.hint) || undefined,
    technicalCause,
  });
}
