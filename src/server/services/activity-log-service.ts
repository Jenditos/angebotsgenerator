import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  ensureRuntimeDataDirReady,
  resolveRuntimeDataDir,
} from "@/server/services/store-runtime-paths";

export type ActivityEntityType =
  | "customer"
  | "project"
  | "document"
  | "email"
  | "system";

export type ActivityLogRecord = {
  id: string;
  userId?: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: string;
  eventKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type ActivityLogStore = {
  activities: ActivityLogRecord[];
};

type ActivityLogPaths = {
  dataDir: string;
  storePath: string;
  lockPath: string;
};

export type CreateActivityLogEntryInput = {
  userId?: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: string;
  eventKey?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
};

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_INTERVAL_MS = 30;
const STALE_LOCK_AFTER_MS = 15_000;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) {
      return {};
    }
    return cloned as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitizeActivityRecord(value: unknown): ActivityLogRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<ActivityLogRecord>;
  const id = asTrimmedString(record.id);
  const entityId = asTrimmedString(record.entityId);
  const action = asTrimmedString(record.action);
  const createdAt = asTrimmedString(record.createdAt);
  const entityType = record.entityType;

  if (
    !id ||
    !entityId ||
    !action ||
    !createdAt ||
    !["customer", "project", "document", "email", "system"].includes(
      String(entityType),
    )
  ) {
    return null;
  }

  return {
    id,
    userId: asTrimmedString(record.userId) || undefined,
    entityType: entityType as ActivityEntityType,
    entityId,
    action,
    eventKey: asTrimmedString(record.eventKey) || undefined,
    metadata: sanitizeMetadata(record.metadata),
    createdAt,
  };
}

function sanitizeStore(payload: unknown): ActivityLogStore {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { activities: [] };
  }

  const parsed = payload as Partial<ActivityLogStore>;
  const activities = Array.isArray(parsed.activities)
    ? parsed.activities
        .map((entry) => sanitizeActivityRecord(entry))
        .filter((entry): entry is ActivityLogRecord => Boolean(entry))
    : [];

  return { activities };
}

function resolvePaths(overrides?: Partial<ActivityLogPaths>): ActivityLogPaths {
  const dataDir = overrides?.dataDir ?? resolveRuntimeDataDir();
  return {
    dataDir,
    storePath:
      overrides?.storePath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "activity-log.json"),
    lockPath:
      overrides?.lockPath ??
      path.join(/*turbopackIgnore: true*/ dataDir, "activity-log.lock"),
  };
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT";
}

async function ensureRuntimeDataDirIfNeeded(
  overrides?: Partial<ActivityLogPaths>,
): Promise<void> {
  if (!overrides?.dataDir) {
    await ensureRuntimeDataDirReady();
  }
}

async function readStoreWithDataLossProtection(
  storePath: string,
): Promise<ActivityLogStore> {
  try {
    const raw = await readFile(storePath, "utf-8");
    return sanitizeStore(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) {
      return { activities: [] };
    }

    throw new Error(
      `Activity-Log konnte nicht gelesen werden. Schreibvorgang zum Schutz bestehender Daten abgebrochen: ${storePath}`,
      { cause: error },
    );
  }
}

async function writeStoreUnsafe(
  storePath: string,
  payload: ActivityLogStore,
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

async function acquireStoreLock(lockPath: string): Promise<() => Promise<void>> {
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
        throw new Error("Could not acquire activity log lock in time.");
      }

      await delay(LOCK_POLL_INTERVAL_MS);
    }
  }
}

export async function createActivityLogEntry(
  input: CreateActivityLogEntryInput,
  overrides?: Partial<ActivityLogPaths>,
): Promise<ActivityLogRecord> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });

  const releaseLock = await acquireStoreLock(paths.lockPath);
  try {
    const store = await readStoreWithDataLossProtection(paths.storePath);
    const eventKey = asTrimmedString(input.eventKey) || undefined;
    if (eventKey) {
      const existing = store.activities.find(
        (activity) => activity.eventKey === eventKey,
      );
      if (existing) {
        return existing;
      }
    }

    const activity: ActivityLogRecord = {
      id: randomUUID(),
      userId: asTrimmedString(input.userId) || undefined,
      entityType: input.entityType,
      entityId: asTrimmedString(input.entityId),
      action: asTrimmedString(input.action),
      eventKey,
      metadata: sanitizeMetadata(input.metadata),
      createdAt: (input.createdAt ?? new Date()).toISOString(),
    };

    if (!activity.entityId || !activity.action) {
      throw new Error("Activity-Log-Eintrag ist unvollstaendig.");
    }

    await writeStoreUnsafe(paths.storePath, {
      activities: [...store.activities, activity],
    });

    return activity;
  } finally {
    await releaseLock();
  }
}

export async function listActivityLogEntries(
  overrides?: Partial<ActivityLogPaths>,
): Promise<ActivityLogRecord[]> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.dataDir, { recursive: true });
  const store = await readStoreWithDataLossProtection(paths.storePath);

  return [...store.activities].sort((left, right) => {
    const rightTs = Date.parse(right.createdAt);
    const leftTs = Date.parse(left.createdAt);
    if (Number.isFinite(rightTs) && Number.isFinite(leftTs) && rightTs !== leftTs) {
      return rightTs - leftTs;
    }
    return right.id.localeCompare(left.id);
  });
}
