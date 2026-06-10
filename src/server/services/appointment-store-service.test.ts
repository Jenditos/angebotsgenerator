import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  listStoredAppointments,
  removeStoredAppointment,
  upsertStoredAppointment,
} from "./appointment-store-service";
import {
  allocateBusinessSequence,
  listBusinessRecords,
  removeBusinessRecord,
  shouldUseSupabaseBusinessStore,
  upsertBusinessRecord,
} from "@/server/services/business-record-store";

jest.mock("@/server/services/business-record-store", () => ({
  allocateBusinessSequence: jest.fn(),
  findBusinessRecord: jest.fn(),
  listBusinessRecords: jest.fn(),
  removeBusinessRecord: jest.fn(),
  shouldUseSupabaseBusinessStore: jest.fn(),
  upsertBusinessRecord: jest.fn(),
}));

const TEST_USER_ID = "user-appointment-1";
const mockedAllocateBusinessSequence = jest.mocked(allocateBusinessSequence);
const mockedListBusinessRecords = jest.mocked(listBusinessRecords);
const mockedRemoveBusinessRecord = jest.mocked(removeBusinessRecord);
const mockedShouldUseSupabaseBusinessStore = jest.mocked(
  shouldUseSupabaseBusinessStore,
);
const mockedUpsertBusinessRecord = jest.mocked(upsertBusinessRecord);

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShouldUseSupabaseBusinessStore.mockReturnValue(false);
  });

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

  it("uses tenant-scoped business records and the atomic sequence in Supabase mode", async () => {
    mockedShouldUseSupabaseBusinessStore.mockReturnValue(true);
    mockedListBusinessRecords
      .mockResolvedValueOnce([
        {
          ...createSampleInput("1"),
          appointmentNumber: "TER-000007",
          createdAt: "2026-05-01T07:00:00.000Z",
          updatedAt: "2026-05-01T07:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          ...createSampleInput("1"),
          appointmentNumber: "TER-000007",
          createdAt: "2026-05-01T07:00:00.000Z",
          updatedAt: "2026-05-01T07:00:00.000Z",
        },
      ]);
    mockedAllocateBusinessSequence.mockResolvedValue(8);
    mockedRemoveBusinessRecord.mockResolvedValue(true);

    const listed = await listStoredAppointments(TEST_USER_ID);
    const created = await upsertStoredAppointment(createSampleInput("2"));
    const removed = await removeStoredAppointment(
      TEST_USER_ID,
      created.appointmentNumber,
    );

    expect(listed).toHaveLength(1);
    expect(created.appointmentNumber).toBe("TER-000008");
    expect(mockedListBusinessRecords).toHaveBeenCalledWith(
      TEST_USER_ID,
      "appointment",
    );
    expect(mockedAllocateBusinessSequence).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      counterType: "appointment",
      floor: 7,
    });
    expect(mockedUpsertBusinessRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER_ID,
        entityType: "appointment",
        entityKey: "TER-000008",
      }),
    );
    expect(mockedRemoveBusinessRecord).toHaveBeenCalledWith(
      TEST_USER_ID,
      "appointment",
      "TER-000008",
    );
    expect(removed).toBe(true);
  });
});
