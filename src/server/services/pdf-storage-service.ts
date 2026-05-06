import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  ensureRuntimeDataDirReady,
  resolveRuntimeDataDir,
} from "@/server/services/store-runtime-paths";
import { StoredPdfReference } from "@/types/offer";

type PdfStoragePaths = {
  dataDir: string;
  pdfDir: string;
};

export type SaveDocumentPdfInput = {
  documentNumber: string;
  pdfBuffer: Buffer;
};

export type StoredDocumentPdf = StoredPdfReference & {
  absolutePath: string;
  reused: boolean;
};

const PDF_STORAGE_DIR_NAME = "document-pdfs";
const PDF_CONTENT_TYPE = "application/pdf";

function toSafeFilename(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
}

function resolvePaths(overrides?: Partial<PdfStoragePaths>): PdfStoragePaths {
  const dataDir = overrides?.dataDir ?? resolveRuntimeDataDir();
  return {
    dataDir,
    pdfDir:
      overrides?.pdfDir ??
      path.join(/*turbopackIgnore: true*/ dataDir, PDF_STORAGE_DIR_NAME),
  };
}

function normalizeStorageKey(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function assertSafeStorageKey(storageKey: string): void {
  const normalized = normalizeStorageKey(storageKey);
  if (
    !normalized ||
    normalized !== storageKey ||
    normalized.includes("..") ||
    path.isAbsolute(normalized) ||
    !normalized.startsWith(`${PDF_STORAGE_DIR_NAME}/`) ||
    !normalized.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Ungueltiger PDF-Speicherschluessel.");
  }
}

function buildStorageKey(documentNumber: string): string {
  const safeDocumentNumber = toSafeFilename(documentNumber);
  if (!safeDocumentNumber) {
    throw new Error("Dokumentnummer fuer PDF-Speicherung fehlt.");
  }

  return `${PDF_STORAGE_DIR_NAME}/${safeDocumentNumber}.pdf`;
}

function resolveStoragePath(
  storageKey: string,
  paths: PdfStoragePaths,
): string {
  const normalizedStorageKey = normalizeStorageKey(storageKey);
  assertSafeStorageKey(normalizedStorageKey);
  const relativePdfPath = normalizedStorageKey.slice(
    `${PDF_STORAGE_DIR_NAME}/`.length,
  );
  return path.join(/*turbopackIgnore: true*/ paths.pdfDir, relativePdfPath);
}

async function ensureRuntimeDataDirIfNeeded(
  overrides?: Partial<PdfStoragePaths>,
): Promise<void> {
  if (!overrides?.dataDir) {
    await ensureRuntimeDataDirReady();
  }
}

function isExistingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

async function buildPdfReference(input: {
  storageKey: string;
  absolutePath: string;
  filename: string;
  reused: boolean;
}): Promise<StoredDocumentPdf> {
  const stats = await stat(input.absolutePath);
  return {
    storageKey: input.storageKey,
    filename: input.filename,
    contentType: PDF_CONTENT_TYPE,
    byteLength: stats.size,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
    absolutePath: input.absolutePath,
    reused: input.reused,
  };
}

export async function saveDocumentPdf(
  input: SaveDocumentPdfInput,
  overrides?: Partial<PdfStoragePaths>,
): Promise<StoredDocumentPdf> {
  if (!Buffer.isBuffer(input.pdfBuffer) || input.pdfBuffer.byteLength === 0) {
    throw new Error("PDF-Inhalt fuer Speicherung fehlt.");
  }

  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.pdfDir, { recursive: true });

  const filename = `${toSafeFilename(input.documentNumber)}.pdf`;
  const storageKey = buildStorageKey(input.documentNumber);
  const absolutePath = resolveStoragePath(storageKey, paths);

  try {
    const existingStats = await stat(absolutePath);
    if (existingStats.isFile()) {
      return buildPdfReference({
        storageKey,
        absolutePath,
        filename,
        reused: true,
      });
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(absolutePath, "wx");
    await handle.writeFile(input.pdfBuffer);
  } catch (error) {
    if (isExistingFileError(error)) {
      return buildPdfReference({
        storageKey,
        absolutePath,
        filename,
        reused: true,
      });
    }

    await unlink(absolutePath).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }

  return buildPdfReference({
    storageKey,
    absolutePath,
    filename,
    reused: false,
  });
}

export async function readStoredDocumentPdf(
  storageKey: string,
  overrides?: Partial<PdfStoragePaths>,
): Promise<{ pdfBuffer: Buffer; absolutePath: string }> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  const normalizedStorageKey = normalizeStorageKey(storageKey);
  const absolutePath = resolveStoragePath(normalizedStorageKey, paths);
  const pdfBuffer = await readFile(absolutePath);
  return { pdfBuffer, absolutePath };
}
