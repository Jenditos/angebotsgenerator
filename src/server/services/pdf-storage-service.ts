import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  ensureRuntimeDataDirReady,
  resolveRuntimeDataDir,
} from "@/server/services/store-runtime-paths";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/supabase/config";
import { StoredPdfReference } from "@/types/offer";

type PdfStorageProvider = "local" | "supabase";

type PdfStoragePaths = {
  dataDir: string;
  pdfDir: string;
  provider: PdfStorageProvider;
  supabaseBucket: string;
};

export type SaveDocumentPdfInput = {
  documentNumber: string;
  pdfBuffer: Buffer;
};

export type StoredDocumentPdf = StoredPdfReference & {
  absolutePath?: string;
  reused: boolean;
};

const PDF_STORAGE_DIR_NAME = "document-pdfs";
const PDF_CONTENT_TYPE = "application/pdf";
const DEFAULT_SUPABASE_BUCKET = "document-pdfs";

function resolveConfiguredProvider(
  overrides?: Partial<PdfStoragePaths>,
): PdfStorageProvider {
  if (overrides?.provider) {
    return overrides.provider;
  }

  if (overrides?.dataDir || overrides?.pdfDir) {
    return "local";
  }

  return process.env.DOCUMENT_PDF_STORAGE_PROVIDER === "supabase"
    ? "supabase"
    : "local";
}

function resolveSupabaseBucket(overrides?: Partial<PdfStoragePaths>): string {
  return (
    overrides?.supabaseBucket?.trim() ||
    process.env.DOCUMENT_PDF_SUPABASE_BUCKET?.trim() ||
    DEFAULT_SUPABASE_BUCKET
  );
}

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
    provider: resolveConfiguredProvider(overrides),
    supabaseBucket: resolveSupabaseBucket(overrides),
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

function assertSafeSupabaseStorageKey(storageKey: string): void {
  const normalized = normalizeStorageKey(storageKey);
  if (
    !normalized ||
    normalized !== storageKey ||
    normalized.includes("..") ||
    path.isAbsolute(normalized) ||
    !normalized.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Ungueltiger Supabase-PDF-Speicherschluessel.");
  }
}

function buildLocalStorageKey(documentNumber: string): string {
  const safeDocumentNumber = toSafeFilename(documentNumber);
  if (!safeDocumentNumber) {
    throw new Error("Dokumentnummer fuer PDF-Speicherung fehlt.");
  }

  return `${PDF_STORAGE_DIR_NAME}/${safeDocumentNumber}.pdf`;
}

