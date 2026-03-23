import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { MAX_LOGO_DATA_URL_LENGTH } from "@/lib/logo-config";
import { readSettings, writeSettings } from "@/lib/settings-store";
import { __resetRuntimeDataDirPreparationForTests } from "@/server/services/store-runtime-paths";
import { CompanySettings } from "@/types/offer";

function buildSettingsFixture(overrides?: Partial<CompanySettings>): CompanySettings {
  return {
    companyName: "COMPANY_TEST_A",
    ownerName: "OWNER_TEST_A",
    companyStreet: "STREET_TEST_1",
    companyPostalCode: "00000",
    companyCity: "CITY_TEST",
    companyEmail: "company@example.test",
    companyPhone: "0000000",
    companyWebsite: "company.example.test",
    taxNumber: "TAX_TEST_1",
    vatId: "VAT_TEST_1",
    companyCountry: "COUNTRY_TEST",
    euVatNoticeText: "EU_NOTICE_TEST",
    includeCustomerVatId: true,
    senderCopyEmail: "copy@example.test",
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

  it("returns neutral defaults when no settings file exists", async () => {
    const dataDir = await createTempDir("settings-store-empty-defaults-");
    process.env.DATA_DIR = dataDir;
    await mkdir(dataDir, { recursive: true });

    const loaded = await readSettings();
    expect(loaded.companyName).toBe("");
    expect(loaded.ownerName).toBe("");
    expect(loaded.companyStreet).toBe("");
    expect(loaded.companyPostalCode).toBe("");
    expect(loaded.companyCity).toBe("");
    expect(loaded.companyEmail).toBe("");
    expect(loaded.companyPhone).toBe("");
    expect(loaded.companyWebsite).toBe("");
    expect(loaded.taxNumber).toBe("");
    expect(loaded.vatId).toBe("");
    expect(loaded.companyCountry).toBe("");
    expect(loaded.senderCopyEmail).toBe("");
    expect(loaded.logoDataUrl).toBe("");
    expect(loaded.offerTermsText).toBe("");
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
      companyName: "COMPANY_TEST_B",
    });

    const updated = await readSettings();
    expect(updated.companyName).toBe("COMPANY_TEST_B");
    expect(updated.logoDataUrl).toBe("data:image/png;base64,AAAA");
    expect(updated.lastOfferNumber).toBe("ANG-2026-123");
    expect(updated.lastInvoiceNumber).toBe("RE-2026-045");
    expect(updated.ownerName).toBe("OWNER_TEST_A");
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
      logoDataUrl: `data:image/png;base64,${"A".repeat(MAX_LOGO_DATA_URL_LENGTH + 100)}`,
    });

    const updated = await readSettings();
    expect(updated.logoDataUrl).toBe("data:image/png;base64,AAAA");
  });

  it("persists logo updates and explicit logo deletion", async () => {
    const dataDir = await createTempDir("settings-store-logo-update-delete-");
    process.env.DATA_DIR = dataDir;
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      path.join(dataDir, "company-settings.json"),
      JSON.stringify(buildSettingsFixture(), null, 2),
      "utf8",
    );

    await writeSettings({
      logoDataUrl: "data:image/png;base64,BBBB",
    });
    const afterFirstLogoUpdate = await readSettings();
    expect(afterFirstLogoUpdate.logoDataUrl).toBe("data:image/png;base64,BBBB");

    await writeSettings({
      logoDataUrl: "data:image/png;base64,CCCC",
    });
    const afterSecondLogoUpdate = await readSettings();
    expect(afterSecondLogoUpdate.logoDataUrl).toBe("data:image/png;base64,CCCC");

    await writeSettings({
      logoDataUrl: "",
    });
    const afterLogoDelete = await readSettings();
    expect(afterLogoDelete.logoDataUrl).toBe("");
  });

});
