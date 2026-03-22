import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getDefaultPdfTableColumns,
  sanitizePdfTableColumns,
} from "@/lib/pdf-table-config";
import { MAX_LOGO_DATA_URL_LENGTH } from "@/lib/logo-config";
import { sanitizeCustomServices } from "@/lib/service-catalog";
import { ensureRuntimeDataDirReady } from "@/server/services/store-runtime-paths";
import { CompanySettings } from "@/types/offer";

const SETTINGS_FILE_NAME = "company-settings.json";
const MIN_OFFER_VALIDITY_DAYS = 1;
const MAX_OFFER_VALIDITY_DAYS = 365;
const MIN_INVOICE_PAYMENT_DUE_DAYS = 0;
const MAX_INVOICE_PAYMENT_DUE_DAYS = 365;
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
  invoicePaymentDueDays: 14,
  offerTermsText:
    "Dieses Angebot basiert auf den aktuell gültigen Materialpreisen. Änderungen durch unvorhergesehene Baustellenbedingungen bleiben vorbehalten.",
  lastOfferNumber: "",
  lastInvoiceNumber: "",
  customServiceTypes: [],
};

let volatileSettingsCache: CompanySettings | null = null;

function cloneDefaultSettings(): CompanySettings {
  return {
    ...defaultSettings,
    pdfTableColumns: getDefaultPdfTableColumns(),
    customServices: [],
    customServiceTypes: [],
  };
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT";
}

function isReadonlyStorageError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EROFS" || code === "EACCES" || code === "EPERM";
}

function asTrimmedString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function asNumberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map((item) => asTrimmedString(item)).filter(Boolean)),
  );
}

function resolveStringUpdate(current: string, value: unknown): string {
  if (typeof value !== "string") {
    return current;
  }
  return value.trim();
}

function resolveNumberUpdate(
  current: number,
  value: unknown,
  min: number,
  max: number,
): number {
  if (typeof value === "undefined") {
    return current;
  }
  return asNumberInRange(value, current, min, max);
}

async function resolveSettingsStorePaths(): Promise<{
  dataDir: string;
  settingsPath: string;
}> {
  const dataDir = await ensureRuntimeDataDirReady();
  return {
    dataDir,
    settingsPath: path.join(dataDir, SETTINGS_FILE_NAME),
  };
}

async function readSettingsFile(
  settingsPath: string,
): Promise<
  (Partial<CompanySettings> & {
    pdfTableColumns?: unknown;
    customServices?: unknown;
  }) | null
> {
  let fileContents: string;
  try {
    fileContents = await readFile(settingsPath, "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(fileContents);
  } catch (error) {
    throw new Error(
      `[settings-store] Einstellungen sind keine gültige JSON-Datei: ${settingsPath}`,
      { cause: error },
    );
  }

  if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) {
    throw new Error(
      `[settings-store] Unerwartetes Format in Einstellungen: ${settingsPath}`,
    );
  }

  return parsedUnknown as Partial<CompanySettings> & {
    pdfTableColumns?: unknown;
    customServices?: unknown;
  };
}

function resolveSettingsPayload(
  parsed: Partial<CompanySettings> & {
    pdfTableColumns?: unknown;
    customServices?: unknown;
  },
): CompanySettings {
  const [legacyPostalCode, ...legacyCityParts] = (
    parsed.companyPostalCity ?? ""
  )
    .trim()
    .split(/\s+/);
  const legacyCity = legacyCityParts.join(" ").trim();

  return {
    companyName: asTrimmedString(parsed.companyName, defaultSettings.companyName),
    ownerName: asTrimmedString(parsed.ownerName, defaultSettings.ownerName),
    companyStreet: asTrimmedString(
      parsed.companyStreet,
      defaultSettings.companyStreet,
    ),
    companyPostalCode:
      asTrimmedString(parsed.companyPostalCode) ||
      legacyPostalCode ||
      defaultSettings.companyPostalCode,
    companyCity:
      asTrimmedString(parsed.companyCity) || legacyCity || defaultSettings.companyCity,
    companyEmail: asTrimmedString(parsed.companyEmail, defaultSettings.companyEmail),
    companyPhone:
      typeof parsed.companyPhone === "string"
        ? parsed.companyPhone.trim()
        : defaultSettings.companyPhone,
    companyWebsite:
      typeof parsed.companyWebsite === "string"
        ? parsed.companyWebsite.trim()
        : defaultSettings.companyWebsite,
    senderCopyEmail: asTrimmedString(
      parsed.senderCopyEmail,
      defaultSettings.senderCopyEmail,
    ),
    logoDataUrl: asTrimmedString(parsed.logoDataUrl, defaultSettings.logoDataUrl),
    pdfTableColumns: sanitizePdfTableColumns(parsed.pdfTableColumns),
    customServices: sanitizeCustomServices(parsed.customServices),
    vatRate: asNumberInRange(
      parsed.vatRate,
      defaultSettings.vatRate,
      MIN_VAT_RATE,
      MAX_VAT_RATE,
    ),
    offerValidityDays: asNumberInRange(
      parsed.offerValidityDays,
      defaultSettings.offerValidityDays,
      MIN_OFFER_VALIDITY_DAYS,
      MAX_OFFER_VALIDITY_DAYS,
    ),
    invoicePaymentDueDays: asNumberInRange(
      parsed.invoicePaymentDueDays,
      defaultSettings.invoicePaymentDueDays,
      MIN_INVOICE_PAYMENT_DUE_DAYS,
      MAX_INVOICE_PAYMENT_DUE_DAYS,
    ),
    offerTermsText: asTrimmedString(
      parsed.offerTermsText,
      defaultSettings.offerTermsText,
    ).slice(0, MAX_TERMS_TEXT_LENGTH),
    lastOfferNumber: asTrimmedString(
      parsed.lastOfferNumber,
      defaultSettings.lastOfferNumber,
    ),
    lastInvoiceNumber: asTrimmedString(
      parsed.lastInvoiceNumber,
      defaultSettings.lastInvoiceNumber,
    ),
    customServiceTypes: asStringArray(parsed.customServiceTypes),
  };
}

