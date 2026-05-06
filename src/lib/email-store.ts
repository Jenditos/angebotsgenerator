import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureRuntimeDataDirReady } from "@/server/services/store-runtime-paths";
import { EmailConnection } from "@/types/email";

const EMAIL_CONNECTION_FILE_NAME = "email-connection.json";
const EMAIL_CONNECTION_PREFIX = "email-connection-";
const EMAIL_CONNECTION_SUFFIX = ".json";

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

  const { dataDir, emailConnectionPath } = userId
    ? await resolveEmailStorePaths(userId)
    : await resolveEmailStorePaths();
  await writeConnectionFile(dataDir, emailConnectionPath, connection);
}

export function clearEmailConnection(): Promise<void>;
export function clearEmailConnection(userId: string): Promise<void>;
export async function clearEmailConnection(userId?: string): Promise<void> {
  const normalizedUserId = userId ? normalizeUserId(userId) : undefined;
  const { dataDir, emailConnectionPath } = normalizedUserId
    ? await resolveEmailStorePaths(normalizedUserId)
    : await resolveEmailStorePaths();
  await clearConnectionFile(dataDir, emailConnectionPath);
}
