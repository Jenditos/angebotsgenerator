import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createStoredOfferRecord } from "./offer-store-service";
import { listActivityLogEntries } from "./activity-log-service";
import { scheduleOfferFollowUpReminder } from "./document-reminder-service";

function createSampleInput() {
  return {
    customerName: "Kunde",
    customerAddress: "TEST_STREET_1, 00000 TEST_CITY",
    customerEmail: "kunde@example.com",
    serviceDescription: "Fliesenarbeiten",
    lineItems: [
      {
        position: 1,
        quantity: 2,
        description: "Fliesen verlegen",
        unit: "m2",
        unitPrice: 50,
        totalPrice: 100,
      },
    ],
    offer: {
      subject: "Angebot",
      intro: "Einleitung",
      details: "Details",
      closing: "Gruss",
    },
  };
}

describe("document-reminder-service", () => {
  it("schedules an idempotent offer follow-up reminder", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "document-reminder-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");
    const activityStorePath = path.join(dataDir, "activity-log.json");
    const activityLockPath = path.join(dataDir, "activity-log.lock");

    try {
      const offer = await createStoredOfferRecord(createSampleInput(), {
        dataDir,
        storePath,
        lockPath,
      });

      const first = await scheduleOfferFollowUpReminder({
        userId: "user-1",
        documentNumber: offer.offerNumber,
        documentType: "offer",
        idempotencyKey: "mail-key-1",
        referenceDate: new Date("2026-01-01T10:00:00.000Z"),
        storeOverrides: {
          dataDir,
          storePath,
          lockPath,
        },
        activityOverrides: {
          dataDir,
          storePath: activityStorePath,
          lockPath: activityLockPath,
        },
      });
      const second = await scheduleOfferFollowUpReminder({
        userId: "user-1",
        documentNumber: offer.offerNumber,
        documentType: "offer",
        idempotencyKey: "mail-key-1",
        referenceDate: new Date("2026-01-02T10:00:00.000Z"),
        storeOverrides: {
          dataDir,
          storePath,
          lockPath,
        },
        activityOverrides: {
          dataDir,
          storePath: activityStorePath,
          lockPath: activityLockPath,
        },
      });

      expect(first?.status).toBe("scheduled");
      expect(first?.dueAt).toBe("2026-01-04T10:00:00.000Z");
      expect(second?.dueAt).toBe(first?.dueAt);

      const activities = await listActivityLogEntries({
        dataDir,
        storePath: activityStorePath,
        lockPath: activityLockPath,
      });
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        entityId: offer.offerNumber,
        action: "reminder_scheduled",
        eventKey: "mail-key-1:reminder_scheduled",
      });
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