export function getDefaultSettings(): CompanySettings {
  return cloneDefaultSettings();
}

export async function readSettings(): Promise<CompanySettings> {
  const { settingsPath } = await resolveSettingsStorePaths();
  const parsed = await readSettingsFile(settingsPath);

  if (!parsed) {
    if (volatileSettingsCache) {
      return volatileSettingsCache;
    }
    return cloneDefaultSettings();
  }

  const resolvedSettings = resolveSettingsPayload(parsed);
  volatileSettingsCache = resolvedSettings;
  return resolvedSettings;
}

export async function writeSettings(
  payload: Partial<CompanySettings>,
): Promise<CompanySettings> {
  const { dataDir, settingsPath } = await resolveSettingsStorePaths();
  const current = await readSettings();

  const nextLogoRaw = resolveStringUpdate(current.logoDataUrl, payload.logoDataUrl);
  const nextLogo =
    nextLogoRaw.length <= MAX_LOGO_DATA_URL_LENGTH ? nextLogoRaw : current.logoDataUrl;

  const next: CompanySettings = {
    companyName: resolveStringUpdate(current.companyName, payload.companyName),
    ownerName: resolveStringUpdate(current.ownerName, payload.ownerName),
    companyStreet: resolveStringUpdate(current.companyStreet, payload.companyStreet),
    companyPostalCode: resolveStringUpdate(
      current.companyPostalCode,
      payload.companyPostalCode,
    ),
    companyCity: resolveStringUpdate(current.companyCity, payload.companyCity),
    companyEmail: resolveStringUpdate(current.companyEmail, payload.companyEmail),
    companyPhone: resolveStringUpdate(current.companyPhone, payload.companyPhone),
    companyWebsite: resolveStringUpdate(
      current.companyWebsite,
      payload.companyWebsite,
    ),
    senderCopyEmail: resolveStringUpdate(
      current.senderCopyEmail,
      payload.senderCopyEmail,
    ),
    logoDataUrl: nextLogo,
    pdfTableColumns:
      typeof payload.pdfTableColumns === "undefined"
        ? current.pdfTableColumns
        : sanitizePdfTableColumns(payload.pdfTableColumns),
    customServices:
      typeof payload.customServices === "undefined"
        ? current.customServices
        : sanitizeCustomServices(payload.customServices),
    vatRate: resolveNumberUpdate(
      current.vatRate,
      payload.vatRate,
      MIN_VAT_RATE,
      MAX_VAT_RATE,
    ),
    offerValidityDays: resolveNumberUpdate(
      current.offerValidityDays,
      payload.offerValidityDays,
      MIN_OFFER_VALIDITY_DAYS,
      MAX_OFFER_VALIDITY_DAYS,
    ),
    invoicePaymentDueDays: resolveNumberUpdate(
      current.invoicePaymentDueDays,
      payload.invoicePaymentDueDays,
      MIN_INVOICE_PAYMENT_DUE_DAYS,
      MAX_INVOICE_PAYMENT_DUE_DAYS,
    ),
    offerTermsText:
      typeof payload.offerTermsText === "undefined"
        ? current.offerTermsText
        : String(payload.offerTermsText).trim().slice(0, MAX_TERMS_TEXT_LENGTH),
    lastOfferNumber: resolveStringUpdate(
      current.lastOfferNumber,
      payload.lastOfferNumber,
    ),
    lastInvoiceNumber: resolveStringUpdate(
      current.lastInvoiceNumber,
      payload.lastInvoiceNumber,
    ),
    customServiceTypes:
      typeof payload.customServiceTypes === "undefined"
        ? current.customServiceTypes
        : asStringArray(payload.customServiceTypes),
  };

  volatileSettingsCache = next;
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(next, null, 2), "utf-8");
  } catch (error) {
    if (isReadonlyStorageError(error)) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
      console.warn(
        `[settings-store] Persistente Speicherung nicht verfügbar (${code}). Verwende flüchtigen Runtime-Cache.`,
      );
    } else {
      throw error;
    }
  }

  return next;
}
