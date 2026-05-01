import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { MAIN_BANK_ACCOUNT_ID } from "@/lib/bank-accounts";
import { readSettings } from "@/lib/settings-store";
import { listStoredCustomers } from "@/server/services/customer-store-service";
import { listStoredOfferRecords } from "@/server/services/offer-store-service";
import {
  __resetRuntimeDataDirPreparationForTests,
  ensureRuntimeDataDirReady,
  resolveRuntimeDataDir,
} from "@/server/services/store-runtime-paths";
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
    companyIban: "DE89 3704 0044 0532 0130 00",
    companyBic: "COBADEFFXXX",
    companyBankName: "Musterbank AG",
    ibanVerificationStatus: "valid",
    additionalBankAccounts: [],
    defaultBankAccountId: MAIN_BANK_ACCOUNT_ID,
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

describe("update persistence", () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalDataDir = process.env.DATA_DIR;
  const originalDataHome = process.env.VISIORO_DATA_HOME;
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
    process.chdir(originalCwd);
    if (typeof originalHome === "undefined") {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (typeof originalDataDir === "undefined") {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    if (typeof originalDataHome === "undefined") {
      delete process.env.VISIORO_DATA_HOME;
    } else {
      process.env.VISIORO_DATA_HOME = originalDataHome;
    }
    __resetRuntimeDataDirPreparationForTests();

    await Promise.all(
      createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("migrates legacy data on update without losing customers, settings, logo and documents", async () => {
    const legacyProjectDir = await createTempDir("update-persistence-project-");
    const runtimeHomeDir = await createTempDir("update-persistence-home-");
    const legacyDataDir = path.join(legacyProjectDir, "data");
    await mkdir(legacyDataDir, { recursive: true });

    await writeFile(
      path.join(legacyDataDir, "company-settings.json"),
      JSON.stringify(buildSettingsFixture(), null, 2),
      "utf8",
    );

    await writeFile(
      path.join(legacyDataDir, "customers-store.json"),
      JSON.stringify(
        {
          lastCustomerSequence: 1,
          customers: [
            {
              customerNumber: "KDN-000001",
              customerType: "person",
              companyName: "",
              salutation: "herr",
              firstName: "Alex",
              lastName: "Kunde",
              street: "STREET_TEST_1",
              postalCode: "00000",
              city: "CITY_TEST",
              customerEmail: "customer@example.test",
              customerName: "Alex Kunde",
              customerAddress: "STREET_TEST_1, 00000 CITY_TEST",
              createdAt: "2026-03-01T10:00:00.000Z",
              updatedAt: "2026-03-01T10:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      path.join(legacyDataDir, "offers-store.json"),
      JSON.stringify(
        {
          lastOfferNumber: "ANG-2026-099",
          lastInvoiceNumber: "RE-2026-010",
          offers: [
            {
              documentType: "offer",
              offerNumber: "ANG-2026-099",
              customerNumber: "KDN-000001",
              createdAt: "2026-03-05T09:00:00.000Z",
              created_at: "2026-03-05T09:00:00.000Z",
              customerName: "Alex Kunde",
              customerAddress: "STREET_TEST_1, 00000 CITY_TEST",
              customerEmail: "customer@example.test",
              serviceDescription: "Malerarbeiten",
              lineItems: [],
              offer: {
                subject: "Angebot",
                intro: "Hallo",
                details: "Details",
                closing: "Gruß",
              },
            },
            {
              documentType: "invoice",
              offerNumber: "RE-2026-010",
              customerNumber: "KDN-000001",
              createdAt: "2026-03-06T09:00:00.000Z",
              created_at: "2026-03-06T09:00:00.000Z",
              customerName: "Alex Kunde",
              customerAddress: "STREET_TEST_1, 00000 CITY_TEST",
              customerEmail: "customer@example.test",
              serviceDescription: "Malerarbeiten",
              lineItems: [],
              offer: {
                subject: "Rechnung",
                intro: "Hallo",
                details: "Details",
                closing: "Gruß",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    process.chdir(legacyProjectDir);
    delete process.env.DATA_DIR;
    process.env.VISIORO_DATA_HOME = runtimeHomeDir;
    __resetRuntimeDataDirPreparationForTests();

    await ensureRuntimeDataDirReady();

    const settings = await readSettings();
    const customers = await listStoredCustomers();
    const documents = await listStoredOfferRecords();

    expect(settings.companyName).toBe("COMPANY_TEST_A");
    expect(settings.logoDataUrl).toBe("data:image/png;base64,AAAA");
    expect(settings.lastOfferNumber).toBe("ANG-2026-123");
    expect(settings.lastInvoiceNumber).toBe("RE-2026-045");
    expect(customers).toHaveLength(1);
    expect(customers[0]?.customerNumber).toBe("KDN-000001");
    expect(documents.map((entry) => entry.offerNumber)).toEqual(
      expect.arrayContaining(["ANG-2026-099", "RE-2026-010"]),
    );
  });

  it("keeps existing runtime data when migration runs (no overwrite)", async () => {
    const legacyProjectDir = await createTempDir("update-no-overwrite-project-");
    const runtimeHomeDir = await createTempDir("update-no-overwrite-home-");
    const legacyDataDir = path.join(legacyProjectDir, "data");
    const runtimeDataDir = path.join(runtimeHomeDir, ".visioro-data");

    await mkdir(legacyDataDir, { recursive: true });
    await mkdir(runtimeDataDir, { recursive: true });

    await writeFile(
      path.join(legacyDataDir, "company-settings.json"),
      JSON.stringify(buildSettingsFixture({ companyName: "COMPANY_LEGACY" }), null, 2),
      "utf8",
    );
    await writeFile(
      path.join(runtimeDataDir, "company-settings.json"),
      JSON.stringify(buildSettingsFixture({ companyName: "COMPANY_RUNTIME" }), null, 2),
      "utf8",
    );

    process.chdir(legacyProjectDir);
    delete process.env.DATA_DIR;
    process.env.VISIORO_DATA_HOME = runtimeHomeDir;
    __resetRuntimeDataDirPreparationForTests();

    await ensureRuntimeDataDirReady();
    const settings = await readSettings();
    expect(settings.companyName).toBe("COMPANY_RUNTIME");

    const runtimeSettingsRaw = await readFile(
      path.join(resolveRuntimeDataDir(), "company-settings.json"),
      "utf8",
    );
    const runtimeSettings = JSON.parse(runtimeSettingsRaw) as CompanySettings;
    expect(runtimeSettings.companyName).toBe("COMPANY_RUNTIME");
  });
});
