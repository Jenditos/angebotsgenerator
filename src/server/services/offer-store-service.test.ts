import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createStoredOfferRecord,
  updateStoredOfferRecordEmailReference,
  updateStoredOfferRecordPdfReference,
  updateStoredOfferRecordStatus,
} from "./offer-store-service";

function createSampleInput(seed: string) {
  return {
    customerName: `Kunde ${seed}`,
    customerAddress: "TEST_STREET_1, 00000 TEST_CITY",
    customerEmail: "kunde@example.com",
    serviceDescription: "Fliesenarbeiten",
    lineItems: [
      {
        position: 1,
        quantity: 2,
        description: "Fliesen verlegen",
        unit: "m²",
        unitPrice: 50,
        totalPrice: 100,
      },
    ],
    offer: {
      subject: "Angebot",
      intro: "Einleitung",
      details: "Details",
      closing: "Gruß",
    },
  };
}

function formatOfferNumber(year: number, sequence: number): string {
  return `ANG-${year}-${String(sequence).padStart(3, "0")}`;
}

function formatInvoiceNumber(year: number, sequence: number): string {
  return `RE-${year}-${String(sequence).padStart(3, "0")}`;
}

describe("offer-store-service", () => {
  it("persists an incrementing server-side offer number in ANG-JAHR-XXX format", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offer-store-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");
    const currentYear = new Date().getFullYear();

    try {
      const first = await createStoredOfferRecord(createSampleInput("1"), {
        dataDir,
        storePath,
        lockPath,
      });
      const second = await createStoredOfferRecord(createSampleInput("2"), {
        dataDir,
        storePath,
        lockPath,
      });

      expect(first.offerNumber).toBe(formatOfferNumber(currentYear, 1));
      expect(second.offerNumber).toBe(formatOfferNumber(currentYear, 2));

      const persistedRaw = await readFile(storePath, "utf8");
      const persisted = JSON.parse(persistedRaw) as {
        lastOfferNumber: string;
        offers: Array<{ offerNumber: string; createdAt: string }>;
      };

      expect(persisted.lastOfferNumber).toBe(formatOfferNumber(currentYear, 2));
      expect(persisted.offers.length).toBe(2);
      expect(persisted.offers[0].offerNumber).toBe(formatOfferNumber(currentYear, 1));
      expect(persisted.offers[1].offerNumber).toBe(formatOfferNumber(currentYear, 2));
      expect(typeof persisted.offers[0].createdAt).toBe("string");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("prevents duplicate numbers for concurrent writes", async () => {
    const dataDir = await mkdtemp(
      path.join(tmpdir(), "offer-store-concurrent-"),
    );
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");
    const currentYear = new Date().getFullYear();

    try {
      const created = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          createStoredOfferRecord(createSampleInput(String(index + 1)), {
            dataDir,
            storePath,
            lockPath,
          }),
        ),
      );

      const numbers = created
        .map((entry) => entry.offerNumber)
        .sort((a, b) => a.localeCompare(b));

      expect(numbers).toEqual(
        Array.from({ length: 8 }, (_, index) =>
          formatOfferNumber(currentYear, index + 1),
        ),
      );
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reuses the existing document for the same idempotency key", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offer-store-idempotent-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");

    try {
      const first = await createStoredOfferRecord(
        {
          ...createSampleInput("1"),
          idempotencyKey: "same-submit-key",
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );
      const second = await createStoredOfferRecord(
        {
          ...createSampleInput("2"),
          idempotencyKey: "same-submit-key",
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(second.offerNumber).toBe(first.offerNumber);

      const persistedRaw = await readFile(storePath, "utf8");
      const persisted = JSON.parse(persistedRaw) as {
        offers: Array<{ offerNumber: string; idempotencyKey?: string }>;
      };
      expect(persisted.offers).toHaveLength(1);
      expect(persisted.offers[0].idempotencyKey).toBe("same-submit-key");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("updates a document processing status without creating a new record", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offer-store-status-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");

    try {
      const created = await createStoredOfferRecord(createSampleInput("1"), {
        dataDir,
        storePath,
        lockPath,
      });
      const updated = await updateStoredOfferRecordStatus(
        created.offerNumber,
        "pdf_ready",
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(updated?.status).toBe("pdf_ready");

      const persistedRaw = await readFile(storePath, "utf8");
      const persisted = JSON.parse(persistedRaw) as {
        offers: Array<{ offerNumber: string; status?: string; updatedAt?: string }>;
      };
      expect(persisted.offers).toHaveLength(1);
      expect(persisted.offers[0].status).toBe("pdf_ready");
      expect(typeof persisted.offers[0].updatedAt).toBe("string");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("stores a pdf reference on an existing document record", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offer-store-pdf-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");

    try {
      const created = await createStoredOfferRecord(createSampleInput("1"), {
        dataDir,
        storePath,
        lockPath,
      });
      const updated = await updateStoredOfferRecordPdfReference(
        created.offerNumber,
        {
          storageKey: `document-pdfs/${created.offerNumber}.pdf`,
          filename: `${created.offerNumber}.pdf`,
          contentType: "application/pdf",
          byteLength: 1234,
          createdAt: "2026-01-01T10:00:00.000Z",
          updatedAt: "2026-01-01T10:00:00.000Z",
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(updated?.pdf?.storageKey).toBe(
        `document-pdfs/${created.offerNumber}.pdf`,
      );

      const persistedRaw = await readFile(storePath, "utf8");
      const persisted = JSON.parse(persistedRaw) as {
        offers: Array<{
          offerNumber: string;
          pdf?: { storageKey?: string; byteLength?: number };
        }>;
      };
      expect(persisted.offers).toHaveLength(1);
      expect(persisted.offers[0].pdf?.storageKey).toBe(
        `document-pdfs/${created.offerNumber}.pdf`,
      );
      expect(persisted.offers[0].pdf?.byteLength).toBe(1234);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("stores an email reference on an existing document record", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offer-store-email-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");

    try {
      const created = await createStoredOfferRecord(createSampleInput("1"), {
        dataDir,
        storePath,
        lockPath,
      });
      const updated = await updateStoredOfferRecordEmailReference(
        created.offerNumber,
        {
          status: "prepared",
          provider: "google",
          idempotencyKey: "mail-key-1",
          draftId: "draft-1",
          composeUrl: "https://mail.google.com/mail/u/0/#drafts?compose=draft-1",
          preparedAt: "2026-01-01T10:00:00.000Z",
          updatedAt: "2026-01-01T10:00:00.000Z",
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(updated?.email?.status).toBe("prepared");
      expect(updated?.email?.draftId).toBe("draft-1");

      const persistedRaw = await readFile(storePath, "utf8");
      const persisted = JSON.parse(persistedRaw) as {
        offers: Array<{
          offerNumber: string;
          email?: { status?: string; idempotencyKey?: string; draftId?: string };
        }>;
      };
      expect(persisted.offers).toHaveLength(1);
      expect(persisted.offers[0].email?.status).toBe("prepared");
      expect(persisted.offers[0].email?.idempotencyKey).toBe("mail-key-1");
      expect(persisted.offers[0].email?.draftId).toBe("draft-1");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses configured last offer number and increments from it", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offer-store-configured-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");
    const currentYear = new Date().getFullYear();

    try {
      const first = await createStoredOfferRecord(
        {
          ...createSampleInput("1"),
          configuredLastOfferNumber: formatOfferNumber(currentYear, 25),
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      const second = await createStoredOfferRecord(
        {
          ...createSampleInput("2"),
          configuredLastOfferNumber: formatOfferNumber(currentYear, 25),
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(first.offerNumber).toBe(formatOfferNumber(currentYear, 26));
      expect(second.offerNumber).toBe(formatOfferNumber(currentYear, 27));
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("starts from 001 when the year changes", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "offer-store-yearly-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");

    try {
      await writeFile(
        storePath,
        JSON.stringify(
          {
            lastOfferNumber: "ANG-2025-099",
            offers: [],
          },
          null,
          2,
        ),
        "utf8",
      );

      const next = await createStoredOfferRecord(
        {
          ...createSampleInput("1"),
          referenceDate: new Date("2026-01-03T10:00:00.000Z"),
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(next.offerNumber).toBe("ANG-2026-001");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("stores a separate invoice sequence with RE-JAHR-XXX", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "invoice-store-separate-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");
    const currentYear = new Date().getFullYear();

    try {
      const firstOffer = await createStoredOfferRecord(
        createSampleInput("offer-1"),
        {
          dataDir,
          storePath,
          lockPath,
        },
      );
      const firstInvoice = await createStoredOfferRecord(
        {
          ...createSampleInput("invoice-1"),
          documentType: "invoice",
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );
      const secondInvoice = await createStoredOfferRecord(
        {
          ...createSampleInput("invoice-2"),
          documentType: "invoice",
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(firstOffer.offerNumber).toBe(formatOfferNumber(currentYear, 1));
      expect(firstInvoice.offerNumber).toBe(formatInvoiceNumber(currentYear, 1));
      expect(secondInvoice.offerNumber).toBe(formatInvoiceNumber(currentYear, 2));
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("continues a custom configured invoice number style with letters", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "invoice-store-custom-style-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");
    const currentYear = new Date().getFullYear();

    try {
      const firstInvoice = await createStoredOfferRecord(
        {
          ...createSampleInput("invoice-custom-1"),
          documentType: "invoice",
          configuredLastInvoiceNumber: `RG-${currentYear}-AB-025`,
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );
      const secondInvoice = await createStoredOfferRecord(
        {
          ...createSampleInput("invoice-custom-2"),
          documentType: "invoice",
          configuredLastInvoiceNumber: `RG-${currentYear}-AB-025`,
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(firstInvoice.offerNumber).toBe(`RG-${currentYear}-AB-026`);
      expect(secondInvoice.offerNumber).toBe(`RG-${currentYear}-AB-027`);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("supports custom invoice styles where letters are after the number", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "invoice-store-custom-suffix-"));
    const storePath = path.join(dataDir, "offers-store.json");
    const lockPath = path.join(dataDir, "offers-store.lock");
    const currentYear = new Date().getFullYear();

    try {
      const invoice = await createStoredOfferRecord(
        {
          ...createSampleInput("invoice-custom-suffix"),
          documentType: "invoice",
          configuredLastInvoiceNumber: `RE-${currentYear}-025A`,
        },
        {
          dataDir,
          storePath,
          lockPath,
        },
      );

      expect(invoice.offerNumber).toBe(`RE-${currentYear}-026A`);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
