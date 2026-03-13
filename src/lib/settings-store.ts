import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDefaultPdfTableColumns, sanitizePdfTableColumns } from "@/lib/pdf-table-config";
import { sanitizeCustomServices } from "@/lib/service-catalog";
import { CompanySettings } from "@/types/offer";

const dataDir = path.join(process.cwd(), "data");
const settingsPath = path.join(dataDir, "company-settings.json");
const MAX_LOGO_DATA_URL_LENGTH = 2_000_000;
const MIN_OFFER_VALIDITY_DAYS = 1;
const MAX_OFFER_VALIDITY_DAYS = 365;
const MIN_VAT_RATE = 0;
const MAX_VAT_RATE = 100;
const MAX_TERMS_TEXT_LENGTH = 3000;

const defaultSettings: CompanySettings = {
  companyName: "Musterbetrieb GmbH",
  ownerName: "Max Mustermann",
  companyStreet: "Musterstraße 1",
  companyPostalCode: "10115",
  companyCity: "Berlin",
  companyEmail: "info@musterbetrieb.de",
  companyPhone: "+49 30 123456",
  companyWebsite: "www.musterbetrieb.de",
  senderCopyEmail: "",
  logoDataUrl: "",
  pdfTableColumns: getDefaultPdfTableColumns(),
  customServices: [],
  vatRate: 19,
  offerValidityDays: 30,
  offerTermsText:
    "Dieses Angebot basiert auf den aktuell gültigen Materialpreisen. Änderungen durch unvorhergesehene Baustellenbedingungen bleiben vorbehalten."
};

function asTrimmedString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function getDefaultSettings(): CompanySettings {
  return defaultSettings;
}

export async function readSettings(): Promise<CompanySettings> {
  try {
    const file = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(file) as Partial<CompanySettings> & {
      pdfTableColumns?: unknown;
      customServices?: unknown;
    };

    const [legacyPostalCode, ...legacyCityParts] = (parsed.companyPostalCity ?? "").trim().split(/\s+/);
    const legacyCity = legacyCityParts.join(" ").trim();

    return {
      companyName: asTrimmedString(parsed.companyName, defaultSettings.companyName),
      ownerName: asTrimmedString(parsed.ownerName, defaultSettings.ownerName),
      companyStreet: asTrimmedString(parsed.companyStreet, defaultSettings.companyStreet),
      companyPostalCode:
        asTrimmedString(parsed.companyPostalCode) || legacyPostalCode || defaultSettings.companyPostalCode,
      companyCity: asTrimmedString(parsed.companyCity) || legacyCity || defaultSettings.companyCity,
      companyEmail: asTrimmedString(parsed.companyEmail, defaultSettings.companyEmail),
      companyPhone: asTrimmedString(parsed.companyPhone, defaultSettings.companyPhone),
      companyWebsite: asTrimmedString(parsed.companyWebsite, defaultSettings.companyWebsite),
      senderCopyEmail: asTrimmedString(parsed.senderCopyEmail, defaultSettings.senderCopyEmail),
      logoDataUrl: (() => {
        const logo = asTrimmedString(parsed.logoDataUrl, defaultSettings.logoDataUrl);
        return logo.length <= MAX_LOGO_DATA_URL_LENGTH ? logo : "";
      })(),
      pdfTableColumns: sanitizePdfTableColumns(parsed.pdfTableColumns),
      customServices: sanitizeCustomServices(parsed.customServices),
      vatRate: asNumberInRange(parsed.vatRate, defaultSettings.vatRate, MIN_VAT_RATE, MAX_VAT_RATE),
      offerValidityDays: asNumberInRange(
        parsed.offerValidityDays,
        defaultSettings.offerValidityDays,
        MIN_OFFER_VALIDITY_DAYS,
        MAX_OFFER_VALIDITY_DAYS
      ),
      offerTermsText: asTrimmedString(parsed.offerTermsText, defaultSettings.offerTermsText).slice(0, MAX_TERMS_TEXT_LENGTH)
    };
  } catch {
    return defaultSettings;
  }
}

export async function writeSettings(payload: Partial<CompanySettings>): Promise<CompanySettings> {
  const current = await readSettings();
  const payloadLogo = asTrimmedString(payload.logoDataUrl, current.logoDataUrl);
  const payloadPdfTableColumns =
    typeof payload.pdfTableColumns === "undefined"
      ? current.pdfTableColumns
      : sanitizePdfTableColumns(payload.pdfTableColumns);
  const payloadCustomServices =
    typeof payload.customServices === "undefined"
      ? current.customServices
      : sanitizeCustomServices(payload.customServices);
  const payloadVatRate = asNumberInRange(payload.vatRate, current.vatRate, MIN_VAT_RATE, MAX_VAT_RATE);
  const payloadOfferValidityDays = asNumberInRange(
    payload.offerValidityDays,
    current.offerValidityDays,
    MIN_OFFER_VALIDITY_DAYS,
    MAX_OFFER_VALIDITY_DAYS
  );
  const payloadOfferTermsText = asTrimmedString(payload.offerTermsText, current.offerTermsText).slice(
    0,
    MAX_TERMS_TEXT_LENGTH
  );
  const next = {
    ...current,
    ...payload,
    logoDataUrl: payloadLogo.length <= MAX_LOGO_DATA_URL_LENGTH ? payloadLogo : "",
    pdfTableColumns: payloadPdfTableColumns,
    customServices: payloadCustomServices,
    vatRate: payloadVatRate,
    offerValidityDays: payloadOfferValidityDays,
    offerTermsText: payloadOfferTermsText,
    companyPostalCity: undefined
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(next, null, 2), "utf-8");

  return next;
}
