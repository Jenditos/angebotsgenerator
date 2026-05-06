import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createActivityLogEntry,
  listActivityLogEntries,
} from "./activity-log-service";

describe("activity-log-service", () => {
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

      const entries = await listActivityLogEntries({
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
});
