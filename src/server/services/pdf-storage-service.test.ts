import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { readStoredDocumentPdf, saveDocumentPdf } from "./pdf-storage-service";

describe("pdf-storage-service", () => {
  it("stores a document pdf outside the public app tree", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "pdf-storage-"));
    const pdfDir = path.join(dataDir, "document-pdfs");

    try {
      const stored = await saveDocumentPdf(
        {
          documentNumber: "ANG-2026-001",
          pdfBuffer: Buffer.from("%PDF test"),
        },
        {
          dataDir,
          pdfDir,
        },
      );

      expect(stored.storageKey).toBe("document-pdfs/ANG-2026-001.pdf");
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
