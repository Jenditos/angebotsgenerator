import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  findStoredProjectByNumber,
  listStoredProjects,
  removeStoredProject,
  upsertStoredProject,
} from "./project-store-service";
import {
  allocateBusinessSequence,
  findBusinessRecord,
  listBusinessRecords,
  removeBusinessRecord,
  shouldUseSupabaseBusinessStore,
  upsertBusinessRecord,
} from "./business-record-store";

jest.mock("./business-record-store", () => ({
  allocateBusinessSequence: jest.fn(),
  findBusinessRecord: jest.fn(),
  listBusinessRecords: jest.fn(),
  removeBusinessRecord: jest.fn(),
  shouldUseSupabaseBusinessStore: jest.fn(),
  upsertBusinessRecord: jest.fn(),
}));

const mockAllocateBusinessSequence = jest.mocked(allocateBusinessSequence);
const mockFindBusinessRecord = jest.mocked(findBusinessRecord);
const mockListBusinessRecords = jest.mocked(listBusinessRecords);
const mockRemoveBusinessRecord = jest.mocked(removeBusinessRecord);
const mockShouldUseSupabaseBusinessStore = jest.mocked(
  shouldUseSupabaseBusinessStore,
);
const mockUpsertBusinessRecord = jest.mocked(upsertBusinessRecord);

const TEST_USER_ID = "user-test-1";

function createSampleInput(seed: string) {
  return {
    userId: TEST_USER_ID,
    customerType: "company" as const,
    companyName: `Kunde ${seed} GmbH`,
    salutation: "herr" as const,
    firstName: "Max",
    lastName: `Beispiel${seed}`,
    street: `${seed} Testweg 1`,
    postalCode: "40210",
    city: "Duesseldorf",
    customerName: `Kunde ${seed} GmbH`,
    customerAddress: `${seed} Testweg 1, 40210 Duesseldorf`,
    customerEmail: `kunde-${seed}@example.com`,
    projectName: `Projekt ${seed}`,
    projectAddress: `${seed} Baustellenweg 2, 40210 Duesseldorf`,
    status: "offer_sent" as const,
    note: `Notiz ${seed}`,
  };
}

describe("project-store-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldUseSupabaseBusinessStore.mockReturnValue(false);
  });

  it("persists a new project with an incrementing PRJ number", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "project-store-"));
    const storePath = path.join(dataDir, "projects-store.json");
    const lockPath = path.join(dataDir, "projects-store.lock");

    try {
      const created = await upsertStoredProject(createSampleInput("1"), {
        dataDir,
        storePath,
        lockPath,
      });

      expect(created.projectNumber).toBe("PRJ-000001");
      expect(created.projectName).toBe("Projekt 1");
      expect(created.status).toBe("offer_sent");

      const persistedRaw = await readFile(storePath, "utf8");
      const persisted = JSON.parse(persistedRaw) as {
        lastProjectSequence: number;
        projects: Array<{ projectNumber: string }>;
      };

      expect(persisted.lastProjectSequence).toBe(1);
      expect(persisted.projects[0]?.projectNumber).toBe("PRJ-000001");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("updates an existing project when the same project number is reused", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "project-store-update-"));
    const storePath = path.join(dataDir, "projects-store.json");
    const lockPath = path.join(dataDir, "projects-store.lock");

    try {
      const created = await upsertStoredProject(createSampleInput("1"), {
        dataDir,
        storePath,
        lockPath,
      });

      const updated = await upsertStoredProject(
        {
          ...createSampleInput("1"),
          projectNumber: created.projectNumber,
          customerNumber: "KDN-000777",
          projectName: "Projekt 1 aktualisiert",
          status: "in_progress",
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(updated.projectNumber).toBe("PRJ-000001");
      expect(updated.customerNumber).toBe("KDN-000777");
      expect(updated.projectName).toBe("Projekt 1 aktualisiert");
      expect(updated.status).toBe("in_progress");

      const allProjects = await listStoredProjects(TEST_USER_ID, {
        dataDir,
        storePath,
        lockPath,
      });
      expect(allProjects).toHaveLength(1);
      expect(allProjects[0]?.projectNumber).toBe("PRJ-000001");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe("project-store-service Supabase storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldUseSupabaseBusinessStore.mockImplementation(
      (hasLocalPathOverrides) => !hasLocalPathOverrides,
    );
  });

  it("uses user-scoped business records for list and find", async () => {
    const project = {
      ...createSampleInput("1"),
      userId: "other-payload-user",
      projectNumber: "prj-000007",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
    };
    mockListBusinessRecords.mockResolvedValue([project]);
    mockFindBusinessRecord.mockResolvedValue(project);

    const listed = await listStoredProjects(TEST_USER_ID);
    const found = await findStoredProjectByNumber(TEST_USER_ID, "PRJ-000007");

    expect(mockListBusinessRecords).toHaveBeenCalledWith(TEST_USER_ID, "project");
    expect(mockFindBusinessRecord).toHaveBeenCalledWith(
      TEST_USER_ID,
      "project",
      "PRJ-000007",
    );
    expect(listed[0]).toMatchObject({
      userId: TEST_USER_ID,
      projectNumber: "PRJ-000007",
    });
    expect(found).toMatchObject({
      userId: TEST_USER_ID,
      projectNumber: "PRJ-000007",
    });
  });

  it("allocates a project number atomically and stores the new record", async () => {
    mockListBusinessRecords.mockResolvedValue([
      {
        ...createSampleInput("old"),
        projectNumber: "PRJ-000009",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    mockAllocateBusinessSequence.mockResolvedValue(10);

    const created = await upsertStoredProject(createSampleInput("new"));

    expect(mockAllocateBusinessSequence).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      counterType: "project",
      floor: 9,
    });
    expect(mockUpsertBusinessRecord).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      entityType: "project",
      entityKey: "PRJ-000010",
      payload: created,
    });
    expect(created.projectNumber).toBe("PRJ-000010");
  });

  it("reuses matching logic for updates and removes by user", async () => {
    mockListBusinessRecords.mockResolvedValue([
      {
        ...createSampleInput("1"),
        projectNumber: "PRJ-000003",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    mockRemoveBusinessRecord.mockResolvedValue(true);

    const updated = await upsertStoredProject({
      ...createSampleInput("1"),
      projectNumber: "PRJ-000003",
      note: "Aktualisiert",
    });
    const removed = await removeStoredProject(TEST_USER_ID, "PRJ-000003");

    expect(mockAllocateBusinessSequence).not.toHaveBeenCalled();
    expect(mockUpsertBusinessRecord).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      entityType: "project",
      entityKey: "PRJ-000003",
      payload: updated,
    });
    expect(mockRemoveBusinessRecord).toHaveBeenCalledWith(
      TEST_USER_ID,
      "project",
      "PRJ-000003",
    );
    expect(removed).toBe(true);
  });
});
