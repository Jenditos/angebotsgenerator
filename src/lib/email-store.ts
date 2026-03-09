import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EmailConnection } from "@/types/email";

const dataDir = path.join(process.cwd(), "data");
const emailConnectionPath = path.join(dataDir, "email-connection.json");

export async function readEmailConnection(): Promise<EmailConnection | null> {
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
  await mkdir(dataDir, { recursive: true });
  await writeFile(emailConnectionPath, JSON.stringify(connection, null, 2), "utf-8");
}

export async function clearEmailConnection(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(emailConnectionPath, "null", "utf-8");
}

