import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { readStoredDocumentPdf, saveDocumentPdf } from "./pdf-storage-service";

const TEST_USER_ID = "user-test-1";

describe("pdf-storage-service", () => {
  const originalDataDir = process.env.DATA_DIR;
  const originalDataHome = process.env.VISIORO_DATA_HOME;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalPdfStorageProvider = process.env.DOCUMENT_PDF_STORAGE_PROVIDER;

  afterEach(() => {
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
    if (typeof originalVercel === "undefined") {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }
    if (typeof originalVercelEnv === "undefined") {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
    if (typeof originalPdfStorageProvider === "undefined") {
      delete process.env.DOCUMENT_PDF_STORAGE_PROVIDER;
    } else {
      process.env.DOCUMENT_PDF_STORAGE_PROVIDER = originalPdfStorageProvider;
    }
  });

  it("rejects local pdf storage without persistent Vercel production configuration", async () => {
    delete process.env.DATA_DIR;
    delete process.env.VISIORO_DATA_HOME;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.DOCUMENT_PDF_STORAGE_PROVIDER = "local";

    await expect(
      saveDocumentPdf({
        userId: TEST_USER_ID,
        documentNumber: "ANG-2026-001",
        pdfBuffer: Buffer.from("%PDF test"),
      }),
    ).rejects.toThrow(
      "Dauerhafte Datenspeicherung ist in Vercel-Produktion nicht konfiguriert",
    );
  });

  it("does not require a local data directory for Supabase pdf storage", async () => {
    delete process.env.DATA_DIR;
    delete process.env.VISIORO_DATA_HOME;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";

    await expect(
      saveDocumentPdf(
        {
          userId: TEST_USER_ID,
          documentNumber: "ANG-2026-001",
          pdfBuffer: Buffer.from("%PDF test"),
        },
        { provider: "supabase" },
      ),
    ).rejects.toThrow("Supabase PDF-Speicher ist aktiviert");
  });

  it("defaults to Supabase pdf storage in Vercel production", async () => {
    delete process.env.DATA_DIR;
    delete process.env.VISIORO_DATA_HOME;
    delete process.env.DOCUMENT_PDF_STORAGE_PROVIDER;
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";

    await expect(
      saveDocumentPdf({
        userId: TEST_USER_ID,
        documentNumber: "ANG-2026-001",
        pdfBuffer: Buffer.from("%PDF test"),
      }),
    ).rejects.toThrow("Supabase PDF-Speicher ist aktiviert");
  });

  it("stores a document pdf outside the public app tree", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "pdf-storage-"));
    const pdfDir = path.join(dataDir, "document-pdfs");

    try {
      const stored = await saveDocumentPdf(
        {
          userId: TEST_USER_ID,
          documentNumber: "ANG-2026-001",
          pdfBuffer: Buffer.from("%PDF test"),
        },
        {
          dataDir,
          pdfDir,
        },
      );

      expect(stored.storageKey).toBe(
        "document-pdfs/users/user-test-1/ANG-2026-001.pdf",
      );
      expect(stored.filename).toBe("ANG-2026-001.pdf");
      expect(stored.contentType).toBe("application/pdf");
      expect(stored.byteLength).toBe(9);
      expect(stored.reused).toBe(false);
      expect(stored.absolutePath).toBeTruthy();

      const persisted = await readFile(stored.absolutePath as string);
      expect(persisted.toString("utf-8")).toBe("%PDF test");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reuses an existing pdf for the same document number", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "pdf-storage-reuse-"));
    const pdfDir = path.join(dataDir, "document-pdfs");

    try {
      const first = await saveDocumentPdf(
        {
          userId: TEST_USER_ID,
          documentNumber: "ANG-2026-001",
          pdfBuffer: Buffer.from("first pdf"),
        },
        {
          dataDir,
          pdfDir,
        },
      );
      const second = await saveDocumentPdf(
        {
          userId: TEST_USER_ID,
          documentNumber: "ANG-2026-001",
          pdfBuffer: Buffer.from("second pdf"),
        },
        {
          dataDir,
          pdfDir,
        },
      );

      expect(second.storageKey).toBe(first.storageKey);
      expect(second.reused).toBe(true);

      const { pdfBuffer } = await readStoredDocumentPdf(second.storageKey, {
        dataDir,
        pdfDir,
      });
      expect(pdfBuffer.toString("utf-8")).toBe("first pdf");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
