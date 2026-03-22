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

// Legacy hardcoded fallback logo that used to be injected in PDFs.
export const LEGACY_VISIORO_FALLBACK_LOGO_DATA_URL =
  "data:image/svg+xml;base64,CjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB3aWR0aD0iMjEwIiBoZWlnaHQ9IjQ4IiB2aWV3Qm94PSIwIDAgMjEwIDQ4IiBmaWxsPSJub25lIj4KICA8cmVjdCB4PSIwLjc1IiB5PSIwLjc1IiB3aWR0aD0iNDYuNSIgaGVpZ2h0PSI0Ni41IiByeD0iMTIiIGZpbGw9IiMzRjZGQjIiIHN0cm9rZT0iIzJCNEY4NSIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICA8cGF0aCBkPSJNMTMgMTRMMjQgMzRMMzUgMTQiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iNC41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KICA8dGV4dCB4PSI1OCIgeT0iMzEiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjIzIiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjMkI0Rjg1Ij5WaXNpb3JvPC90ZXh0Pgo8L3N2Zz4K";

export function isLegacyFallbackLogoDataUrl(value: string): boolean {
  return value.trim() === LEGACY_VISIORO_FALLBACK_LOGO_DATA_URL;
}

export function sanitizeCompanyLogoDataUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return isLegacyFallbackLogoDataUrl(trimmed) ? "" : trimmed;
}
