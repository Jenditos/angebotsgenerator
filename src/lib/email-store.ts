import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/supabase/config";
import { ensureRuntimeDataDirReady } from "@/server/services/store-runtime-paths";
import { EmailConnection } from "@/types/email";

const EMAIL_CONNECTION_FILE_NAME = "email-connection.json";
const EMAIL_CONNECTION_PREFIX = "email-connection-";
const EMAIL_CONNECTION_SUFFIX = ".json";
const EMAIL_CONNECTIONS_TABLE = "email_connections";

function shouldUseSupabaseEmailStore(): boolean {
  const configuredProvider = (process.env.EMAIL_CONNECTION_STORAGE_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (configuredProvider && configuredProvider !== "local" && configuredProvider !== "supabase") {
    throw new Error(
      `Unbekannter E-Mail-Verbindungsspeicher: ${configuredProvider}.`,
    );
  }
  if (configuredProvider === "local") {
    if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
      throw new Error(
        "Lokale E-Mail-Verbindungsdaten sind in Vercel-Produktion nicht zulässig.",
      );
    }
    return false;
  }

  if (
    configuredProvider === "supabase" ||
    (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production")
  ) {
    if (!isSupabaseAdminConfigured()) {
      throw new Error(
        "Supabase E-Mail-Verbindungsspeicher ist aktiviert, aber Supabase Admin ist nicht konfiguriert.",
      );
    }
    return true;
  }

  return false;
}

function getEncryptionKey(): Buffer {
  const secret = process.env.EMAIL_OAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("EMAIL_OAUTH_SECRET ist nicht gesetzt.");
  }
  return createHash("sha256").update(secret).digest();
}

function encryptConnection(connection: EmailConnection): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(connection), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptConnection(value: string): EmailConnection | null {
  try {
    const [version, ivValue, authTagValue, encryptedValue] = value.split(".");
    if (version !== "v1" || !ivValue || !authTagValue || !encryptedValue) {
      return null;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(decrypted) as unknown;
    return isValidConnection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readSupabaseConnection(userId: string): Promise<EmailConnection | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(EMAIL_CONNECTIONS_TABLE)
    .select("encrypted_payload")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `E-Mail-Verbindung konnte nicht geladen werden (${error.code ?? "UNKNOWN"}).`,
      { cause: error },
    );
  }
  const encryptedPayload =
    data && typeof data.encrypted_payload === "string"
      ? data.encrypted_payload
      : "";
  return encryptedPayload ? decryptConnection(encryptedPayload) : null;
}

async function writeSupabaseConnection(
  userId: string,
  connection: EmailConnection | null,
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  if (!connection) {
    const { error } = await supabase
      .from(EMAIL_CONNECTIONS_TABLE)
      .delete()
      .eq("user_id", userId);
    if (error) {
      throw new Error(
        `E-Mail-Verbindung konnte nicht getrennt werden (${error.code ?? "UNKNOWN"}).`,
        { cause: error },
      );
    }
    return;
  }

  const { error } = await supabase.from(EMAIL_CONNECTIONS_TABLE).upsert(
    {
      user_id: userId,
      encrypted_payload: encryptConnection(connection),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    throw new Error(
      `E-Mail-Verbindung konnte nicht gespeichert werden (${error.code ?? "UNKNOWN"}).`,
      { cause: error },
    );
  }
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new Error("Ungültige userId für E-Mail-Verbindung.");
  }
  return normalized;
}

function buildScopedConnectionFileName(userId: string): string {
  const userHash = createHash("sha256").update(normalizeUserId(userId)).digest("hex");
  return `${EMAIL_CONNECTION_PREFIX}${userHash}${EMAIL_CONNECTION_SUFFIX}`;
}

async function resolveEmailStorePaths(): Promise<{
  dataDir: string;
  emailConnectionPath: string;
  legacyEmailConnectionPath: string;
}>;
async function resolveEmailStorePaths(userId: string): Promise<{
  dataDir: string;
  emailConnectionPath: string;
  legacyEmailConnectionPath: string;
}>;
async function resolveEmailStorePaths(userId?: string): Promise<{
  dataDir: string;
  emailConnectionPath: string;
  legacyEmailConnectionPath: string;
}> {
  const dataDir = await ensureRuntimeDataDirReady();
  const legacyEmailConnectionPath = path.join(
    /*turbopackIgnore: true*/ dataDir,
    EMAIL_CONNECTION_FILE_NAME,
  );
  return {
    dataDir,
    emailConnectionPath: userId
      ? path.join(
          /*turbopackIgnore: true*/ dataDir,
          buildScopedConnectionFileName(userId),
        )
      : legacyEmailConnectionPath,
    legacyEmailConnectionPath,
  };
}