function buildSupabaseStorageKey(documentNumber: string): string {
  const safeDocumentNumber = toSafeFilename(documentNumber);
  if (!safeDocumentNumber) {
    throw new Error("Dokumentnummer fuer PDF-Speicherung fehlt.");
  }

  return `${safeDocumentNumber}.pdf`;
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
  if (resolveConfiguredProvider(overrides) === "supabase") {
    return;
  }

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
    storageProvider: "local",
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

async function saveDocumentPdfLocally(
  input: SaveDocumentPdfInput,
  overrides?: Partial<PdfStoragePaths>,
): Promise<StoredDocumentPdf> {
  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  await mkdir(paths.pdfDir, { recursive: true });

  const filename = `${toSafeFilename(input.documentNumber)}.pdf`;
  const storageKey = buildLocalStorageKey(input.documentNumber);
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

async function downloadSupabasePdf(input: {
  bucket: string;
  storageKey: string;
}): Promise<Buffer | null> {
  assertSafeSupabaseStorageKey(input.storageKey);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(input.bucket)
    .download(input.storageKey);

  if (error || !data) {
    return null;
  }

  return Buffer.from(await data.arrayBuffer());
}

async function saveDocumentPdfToSupabase(
  input: SaveDocumentPdfInput,
  overrides?: Partial<PdfStoragePaths>,
): Promise<StoredDocumentPdf> {
  const paths = resolvePaths(overrides);
  if (!isSupabaseAdminConfigured()) {
    throw new Error(
      "Supabase PDF-Speicher ist aktiviert, aber SUPABASE_SERVICE_ROLE_KEY fehlt.",
    );
  }

  const filename = `${toSafeFilename(input.documentNumber)}.pdf`;
  const storageKey = buildSupabaseStorageKey(input.documentNumber);
  const existingPdf = await downloadSupabasePdf({
    bucket: paths.supabaseBucket,
    storageKey,
  });
  const now = new Date().toISOString();

  if (existingPdf) {
    return {
      storageProvider: "supabase",
      bucket: paths.supabaseBucket,
      storageKey,
      filename,
      contentType: PDF_CONTENT_TYPE,
      byteLength: existingPdf.byteLength,
      createdAt: now,
      updatedAt: now,
      reused: true,
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from(paths.supabaseBucket)
    .upload(storageKey, input.pdfBuffer, {
      contentType: PDF_CONTENT_TYPE,
      upsert: false,
    });

  if (error) {
    const raceExistingPdf = await downloadSupabasePdf({
      bucket: paths.supabaseBucket,
      storageKey,
    });
    if (raceExistingPdf) {
      return {
        storageProvider: "supabase",
        bucket: paths.supabaseBucket,
        storageKey,
        filename,
        contentType: PDF_CONTENT_TYPE,
        byteLength: raceExistingPdf.byteLength,
        createdAt: now,
        updatedAt: now,
        reused: true,
      };
    }

    throw error;
  }

  return {
    storageProvider: "supabase",
    bucket: paths.supabaseBucket,
    storageKey,
    filename,
    contentType: PDF_CONTENT_TYPE,
    byteLength: input.pdfBuffer.byteLength,
    createdAt: now,
    updatedAt: now,
    reused: false,
  };
}

export async function saveDocumentPdf(
  input: SaveDocumentPdfInput,
  overrides?: Partial<PdfStoragePaths>,
): Promise<StoredDocumentPdf> {
  if (!Buffer.isBuffer(input.pdfBuffer) || input.pdfBuffer.byteLength === 0) {
    throw new Error("PDF-Inhalt fuer Speicherung fehlt.");
  }

  const provider = resolveConfiguredProvider(overrides);
  if (provider === "supabase") {
    return saveDocumentPdfToSupabase(input, overrides);
  }

  return saveDocumentPdfLocally(input, overrides);
}

export async function readStoredDocumentPdf(
  reference: StoredPdfReference | string,
  overrides?: Partial<PdfStoragePaths>,
): Promise<{ pdfBuffer: Buffer; absolutePath?: string }> {
  const storageKey =
    typeof reference === "string" ? reference : reference.storageKey;
  const provider =
    typeof reference === "string"
      ? resolveConfiguredProvider(overrides)
      : reference.storageProvider ?? "local";

  if (provider === "supabase") {
    if (!isSupabaseAdminConfigured()) {
      throw new Error(
        "Supabase PDF-Speicher ist aktiviert, aber SUPABASE_SERVICE_ROLE_KEY fehlt.",
      );
    }

    const paths = resolvePaths(overrides);
    const bucket =
      typeof reference === "string"
        ? paths.supabaseBucket
        : reference.bucket || paths.supabaseBucket;
    const pdfBuffer = await downloadSupabasePdf({
      bucket,
      storageKey: normalizeStorageKey(storageKey),
    });
    if (!pdfBuffer) {
      throw new Error("PDF konnte nicht aus Supabase Storage geladen werden.");
    }

    return { pdfBuffer };
  }

  await ensureRuntimeDataDirIfNeeded(overrides);
  const paths = resolvePaths(overrides);
  const normalizedStorageKey = normalizeStorageKey(storageKey);
  const absolutePath = resolveStoragePath(normalizedStorageKey, paths);
  const pdfBuffer = await readFile(absolutePath);
  return { pdfBuffer, absolutePath };
}
