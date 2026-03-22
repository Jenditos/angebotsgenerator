import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVERLESS_DATA_DIR = "/tmp/visioro-data";
const LOCAL_PERSISTENT_DATA_DIR_NAME = ".visioro-data";
const MIGRATION_EXCLUDED_ENTRIES = new Set([".gitkeep"]);

const preparedDataDirs = new Set<string>();
const preparationPromisesByDir = new Map<string, Promise<void>>();

function isReadonlyServerlessRuntime(): boolean {
  return (
    process.env.VERCEL === "1" ||
    Boolean(process.env.LAMBDA_TASK_ROOT) ||
    process.cwd().startsWith("/var/task")
  );
}

function resolveLegacyProjectDataDir(): string {
  return path.join(process.cwd(), "data");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryEntriesIfMissing(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  let sourceEntries: Dirent[];
  try {
    sourceEntries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }

  await mkdir(targetDir, { recursive: true });

  for (const entry of sourceEntries) {
    if (MIGRATION_EXCLUDED_ENTRIES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryEntriesIfMissing(sourcePath, targetPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (await pathExists(targetPath)) {
      continue;
    }

    await copyFile(sourcePath, targetPath);
  }
}

function shouldRunLegacyMigration(runtimeDataDir: string): boolean {
  if (process.env.DATA_DIR?.trim()) {
    return false;
  }

  const legacyDataDir = resolveLegacyProjectDataDir();
  return path.resolve(runtimeDataDir) !== path.resolve(legacyDataDir);
}

async function prepareRuntimeDataDir(runtimeDataDir: string): Promise<void> {
  await mkdir(runtimeDataDir, { recursive: true });

  if (!shouldRunLegacyMigration(runtimeDataDir)) {
    return;
  }

  await copyDirectoryEntriesIfMissing(
    resolveLegacyProjectDataDir(),
    runtimeDataDir,
  );
}

export function resolveRuntimeDataDir(): string {
  const configuredDataDir = process.env.DATA_DIR?.trim();
  if (configuredDataDir) {
    return configuredDataDir;
  }

  const configuredDataHome = process.env.VISIORO_DATA_HOME?.trim();
  if (configuredDataHome) {
    return path.join(configuredDataHome, LOCAL_PERSISTENT_DATA_DIR_NAME);
  }

  if (isReadonlyServerlessRuntime()) {
    return SERVERLESS_DATA_DIR;
  }

  return path.join(os.homedir(), LOCAL_PERSISTENT_DATA_DIR_NAME);
}

export async function ensureRuntimeDataDirReady(): Promise<string> {
  const runtimeDataDir = resolveRuntimeDataDir();
  if (preparedDataDirs.has(runtimeDataDir)) {
    return runtimeDataDir;
  }

  const existingPromise = preparationPromisesByDir.get(runtimeDataDir);
  if (existingPromise) {
    await existingPromise;
    return runtimeDataDir;
  }

  const preparationPromise = prepareRuntimeDataDir(runtimeDataDir)
    .then(() => {
      preparedDataDirs.add(runtimeDataDir);
    })
    .finally(() => {
      preparationPromisesByDir.delete(runtimeDataDir);
    });

  preparationPromisesByDir.set(runtimeDataDir, preparationPromise);
  await preparationPromise;
  return runtimeDataDir;
}

export function __resetRuntimeDataDirPreparationForTests(): void {
  preparedDataDirs.clear();
  preparationPromisesByDir.clear();
}
