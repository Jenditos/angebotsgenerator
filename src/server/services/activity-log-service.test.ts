import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createActivityLogEntry,
  listActivityLogEntries,
} from "./activity-log-service";
import {
  findBusinessRecord,
  listBusinessRecords,
  shouldUseSupabaseBusinessStore,
  upsertBusinessRecord,
} from "@/server/services/business-record-store";

jest.mock("@/server/services/business-record-store", () => ({
  findBusinessRecord: jest.fn(),
  listBusinessRecords: jest.fn(),
  shouldUseSupabaseBusinessStore: jest.fn(),
  upsertBusinessRecord: jest.fn(),
}));

const mockedFindBusinessRecord = jest.mocked(findBusinessRecord);
const mockedListBusinessRecords = jest.mocked(listBusinessRecords);
const mockedShouldUseSupabaseBusinessStore = jest.mocked(
  shouldUseSupabaseBusinessStore,
);
const mockedUpsertBusinessRecord = jest.mocked(upsertBusinessRecord);

describe("activity-log-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShouldUseSupabaseBusinessStore.mockReturnValue(false);
  });

  it("persists activity entries and dedupes event keys", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "activity-log-"));
    const storePath = path.join(dataDir, "activity-log.json");
    const lockPath = path.join(dataDir, "activity-log.lock");

    try {
      const first = await createActivityLogEntry(
        {
          userId: "user-1",
          entityType: "document",
          entityId: "ANG-2026-001",
          action: "pdf_ready",
          eventKey: "submit-1:pdf_ready",
          metadata: {
            documentType: "offer",
            byteLength: 1234,
          },
          createdAt: new Date("2026-01-01T10:00:00.000Z"),
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );
      const duplicate = await createActivityLogEntry(
        {
          userId: "user-1",
          entityType: "document",
          entityId: "ANG-2026-001",
          action: "pdf_ready",
          eventKey: "submit-1:pdf_ready",
          metadata: {
            documentType: "offer",
            byteLength: 9999,
          },
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(duplicate.id).toBe(first.id);

      const entries = await listActivityLogEntries("user-1", {
        dataDir,
        storePath,
        lockPath,
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        userId: "user-1",
        entityType: "document",
        entityId: "ANG-2026-001",
        action: "pdf_ready",
        eventKey: "submit-1:pdf_ready",
      });

      const persistedRaw = await readFile(storePath, "utf-8");
      const persisted = JSON.parse(persistedRaw) as {
        activities: Array<{ eventKey?: string }>;
      };
      expect(persisted.activities).toHaveLength(1);
      expect(persisted.activities[0].eventKey).toBe("submit-1:pdf_ready");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("keeps local activity lists and event keys tenant-scoped", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "activity-log-tenants-"));
    const overrides = {
      dataDir,
      storePath: path.join(dataDir, "activity-log.json"),
      lockPath: path.join(dataDir, "activity-log.lock"),
    };

    try {
      const first = await createActivityLogEntry(
        {
          userId: "user-1",
          entityType: "system",
          entityId: "sync",
          action: "started",
          eventKey: "same-event",
        },
        overrides,
      );
      const second = await createActivityLogEntry(
        {
          userId: "user-2",
          entityType: "system",
          entityId: "sync",
          action: "started",
          eventKey: "same-event",
        },
        overrides,
      );

      expect(second.id).not.toBe(first.id);
      expect(await listActivityLogEntries("user-1", overrides)).toHaveLength(1);
      expect(await listActivityLogEntries("user-2", overrides)).toHaveLength(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reads and writes only tenant-scoped business records in Supabase mode", async () => {
    mockedShouldUseSupabaseBusinessStore.mockReturnValue(true);
    mockedFindBusinessRecord.mockResolvedValue(null);
    mockedListBusinessRecords.mockResolvedValue([
      {
        id: "activity-1",
        userId: "another-user",
        entityType: "document",
        entityId: "ANG-2026-001",
        action: "pdf_ready",
        metadata: {},
        createdAt: "2026-01-01T10:00:00.000Z",
      },
    ]);

    const created = await createActivityLogEntry({
      userId: "user-1",
      entityType: "document",
      entityId: "ANG-2026-001",
      action: "pdf_ready",
      eventKey: "submit-1:pdf_ready",
    });
    const listed = await listActivityLogEntries("user-1");

    expect(mockedFindBusinessRecord).toHaveBeenCalledWith(
      "user-1",
      "activity",
      "event:submit-1:pdf_ready",
    );
    expect(mockedUpsertBusinessRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        entityType: "activity",
        entityKey: "event:submit-1:pdf_ready",
      }),
    );
    expect(mockedListBusinessRecords).toHaveBeenCalledWith(
      "user-1",
      "activity",
    );
    expect(created.userId).toBe("user-1");
    expect(listed[0]?.userId).toBe("user-1");
  });

  it("rejects missing user IDs", async () => {
    await expect(
      createActivityLogEntry({
        entityType: "system",
        entityId: "sync",
        action: "started",
      }),
    ).rejects.toThrow("User-ID");
    await expect(listActivityLogEntries("")).rejects.toThrow("User-ID");
  });
});