function isValidConnection(value: unknown): value is EmailConnection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EmailConnection>;
  return Boolean(
    (candidate.provider === "google" || candidate.provider === "microsoft") &&
      typeof candidate.accountEmail === "string" &&
      candidate.accountEmail.trim() &&
      typeof candidate.accessToken === "string" &&
      candidate.accessToken.trim() &&
      typeof candidate.refreshToken === "string" &&
      candidate.refreshToken.trim() &&
      typeof candidate.expiresAt === "number" &&
      Number.isFinite(candidate.expiresAt),
  );
}

async function readConnectionFile(emailConnectionPath: string): Promise<EmailConnection | null> {
  try {
    const file = await readFile(emailConnectionPath, "utf-8");
    const parsed = JSON.parse(file) as unknown;
    if (!isValidConnection(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeConnectionFile(
  dataDir: string,
  emailConnectionPath: string,
  connection: EmailConnection,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(emailConnectionPath, JSON.stringify(connection, null, 2), "utf-8");
}

async function clearConnectionFile(dataDir: string, emailConnectionPath: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(emailConnectionPath, "null", "utf-8");
}

export async function readEmailConnection(userId?: string): Promise<EmailConnection | null> {
  const normalizedUserId = userId ? normalizeUserId(userId) : undefined;
  if (shouldUseSupabaseEmailStore()) {
    if (!normalizedUserId) {
      throw new Error("User-ID fuer E-Mail-Verbindung fehlt.");
    }
    return readSupabaseConnection(normalizedUserId);
  }
  const { dataDir, emailConnectionPath, legacyEmailConnectionPath } = normalizedUserId
    ? await resolveEmailStorePaths(normalizedUserId)
    : await resolveEmailStorePaths();

  const scopedConnection = await readConnectionFile(emailConnectionPath);
  if (scopedConnection) {
    return scopedConnection;
  }

  if (!normalizedUserId || emailConnectionPath === legacyEmailConnectionPath) {
    return null;
  }

  const legacyConnection = await readConnectionFile(legacyEmailConnectionPath);
  if (!legacyConnection) {
    return null;
  }

  await writeConnectionFile(dataDir, emailConnectionPath, legacyConnection);
  await clearConnectionFile(dataDir, legacyEmailConnectionPath);
  return legacyConnection;
}

export function writeEmailConnection(connection: EmailConnection): Promise<void>;
export function writeEmailConnection(
  userId: string,
  connection: EmailConnection,
): Promise<void>;
export async function writeEmailConnection(
  userIdOrConnection: string | EmailConnection,
  maybeConnection?: EmailConnection,
): Promise<void> {
  const userId =
    typeof userIdOrConnection === "string" ? normalizeUserId(userIdOrConnection) : undefined;
  const connection =
    typeof userIdOrConnection === "string" ? maybeConnection : userIdOrConnection;

  if (!isValidConnection(connection)) {
    throw new Error("Ungültige E-Mail-Verbindung.");
  }
  if (shouldUseSupabaseEmailStore()) {
    if (!userId) {
      throw new Error("User-ID fuer E-Mail-Verbindung fehlt.");
    }
    await writeSupabaseConnection(userId, connection);
    return;
  }

  const { dataDir, emailConnectionPath } = userId
    ? await resolveEmailStorePaths(userId)
    : await resolveEmailStorePaths();
  await writeConnectionFile(dataDir, emailConnectionPath, connection);
}

export function clearEmailConnection(): Promise<void>;
export function clearEmailConnection(userId: string): Promise<void>;
export async function clearEmailConnection(userId?: string): Promise<void> {
  const normalizedUserId = userId ? normalizeUserId(userId) : undefined;
  if (shouldUseSupabaseEmailStore()) {
    if (!normalizedUserId) {
      throw new Error("User-ID fuer E-Mail-Verbindung fehlt.");
    }
    await writeSupabaseConnection(normalizedUserId, null);
    return;
  }
  const { dataDir, emailConnectionPath } = normalizedUserId
    ? await resolveEmailStorePaths(normalizedUserId)
    : await resolveEmailStorePaths();
  await clearConnectionFile(dataDir, emailConnectionPath);
}
