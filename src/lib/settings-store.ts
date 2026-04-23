import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  getDefaultPdfTableColumns,
  sanitizePdfTableColumns,
} from "@/lib/pdf-table-config";
import {
  isLegacyFallbackLogoDataUrl,
  MAX_LOGO_DATA_URL_LENGTH,
  sanitizeCompanyLogoDataUrl,
} from "@/lib/logo-config";
import { sanitizeCustomServices } from "@/lib/service-catalog";
import {
  formatIbanForDisplay,
  normalizeBicInput,
  validateIbanInput,
} from "@/lib/iban";
import { ensureRuntimeDataDirReady } from "@/server/services/store-runtime-paths";
import { CompanySettings } from "@/types/offer";

const SETTINGS_FILE_NAME = "company-settings.json";
const USER_SETTINGS_TABLE = "user_settings";
const MIN_OFFER_VALIDITY_DAYS = 1;
const MAX_OFFER_VALIDITY_DAYS = 365;
const MIN_INVOICE_PAYMENT_DUE_DAYS = 0;
const MAX_INVOICE_PAYMENT_DUE_DAYS = 365;
const MIN_VAT_RATE = 0;
const MAX_VAT_RATE = 100;
const MAX_TERMS_TEXT_LENGTH = 3000;
const MAX_EU_VAT_NOTICE_TEXT_LENGTH = 2000;
const MAX_BANK_NAME_LENGTH = 120;
const SETTINGS_SETUP_ERROR_CODES = new Set([
  "42P01", // relation does not exist
  "42501", // insufficient privilege / RLS
  "3F000", // invalid schema
  "PGRST204", // unknown column in schema cache
  "PGRST205", // unknown table/view in schema cache
]);

