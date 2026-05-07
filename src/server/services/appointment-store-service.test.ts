import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  listStoredAppointments,
  removeStoredAppointment,
  upsertStoredAppointment,
} from "./appointment-store-service";

const TEST_USER_ID = "user-appointment-1";

function createSampleInput(seed: string) {
  return {
    userId: TEST_USER_ID,
    title: `Besichtigung ${seed}`,
    type: "site_visit" as const,
    status: "planned" as const,
    startAt: `2026-05-0${seed}T08:00:00.000Z`,
    endAt: `2026-05-0${seed}T09:00:00.000Z`,
    customerNumber: `KDN-00000${seed}`,
    customerName: `Kunde ${seed}`,
    projectName: `Projekt ${seed}`,
    address: `Testweg ${seed}, 40210 Duesseldorf`,
  };
}

describe("appointment-store-service", () => {
  it("persists appointments with incrementing TER numbers", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "appointment-store-"));
    const storePath = path.join(dataDir, "appointments-store.json");
    const lockPath = path.join(dataDir, "appointments-store.lock");

    try {
      const created = await upsertStoredAppointment(createSampleInput("1"), {
        dataDir,
        storePath,
        lockPath,
      });

      expect(created.appointmentNumber).toBe("TER-000001");
      expect(created.title).toBe("Besichtigung 1");

      const persistedRaw = await readFile(storePath, "utf8");
      const persisted = JSON.parse(persistedRaw) as {
        lastAppointmentSequence: number;
        appointments: Array<{ appointmentNumber: string }>;
      };

      expect(persisted.lastAppointmentSequence).toBe(1);
      expect(persisted.appointments[0]?.appointmentNumber).toBe("TER-000001");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("updates and removes existing appointments", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "appointment-store-update-"));
    const storePath = path.join(dataDir, "appointments-store.json");
    const lockPath = path.join(dataDir, "appointments-store.lock");

    try {
      const created = await upsertStoredAppointment(createSampleInput("1"), {
        dataDir,
        storePath,
        lockPath,
      });

      const updated = await upsertStoredAppointment(
        {
          ...createSampleInput("1"),
          appointmentNumber: created.appointmentNumber,
          title: "Besichtigung erledigt",
          status: "done",
        },
        { dataDir, storePath, lockPath },
      );

      expect(updated.appointmentNumber).toBe("TER-000001");
      expect(updated.status).toBe("done");
      expect(updated.title).toBe("Besichtigung erledigt");

      const removed = await removeStoredAppointment(
        TEST_USER_ID,
        created.appointmentNumber,
        { dataDir, storePath, lockPath },
      );
      const remaining = await listStoredAppointments(TEST_USER_ID, {
        dataDir,
        storePath,
        lockPath,
      });

      expect(removed).toBe(true);
      expect(remaining).toHaveLength(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
