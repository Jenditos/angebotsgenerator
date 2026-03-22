import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { readSettings, writeSettings } from "@/lib/settings-store";
import { __resetRuntimeDataDirPreparationForTests } from "@/server/services/store-runtime-paths";
import { CompanySettings } from "@/types/offer";

function buildSettingsFixture(overrides?: Partial<CompanySettings>): CompanySettings {
  return {
    companyName: "Bestand GmbH",
    ownerName: "Max Mustermann",
    companyStreet: "Musterstraße 1",
    companyPostalCode: "10115",
    companyCity: "Berlin",
    companyEmail: "info@bestand.de",
    companyPhone: "+49 30 123456",
    companyWebsite: "www.bestand.de",
    senderCopyEmail: "intern@bestand.de",
    logoDataUrl: "data:image/png;base64,AAAA",
    pdfTableColumns: [
      { id: "position", label: "Position", visible: true, order: 0 },
      { id: "quantity", label: "Menge", visible: true, order: 1 },
      { id: "description", label: "Leistung", visible: true, order: 2 },
      { id: "unit", label: "Einheit", visible: true, order: 3 },
      { id: "unitPrice", label: "EP", visible: true, order: 4 },
      { id: "totalPrice", label: "Gesamt", visible: true, order: 5 },
    ],
    customServices: [],
    vatRate: 19,
    offerValidityDays: 30,
    invoicePaymentDueDays: 14,
    offerTermsText: "Bestehende Bedingungen",
    lastOfferNumber: "ANG-2026-123",
    lastInvoiceNumber: "RE-2026-045",
    customServiceTypes: ["Malerarbeiten"],
    ...overrides,
  };
}

describe("settings-store", () => {
  const originalDataDir = process.env.DATA_DIR;
  const createdDirs: string[] = [];

  async function createTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), prefix));
    createdDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    __resetRuntimeDataDirPreparationForTests();
  });

  afterEach(async () => {
    if (typeof originalDataDir === "undefined") {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    __resetRuntimeDataDirPreparationForTests();
    await Promise.all(
      createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("preserves existing fields on partial update", async () => {
    const dataDir = await createTempDir("settings-store-partial-");
    process.env.DATA_DIR = dataDir;
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      path.join(dataDir, "company-settings.json"),
      JSON.stringify(buildSettingsFixture(), null, 2),
      "utf8",
    );

    await writeSettings({
      companyName: "Neu GmbH",
    });

    const updated = await readSettings();
    expect(updated.companyName).toBe("Neu GmbH");
    expect(updated.logoDataUrl).toBe("data:image/png;base64,AAAA");
    expect(updated.lastOfferNumber).toBe("ANG-2026-123");
    expect(updated.lastInvoiceNumber).toBe("RE-2026-045");
    expect(updated.ownerName).toBe("Max Mustermann");
  });

  it("does not erase logo when an invalid oversized logo payload is sent", async () => {
    const dataDir = await createTempDir("settings-store-logo-");
    process.env.DATA_DIR = dataDir;
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      path.join(dataDir, "company-settings.json"),
      JSON.stringify(buildSettingsFixture(), null, 2),
      "utf8",
    );

    await writeSettings({
      logoDataUrl: `data:image/png;base64,${"A".repeat(2_000_100)}`,
    });

    const updated = await readSettings();
    expect(updated.logoDataUrl).toBe("data:image/png;base64,AAAA");
  });
});
