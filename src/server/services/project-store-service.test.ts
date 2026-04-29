import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  listStoredProjects,
  upsertStoredProject,
} from "./project-store-service";

function createSampleInput(seed: string) {
  return {
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

      const allProjects = await listStoredProjects({
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
