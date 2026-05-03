import {
  DocumentTaxInfo,
  DocumentTaxTreatment,
} from "@/types/offer";

const REVERSE_CHARGE_PATTERNS = [
  /\breverse\s*[- ]?\s*charge\b/i,
  /§\s*13\s*b\s*u\s*stg/i,
  /\bleistungsempf(?:aenger|änger)\s+schuldet\s+die\s+umsatzsteuer\b/i,
  /\bsteuerschuldnerschaft\s+des\s+leistungsempf(?:aengers|ängers)\b/i,
];

const VAT_EXEMPT_PATTERNS = [
  /§\s*19\s*u\s*stg/i,
  /\bumsatzsteuerfrei\b/i,
  /\bsteuerfrei\b/i,
  /\bkeine\s+umsatzsteuer\b/i,
  /\bumsatzsteuer\s+wird\s+nicht\s+berechnet\b/i,
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampVatRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

export function normalizeDocumentTaxTreatment(
  input: unknown,
): DocumentTaxTreatment | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const normalized = normalizeWhitespace(input).toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "reverse_charge" ||
    normalized === "reverse-charge" ||
    normalized === "reverse charge" ||
    normalized === "13b"
  ) {
    return "reverse_charge";
  }

  if (
    normalized === "vat_exempt" ||
    normalized === "vat-exempt" ||
    normalized === "vat exempt" ||
    normalized === "tax_exempt" ||
    normalized === "tax-exempt" ||
    normalized === "tax exempt" ||
    normalized === "steuerfrei" ||
    normalized === "kleinunternehmer"
  ) {
    return "vat_exempt";
  }

  if (
    normalized === "standard" ||
    normalized === "regular" ||
    normalized === "default" ||
    normalized === "unknown"
  ) {
    return "standard";
  }

  return undefined;
}

export function normalizeDocumentTaxInfo(
  input: unknown,
): DocumentTaxInfo | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const record = input as {
    treatment?: unknown;
    mode?: unknown;
    notice?: unknown;
    noticeText?: unknown;
  };
  const treatment =
    normalizeDocumentTaxTreatment(record.treatment) ??
    normalizeDocumentTaxTreatment(record.mode);
  const noticeText =
    typeof record.noticeText === "string"
      ? normalizeWhitespace(record.noticeText)
      : typeof record.notice === "string"
        ? normalizeWhitespace(record.notice)
        : "";

  if (!treatment) {
    return undefined;
  }

  if (treatment === "standard" && !noticeText) {
    return undefined;
  }

  return {
    treatment,
    noticeText: noticeText || undefined,
  };
}

function detectTaxTreatmentFromText(
  text: string | undefined,
): DocumentTaxTreatment | undefined {
  if (!text) {
    return undefined;
  }

  if (REVERSE_CHARGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "reverse_charge";
  }

  if (VAT_EXEMPT_PATTERNS.some((pattern) => pattern.test(text))) {
    return "vat_exempt";
  }

  return undefined;
}

function extractNoticeFromText(
  text: string | undefined,
  treatment: DocumentTaxTreatment,
): string | undefined {
  if (!text) {
    return undefined;
  }

  const normalizedText = text.replace(/\r/g, "");
  const lines = normalizedText
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    for (let size = 3; size >= 1; size -= 1) {
      const candidate = normalizeWhitespace(lines.slice(index, index + size).join(" "));
      if (
        candidate &&
        detectTaxTreatmentFromText(candidate) === treatment
      ) {
        return candidate;
      }
    }
  }

  const paragraphs = normalizedText
    .split(/\n\s*\n/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean);

  const paragraphMatch = paragraphs.find(
    (paragraph) => detectTaxTreatmentFromText(paragraph) === treatment,
  );
  if (paragraphMatch) {
    return paragraphMatch;
  }

  const singleLineText = normalizeWhitespace(normalizedText);
  if (
    singleLineText.length <= 260 &&
    detectTaxTreatmentFromText(singleLineText) === treatment
  ) {
    return singleLineText;
  }

  return undefined;
}

export function detectDocumentTaxInfo(
  text: string | undefined,
): DocumentTaxInfo | undefined {
  const normalizedText = typeof text === "string" ? normalizeWhitespace(text) : "";
  if (!normalizedText) {
    return undefined;
  }

  const treatment = detectTaxTreatmentFromText(normalizedText);
  if (!treatment) {
    return undefined;
  }

  return {
    treatment,
    noticeText: extractNoticeFromText(text, treatment) ?? normalizedText,
  };
}

export function shouldSuppressVatForDocument(
  treatment: DocumentTaxTreatment | undefined,
): boolean {
  return treatment === "reverse_charge" || treatment === "vat_exempt";
}

export function resolveDocumentTax(input: {
  vatRate: number;
  settingsNoticeText?: string;
  documentTax?: DocumentTaxInfo | null;
}): DocumentTaxInfo & { vatRate: number } {
  const normalizedDocumentTax = normalizeDocumentTaxInfo(input.documentTax);
  const detectedDocumentTax =
    normalizedDocumentTax?.noticeText && normalizedDocumentTax.treatment === "standard"
      ? detectDocumentTaxInfo(normalizedDocumentTax.noticeText)
      : undefined;
  const effectiveDocumentTax =
    normalizedDocumentTax && normalizedDocumentTax.treatment !== "standard"
      ? normalizedDocumentTax
      : detectedDocumentTax;
  const settingsTax = detectDocumentTaxInfo(input.settingsNoticeText);
  const effectiveTax = effectiveDocumentTax ?? settingsTax;

  if (!effectiveTax) {
    return {
      treatment: "standard",
      vatRate: clampVatRate(input.vatRate),
    };
  }

  return {
    treatment: effectiveTax.treatment,
    noticeText: effectiveTax.noticeText,
    vatRate: shouldSuppressVatForDocument(effectiveTax.treatment)
      ? 0
      : clampVatRate(input.vatRate),
  };
}

export function buildDocumentTaxLabel(input: {
  treatment: DocumentTaxTreatment;
  vatRate: number;
}): string {
  if (input.treatment === "reverse_charge") {
    return "Keine MwSt. (Reverse-Charge)";
  }

  if (input.treatment === "vat_exempt") {
    return "Keine MwSt.";
  }

  return `MwSt. (${input.vatRate.toFixed(input.vatRate % 1 === 0 ? 0 : 1)}%)`;
}

export function appendDocumentTaxNotice(
  baseText: string,
  noticeText: string | undefined,
): string {
  const normalizedBase = normalizeWhitespace(baseText);
  const normalizedNotice = normalizeWhitespace(noticeText ?? "");

  if (!normalizedNotice) {
    return normalizedBase;
  }

  if (!normalizedBase) {
    return normalizedNotice;
  }

  const lowerBase = normalizedBase.toLowerCase();
  const lowerNotice = normalizedNotice.toLowerCase();
  if (lowerBase.includes(lowerNotice)) {
    return normalizedBase;
  }
  if (lowerNotice.includes(lowerBase)) {
    return normalizedNotice;
  }

  return `${normalizedBase} ${normalizedNotice}`;
}