const defaultSettings: CompanySettings = {
  companyName: "",
  ownerName: "",
  companyStreet: "",
  companyPostalCode: "",
  companyCity: "",
  companyEmail: "",
  companyPhone: "",
  companyWebsite: "",
  companyIban: "",
  companyBic: "",
  companyBankName: "",
  ibanVerificationStatus: "not_checked",
  taxNumber: "",
  vatId: "",
  companyCountry: "",
  euVatNoticeText: "",
  includeCustomerVatId: false,
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

export type SettingsStoreContext = {
  supabase?: SupabaseClient | null;
  userId?: string | null;
};

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

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asUpperString(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function asLowerString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isUserSettingsSetupError(error: unknown): boolean {
  const direct = asObject(error);
  const cause = asObject(direct?.cause);

  const codeCandidates = [
    asUpperString(direct?.code),
    asUpperString(cause?.code),
  ].filter(Boolean);
  if (codeCandidates.some((code) => SETTINGS_SETUP_ERROR_CODES.has(code))) {
    return true;
  }

  const messageParts = [
    asLowerString(direct?.message),
    asLowerString(cause?.message),
    asLowerString(cause?.details),
    asLowerString(cause?.hint),
  ].filter(Boolean);
  const haystack = messageParts.join(" | ");
  if (!haystack) {
    return false;
  }

  return (
    haystack.includes("user_settings") ||
    haystack.includes("could not find the table") ||
    haystack.includes("schema cache") ||
    haystack.includes("permission denied")
  );
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

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
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

function resolveBooleanUpdate(current: boolean, value: unknown): boolean {
  if (typeof value === "undefined") {
    return current;
  }
  return typeof value === "boolean" ? value : current;
}

function resolveContextUserId(context?: SettingsStoreContext): string | null {
  const userId = context?.userId;
  if (typeof userId !== "string") {
    return null;
  }

  const trimmedUserId = userId.trim();
  return trimmedUserId || null;
}

function canUseSupabaseContext(
  context?: SettingsStoreContext,
): context is { supabase: SupabaseClient; userId: string } {
  const userId = resolveContextUserId(context);
  const hasQueryBuilder =
    typeof (context?.supabase as { from?: unknown } | undefined)?.from ===
    "function";

  return Boolean(userId && context?.supabase && hasQueryBuilder);
}

function parseRawSettingsPayload(
  raw:
    | (Partial<CompanySettings> & {
        pdfTableColumns?: unknown;
        customServices?: unknown;
      })
    | null,
): CompanySettings {
  if (!raw) {
    return cloneDefaultSettings();
  }

  return resolveSettingsPayload(raw);
}

function buildNextSettings(
  current: CompanySettings,
  payload: Partial<CompanySettings>,
): CompanySettings {
  const nextLogoRaw = sanitizeCompanyLogoDataUrl(
    resolveStringUpdate(current.logoDataUrl, payload.logoDataUrl),
  );
  const nextLogo =
    nextLogoRaw.length <= MAX_LOGO_DATA_URL_LENGTH ? nextLogoRaw : current.logoDataUrl;
  const nextIban = formatIbanForDisplay(
    resolveStringUpdate(current.companyIban, payload.companyIban),
  );
  const nextIbanValidation = validateIbanInput(nextIban);
  const nextIbanVerificationStatus = nextIbanValidation.isValid
    ? "valid"
    : "not_checked";
  const nextBic = normalizeBicInput(
    resolveStringUpdate(current.companyBic, payload.companyBic),
  );
  const nextBankName = resolveStringUpdate(
    current.companyBankName,
    payload.companyBankName,
  ).slice(0, MAX_BANK_NAME_LENGTH);

  return {
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
    companyIban: nextIban,
    companyBic: nextBic,
    companyBankName: nextBankName,
    ibanVerificationStatus: nextIbanVerificationStatus,
    taxNumber: resolveStringUpdate(current.taxNumber, payload.taxNumber),
    vatId: resolveStringUpdate(current.vatId, payload.vatId),
    companyCountry: resolveStringUpdate(
      current.companyCountry,
      payload.companyCountry,
    ),
    euVatNoticeText:
      typeof payload.euVatNoticeText === "undefined"
        ? current.euVatNoticeText
        : String(payload.euVatNoticeText)
            .trim()
            .slice(0, MAX_EU_VAT_NOTICE_TEXT_LENGTH),
    includeCustomerVatId: resolveBooleanUpdate(
      current.includeCustomerVatId,
      payload.includeCustomerVatId,
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
  const resolvedCompanyIban = formatIbanForDisplay(
    asTrimmedString(parsed.companyIban, defaultSettings.companyIban),
  );
  const resolvedIbanValidation = validateIbanInput(resolvedCompanyIban);
  const resolvedIbanStatus =
    parsed.ibanVerificationStatus === "valid" && resolvedIbanValidation.isValid
      ? "valid"
      : "not_checked";

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
    companyIban: resolvedCompanyIban,
    companyBic: normalizeBicInput(
      asTrimmedString(parsed.companyBic, defaultSettings.companyBic),
    ),
    companyBankName: asTrimmedString(
      parsed.companyBankName,
      defaultSettings.companyBankName,
    ).slice(0, MAX_BANK_NAME_LENGTH),
    ibanVerificationStatus: resolvedIbanStatus,
    taxNumber: asTrimmedString(parsed.taxNumber, defaultSettings.taxNumber),
    vatId: asTrimmedString(parsed.vatId, defaultSettings.vatId),
    companyCountry: asTrimmedString(
      parsed.companyCountry,
      defaultSettings.companyCountry,
    ),
    euVatNoticeText: asTrimmedString(
      parsed.euVatNoticeText,
      defaultSettings.euVatNoticeText,
    ).slice(0, MAX_EU_VAT_NOTICE_TEXT_LENGTH),
    includeCustomerVatId: asBoolean(
      parsed.includeCustomerVatId,
      defaultSettings.includeCustomerVatId,
    ),
    senderCopyEmail: asTrimmedString(
      parsed.senderCopyEmail,
      defaultSettings.senderCopyEmail,
    ),
    logoDataUrl: sanitizeCompanyLogoDataUrl(
      asTrimmedString(parsed.logoDataUrl, defaultSettings.logoDataUrl),
    ),
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

export async function readSettings(
  context?: SettingsStoreContext,
): Promise<CompanySettings> {
  if (canUseSupabaseContext(context)) {
    const userId = context.userId.trim();
    const { data, error } = await context.supabase
      .from(USER_SETTINGS_TABLE)
      .select("settings_payload")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (isUserSettingsSetupError(error)) {
        const fallback = volatileSettingsCache ?? cloneDefaultSettings();
        volatileSettingsCache = fallback;
        const code = (error as { code?: string }).code ?? "UNKNOWN";
        console.warn(
          `[settings-store] Supabase user_settings nicht vollständig eingerichtet (${code}). Verwende Fallback-Settings im Runtime-Cache.`,
        );
        return fallback;
      }

      const code = (error as { code?: string }).code ?? "UNKNOWN";
      throw new Error(
        `[settings-store] Supabase-Einstellungen konnten nicht geladen werden (${code}).`,
        { cause: error },
      );
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return cloneDefaultSettings();
    }

    const rawPayload = (data as { settings_payload?: unknown }).settings_payload;
    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      return cloneDefaultSettings();
    }

    const parsedSettings = parseRawSettingsPayload(
      rawPayload as Partial<CompanySettings> & {
        pdfTableColumns?: unknown;
        customServices?: unknown;
      },
    );
    volatileSettingsCache = parsedSettings;
    return parsedSettings;
  }

  const { settingsPath } = await resolveSettingsStorePaths();
  const parsed = await readSettingsFile(settingsPath);

  if (!parsed) {
    if (volatileSettingsCache) {
      return volatileSettingsCache;
    }
    return cloneDefaultSettings();
  }

  const resolvedSettings = parseRawSettingsPayload(parsed);
  const parsedLogoDataUrl =
    typeof parsed.logoDataUrl === "string" ? parsed.logoDataUrl.trim() : "";
  if (parsedLogoDataUrl && isLegacyFallbackLogoDataUrl(parsedLogoDataUrl)) {
    try {
      await writeFile(settingsPath, JSON.stringify(resolvedSettings, null, 2), "utf-8");
    } catch (error) {
      if (isReadonlyStorageError(error)) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "UNKNOWN";
        console.warn(
          `[settings-store] Legacy-Logo-Migration konnte nicht geschrieben werden (${code}).`,
        );
      } else {
        throw error;
      }
    }
  }
  volatileSettingsCache = resolvedSettings;
  return resolvedSettings;
}

export async function writeSettings(
  payload: Partial<CompanySettings>,
  context?: SettingsStoreContext,
): Promise<CompanySettings> {
  if (canUseSupabaseContext(context)) {
    const userId = context.userId.trim();
    const current = await readSettings(context);
    const next = buildNextSettings(current, payload);

    const { error } = await context.supabase
      .from(USER_SETTINGS_TABLE)
      .upsert(
        {
          user_id: userId,
          settings_payload: next,
        },
        { onConflict: "user_id" },
      );

    if (error) {
      if (isUserSettingsSetupError(error)) {
        volatileSettingsCache = next;
        const code = (error as { code?: string }).code ?? "UNKNOWN";
        console.warn(
          `[settings-store] Supabase user_settings nicht vollständig eingerichtet (${code}). Schreibe nur in den Runtime-Cache.`,
        );
        return next;
      }

      const code = (error as { code?: string }).code ?? "UNKNOWN";
      throw new Error(
        `[settings-store] Supabase-Einstellungen konnten nicht gespeichert werden (${code}).`,
        { cause: error },
      );
    }

    volatileSettingsCache = next;
    return next;
  }

  const { dataDir, settingsPath } = await resolveSettingsStorePaths();
  const current = await readSettings();
  const next = buildNextSettings(current, payload);

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
