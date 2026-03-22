import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureRuntimeDataDirReady } from "@/server/services/store-runtime-paths";
import { EmailConnection } from "@/types/email";

const EMAIL_CONNECTION_FILE_NAME = "email-connection.json";

async function resolveEmailStorePaths(): Promise<{
  dataDir: string;
  emailConnectionPath: string;
}> {
  const dataDir = await ensureRuntimeDataDirReady();
  return {
    dataDir,
    emailConnectionPath: path.join(dataDir, EMAIL_CONNECTION_FILE_NAME),
  };
}

export async function readEmailConnection(): Promise<EmailConnection | null> {
  const { emailConnectionPath } = await resolveEmailStorePaths();
  try {
    const file = await readFile(emailConnectionPath, "utf-8");
    const parsed = JSON.parse(file) as EmailConnection;
    if (!parsed.provider || !parsed.accessToken || !parsed.refreshToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeEmailConnection(connection: EmailConnection): Promise<void> {
  const { dataDir, emailConnectionPath } = await resolveEmailStorePaths();
  await mkdir(dataDir, { recursive: true });
  await writeFile(emailConnectionPath, JSON.stringify(connection, null, 2), "utf-8");
}

export async function clearEmailConnection(): Promise<void> {
  const { dataDir, emailConnectionPath } = await resolveEmailStorePaths();
  await mkdir(dataDir, { recursive: true });
  await writeFile(emailConnectionPath, "null", "utf-8");
}
