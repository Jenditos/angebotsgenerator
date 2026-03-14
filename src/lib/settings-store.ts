import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CompanySettings } from "@/types/offer";

const dataDir = path.join(process.cwd(), "data");
const settingsPath = path.join(dataDir, "company-settings.json");
const MAX_LOGO_DATA_URL_LENGTH = 2_000_000;

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
  startOfferNumber: "",
  lastOfferNumber: "",
  offerNumberFallbackCounter: 0,
  customServiceTypes: []
};

function asTrimmedString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}


function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((item) => asTrimmedString(item)).filter(Boolean)));
}

export function getDefaultSettings(): CompanySettings {
  return defaultSettings;
}

export async function readSettings(): Promise<CompanySettings> {
  try {
    const file = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(file) as Partial<CompanySettings>;

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
      startOfferNumber: asTrimmedString(parsed.startOfferNumber, defaultSettings.startOfferNumber),
      lastOfferNumber: asTrimmedString(parsed.lastOfferNumber, defaultSettings.lastOfferNumber),
      offerNumberFallbackCounter: asNumber(parsed.offerNumberFallbackCounter, defaultSettings.offerNumberFallbackCounter),
      customServiceTypes: asStringArray(parsed.customServiceTypes),
      logoDataUrl: (() => {
        const logo = asTrimmedString(parsed.logoDataUrl, defaultSettings.logoDataUrl);
        return logo.length <= MAX_LOGO_DATA_URL_LENGTH ? logo : "";
      })()
    };
  } catch {
    return defaultSettings;
  }
}

export async function writeSettings(payload: Partial<CompanySettings>): Promise<CompanySettings> {
  const current = await readSettings();
  const payloadLogo = asTrimmedString(payload.logoDataUrl, current.logoDataUrl);
  const next = {
    ...current,
    ...payload,
    startOfferNumber: asTrimmedString(payload.startOfferNumber, current.startOfferNumber),
    lastOfferNumber: asTrimmedString(payload.lastOfferNumber, current.lastOfferNumber),
    offerNumberFallbackCounter: asNumber(payload.offerNumberFallbackCounter, current.offerNumberFallbackCounter),
    customServiceTypes: payload.customServiceTypes ? asStringArray(payload.customServiceTypes) : current.customServiceTypes,
    logoDataUrl: payloadLogo.length <= MAX_LOGO_DATA_URL_LENGTH ? payloadLogo : "",
    companyPostalCity: undefined
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(next, null, 2), "utf-8");

  return next;
}
