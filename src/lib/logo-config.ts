export const ALLOWED_LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

export const ALLOWED_LOGO_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
] as const;

export const LOGO_UPLOAD_ACCEPT_ATTRIBUTE = [
  ...ALLOWED_LOGO_EXTENSIONS,
  ...ALLOWED_LOGO_MIME_TYPES,
].join(",");

export const LOGO_ALLOWED_FORMATS_LABEL = "PNG, JPG, JPEG, WEBP, SVG";

export const MAX_LOGO_UPLOAD_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_LOGO_DATA_URL_LENGTH = 6_000_000;
export const MAX_LOGO_RENDER_EDGE_PX = 1800;

export const MAX_LOGO_UPLOAD_FILE_MB = Math.floor(
  MAX_LOGO_UPLOAD_FILE_BYTES / (1024 * 1024),
);

export function isSupportedLogoMimeType(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ALLOWED_LOGO_MIME_TYPES.includes(
    normalized as (typeof ALLOWED_LOGO_MIME_TYPES)[number],
  );
}

export function hasSupportedLogoExtension(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return ALLOWED_LOGO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function sanitizeCompanyLogoDataUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed || "";
}
