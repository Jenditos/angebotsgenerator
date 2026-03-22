"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MouseEvent as ReactMouseEvent,
  FormEvent,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getSeedServices,
  hasServiceLabel,
  normalizeSearchValue,
  searchServices,
} from "@/lib/service-catalog";
import { getDefaultPdfTableColumns } from "@/lib/pdf-table-config";
import {
  CompanySettings,
  CustomerDraftGroup,
  DocumentType,
  OfferPositionInput,
  ServiceCatalogItem,
  StoredCustomerRecord,
} from "@/types/offer";

type OfferText = {
  subject: string;
  intro: string;
  details: string;
  closing: string;
};

type ApiResponse = {
  offer: OfferText;
  mailText: string;
  pdfBase64: string;
  emailStatus: "not_requested" | "sent" | "not_configured" | "failed";
  emailInfo: string;
  customerNumber?: string;
  documentType?: DocumentType;
  documentNumber?: string;
  offerNumber?: string;
  invoiceNumber?: string;
};

type EmailDraftApiResponse =
  | { ok: true; info: string; composeUrl: string; draftId?: string }
  | { ok: false; reason: "not_connected" | "failed"; info: string };

type CustomersApiResponse = {
  customers?: StoredCustomerRecord[];
  error?: string;
};

type DeleteCustomerApiResponse = {
  ok?: boolean;
  error?: string;
};

type ServicesApiResponse = {
  services?: ServiceCatalogItem[];
  error?: string;
};

type SettingsApiResponse = {
  settings?: CompanySettings;
  error?: string;
};

type CustomerArchiveDocument = {
  documentNumber: string;
  documentType: DocumentType;
  customerNumber?: string | null;
  customerName: string;
  createdAt: string;
};

type CustomerDocumentsApiResponse = {
  documents?: CustomerArchiveDocument[];
  error?: string;
};

type ParsedVoiceFields = {
  positions?: ParsedVoicePosition[];
  customerType?: "person" | "company";
  companyName?: string;
  salutation?: "herr" | "frau";
  firstName?: string;
  lastName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  customerEmail?: string;
  serviceDescription?: string;
  hours?: number;
  hourlyRate?: number;
  materialCost?: number;
};

type ParsedVoicePosition = {
  group?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
};

type VoiceParseResponse = {
  fields: ParsedVoiceFields;
  missingFields: string[];
  missingFieldKeys?: string[];
  shouldAutofillServiceDescription?: boolean;
  usedFallback: boolean;
  fallbackReason?: "no_api_key" | "model_error" | null;
};

type NominatimItem = {
  display_name?: string;
  address?: {
    road?: string;
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
  };
};

type AddressSuggestion = {
  street: string;
  postalCode: string;
  city: string;
  primary: string;
  secondary: string;
};

type ServiceSubitemEntry = {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  price: string;
};

type SelectedServiceEntry = {
  id: string;
  label: string;
  subitems: ServiceSubitemEntry[];
};

type OfferForm = {
  customerType: "person" | "company";
  companyName: string;
  salutation: "herr" | "frau";
  firstName: string;
  lastName: string;
  street: string;
  postalCode: string;
  city: string;
  customerEmail: string;
  serviceDescription: string;
  hours: string;
  hourlyRate: string;
  materialCost: string;
  invoiceDate: string;
  serviceDate: string;
  paymentDueDays: string;
};

type DocumentMode = DocumentType;

type ServiceDateRangeValue = {
  startDate: string;
  endDate: string;
};

type ServiceDateCalendarDay = {
  dateValue: string;
  dayNumber: number;
  inCurrentMonth: boolean;
};

function todayDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateInputValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toMonthStartValue(dateValue: string): string {
  if (!isDateInputValue(dateValue)) {
    return `${todayDateInputValue().slice(0, 7)}-01`;
  }
  return `${dateValue.slice(0, 7)}-01`;
}

function shiftMonthValue(monthStartValue: string, offset: number): string {
  if (!isDateInputValue(monthStartValue)) {
    return toMonthStartValue(todayDateInputValue());
  }

  const year = Number(monthStartValue.slice(0, 4));
  const month = Number(monthStartValue.slice(5, 7));
  const nextMonth = new Date(year, month - 1 + offset, 1);
  return toDateInputValue(nextMonth);
}

function formatGermanDate(dateValue: string): string {
  if (!isDateInputValue(dateValue)) {
    return "";
  }

  const [year, month, day] = dateValue.split("-");
  return `${day}.${month}.${year}`;
}

function formatServiceDateRangeValue(
  startDate: string,
  endDate: string,
): string {
  const start = formatGermanDate(startDate);
  const end = formatGermanDate(endDate);
  if (!start || !end) {
    return "";
  }
  return `${start} – ${end}`;
}

function parseServiceDateRangeValue(
  rawValue: string,
): ServiceDateRangeValue | null {
  const normalized = rawValue.trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(
    /^(\d{2})\.(\d{2})\.(\d{4})\s*[–-]\s*(\d{2})\.(\d{2})\.(\d{4})$/,
  );
  if (!match) {
    return null;
  }

  const startDate = `${match[3]}-${match[2]}-${match[1]}`;
  const endDate = `${match[6]}-${match[5]}-${match[4]}`;
  if (!isDateInputValue(startDate) || !isDateInputValue(endDate)) {
    return null;
  }

  return {
    startDate,
    endDate,
  };
}

function buildServiceDateCalendarDays(
  monthStartValue: string,
): ServiceDateCalendarDay[] {
  if (!isDateInputValue(monthStartValue)) {
    return [];
  }

  const year = Number(monthStartValue.slice(0, 4));
  const month = Number(monthStartValue.slice(5, 7));
  const firstOfMonth = new Date(year, month - 1, 1);
  const weekdayIndex = firstOfMonth.getDay();
  const leadingDays = (weekdayIndex + 6) % 7;
  const gridStart = new Date(year, month - 1, 1 - leadingDays);
  const calendarDays: ServiceDateCalendarDay[] = [];

  for (let dayIndex = 0; dayIndex < 42; dayIndex += 1) {
    const currentDate = new Date(gridStart);
    currentDate.setDate(gridStart.getDate() + dayIndex);
    const currentMonth = currentDate.getMonth() === month - 1;
    calendarDays.push({
      dateValue: toDateInputValue(currentDate),
      dayNumber: currentDate.getDate(),
      inCurrentMonth: currentMonth,
    });
  }

  return calendarDays;
}

function createInitialForm(): OfferForm {
  return {
    customerType: "person",
    companyName: "",
    salutation: "herr",
    firstName: "",
    lastName: "",
    street: "",
    postalCode: "",
    city: "",
    customerEmail: "",
    serviceDescription: "",
    hours: "",
    hourlyRate: "",
    materialCost: "",
    invoiceDate: todayDateInputValue(),
    serviceDate: "",
    paymentDueDays: "14",
  };
}

const initialForm: OfferForm = createInitialForm();

type ModeSnapshot = {
  form: OfferForm;
  activeCustomerNumber: string;
  selectedServices: SelectedServiceEntry[];
  voiceTranscript: string;
  voiceInfo: string;
  voiceError: string;
  voiceMissingFields: string[];
  error: string;
  postActionInfo: string;
  serviceSearch: string;
  isServiceSearchOpen: boolean;
  serviceInfo: string;
  serviceError: string;
  addressSuggestions: AddressSuggestion[];
};

type PersistedHomeState = {
  documentMode: DocumentMode;
  modeSnapshots: Record<DocumentMode, ModeSnapshot>;
};

function cloneSelectedServices(
  services: SelectedServiceEntry[],
): SelectedServiceEntry[] {
  return services.map((service) => ({
    ...service,
    subitems: service.subitems.map((subitem) => ({ ...subitem })),
  }));
}

function createInitialModeSnapshot(): ModeSnapshot {
  return {
    form: createInitialForm(),
    activeCustomerNumber: "",
    selectedServices: [],
    voiceTranscript: "",
    voiceInfo: "",
    voiceError: "",
    voiceMissingFields: [],
    error: "",
    postActionInfo: "",
    serviceSearch: "",
    isServiceSearchOpen: false,
    serviceInfo: "",
    serviceError: "",
    addressSuggestions: [],
  };
}

const VOICE_FIELD_LABELS: Record<string, string> = {
  companyName: "Firma",
  salutation: "Anrede",
  firstName: "Vorname",
  lastName: "Nachname",
  street: "Straße",
  postalCode: "PLZ",
  city: "Ort",
  customerEmail: "Kunden-E-Mail",
  serviceDescription: "Leistung",
  hours: "Stunden",
  hourlyRate: "Stundensatz",
  materialCost: "Materialkosten",
};

const UNIT_OPTIONS = [
  "Stück",
  "m",
  "m²",
  "m³",
  "kg",
  "t",
  "l",
  "Std",
  "Tag",
  "Pauschal",
];

const SERVICE_DATE_WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const DEFAULT_MANUAL_GROUP_LABEL = "Weitere Positionen";
const HOME_STATE_STORAGE_KEY = "visioro-home-state-v1";
const SETTINGS_DRAFT_STORAGE_KEY = "visioro-settings-draft-v1";

const fallbackCompanySettings: CompanySettings = {
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
  customServiceTypes: [],
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hydrateOfferForm(value: unknown): OfferForm {
  const initial = createInitialForm();
  if (!isObjectRecord(value)) {
    return initial;
  }

  return {
    customerType: value.customerType === "company" ? "company" : "person",
    companyName: asString(value.companyName),
    salutation: value.salutation === "frau" ? "frau" : "herr",
    firstName: asString(value.firstName),
    lastName: asString(value.lastName),
    street: asString(value.street),
    postalCode: asString(value.postalCode),
    city: asString(value.city),
    customerEmail: asString(value.customerEmail),
    serviceDescription: asString(value.serviceDescription),
    hours: asString(value.hours),
    hourlyRate: asString(value.hourlyRate),
    materialCost: asString(value.materialCost),
    invoiceDate: asString(value.invoiceDate) || initial.invoiceDate,
    serviceDate: asString(value.serviceDate),
    paymentDueDays: asString(value.paymentDueDays) || initial.paymentDueDays,
  };
}

function hydrateSelectedServices(value: unknown): SelectedServiceEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isObjectRecord(entry)) {
        return null;
      }

      const label =
        capitalizeEntryStart(asString(entry.label)) || DEFAULT_MANUAL_GROUP_LABEL;
      const subitemsRaw = Array.isArray(entry.subitems) ? entry.subitems : [];
      const subitems = subitemsRaw
        .map((subitem) => {
          if (!isObjectRecord(subitem)) {
            return null;
          }
          return {
            id: asString(subitem.id) || createSubitemEntry().id,
            description: capitalizeEntryStart(asString(subitem.description)),
            quantity: sanitizeQuantityInput(asString(subitem.quantity)),
            unit: asString(subitem.unit) || UNIT_OPTIONS[0],
            price: sanitizePriceInput(asString(subitem.price)),
          };
        })
        .filter((subitem): subitem is ServiceSubitemEntry => Boolean(subitem));

      return {
        id: asString(entry.id) || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        subitems: subitems.length > 0 ? subitems : [createSubitemEntry(label)],
      };
    })
    .filter((entry): entry is SelectedServiceEntry => Boolean(entry));
}

function hydrateAddressSuggestions(value: unknown): AddressSuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isObjectRecord(entry)) {
        return null;
      }
      const street = asString(entry.street);
      const postalCode = asString(entry.postalCode);
      const city = asString(entry.city);
      const primary = asString(entry.primary);
      const secondary = asString(entry.secondary);
      if (!street && !postalCode && !city && !primary && !secondary) {
        return null;
      }
      return {
        street,
        postalCode,
        city,
        primary,
        secondary,
      };
    })
    .filter((entry): entry is AddressSuggestion => Boolean(entry));
}

function hydrateModeSnapshot(value: unknown): ModeSnapshot {
  const initial = createInitialModeSnapshot();
  if (!isObjectRecord(value)) {
    return initial;
  }

  return {
    form: hydrateOfferForm(value.form),
    activeCustomerNumber: asString(value.activeCustomerNumber),
    selectedServices: hydrateSelectedServices(value.selectedServices),
    voiceTranscript: asString(value.voiceTranscript),
    voiceInfo: asString(value.voiceInfo),
    voiceError: asString(value.voiceError),
    voiceMissingFields: Array.isArray(value.voiceMissingFields)
      ? value.voiceMissingFields.map((entry) => asString(entry)).filter(Boolean)
      : [],
    error: asString(value.error),
    postActionInfo: asString(value.postActionInfo),
    serviceSearch: asString(value.serviceSearch),
    isServiceSearchOpen: value.isServiceSearchOpen === true,
    serviceInfo: asString(value.serviceInfo),
    serviceError: asString(value.serviceError),
    addressSuggestions: hydrateAddressSuggestions(value.addressSuggestions),
  };
}

function hydratePersistedHomeState(value: unknown): PersistedHomeState | null {
  if (!isObjectRecord(value) || !isObjectRecord(value.modeSnapshots)) {
    return null;
  }

  return {
    documentMode: value.documentMode === "invoice" ? "invoice" : "offer",
    modeSnapshots: {
      offer: hydrateModeSnapshot(value.modeSnapshots.offer),
      invoice: hydrateModeSnapshot(value.modeSnapshots.invoice),
    },
  };
}

function toNumberInRange(
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

function normalizeCompanySettingsInput(value: unknown): CompanySettings | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  return {
    companyName: asString(value.companyName, fallbackCompanySettings.companyName),
    ownerName: asString(value.ownerName, fallbackCompanySettings.ownerName),
    companyStreet: asString(
      value.companyStreet,
      fallbackCompanySettings.companyStreet,
    ),
    companyPostalCode: asString(
      value.companyPostalCode,
      fallbackCompanySettings.companyPostalCode,
    ),
    companyCity: asString(value.companyCity, fallbackCompanySettings.companyCity),
    companyEmail: asString(
      value.companyEmail,
      fallbackCompanySettings.companyEmail,
    ),
    companyPhone: asString(
      value.companyPhone,
      fallbackCompanySettings.companyPhone,
    ),
    companyWebsite: asString(
      value.companyWebsite,
      fallbackCompanySettings.companyWebsite,
    ),
    senderCopyEmail: asString(
      value.senderCopyEmail,
      fallbackCompanySettings.senderCopyEmail,
    ),
    logoDataUrl: asString(value.logoDataUrl, fallbackCompanySettings.logoDataUrl),
    pdfTableColumns: Array.isArray(value.pdfTableColumns)
      ? (value.pdfTableColumns as CompanySettings["pdfTableColumns"])
      : fallbackCompanySettings.pdfTableColumns,
    customServices: Array.isArray(value.customServices)
      ? (value.customServices as CompanySettings["customServices"])
      : fallbackCompanySettings.customServices,
    vatRate: toNumberInRange(value.vatRate, fallbackCompanySettings.vatRate, 0, 100),
    offerValidityDays: toNumberInRange(
      value.offerValidityDays,
      fallbackCompanySettings.offerValidityDays,
      1,
      365,
    ),
    invoicePaymentDueDays: toNumberInRange(
      value.invoicePaymentDueDays,
      fallbackCompanySettings.invoicePaymentDueDays,
      0,
      365,
    ),
    offerTermsText: asString(
      value.offerTermsText,
      fallbackCompanySettings.offerTermsText,
    ),
    lastOfferNumber: asString(
      value.lastOfferNumber,
      fallbackCompanySettings.lastOfferNumber,
    ),
    customServiceTypes: Array.isArray(value.customServiceTypes)
      ? value.customServiceTypes
          .map((entry) => String(entry).trim())
          .filter(Boolean)
      : fallbackCompanySettings.customServiceTypes,
  };
}

function readSettingsDraftFromSessionStorageForOffer(): CompanySettings | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(SETTINGS_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (isObjectRecord(parsed) && isObjectRecord(parsed.settings)) {
      return normalizeCompanySettingsInput(parsed.settings);
    }

    return normalizeCompanySettingsInput(parsed);
  } catch {
    return null;
  }
}

function hasCompletedCompanySettings(settings: CompanySettings | undefined): boolean {
  if (!settings) {
    return false;
  }

  const requiredValues = [
    settings.companyName,
    settings.ownerName,
    settings.companyStreet,
    settings.companyPostalCode,
    settings.companyCity,
    settings.companyEmail,
    settings.companyPhone,
  ];

  return requiredValues.every((value) => value.trim().length > 0);
}

function capitalizeEntryStart(value: string): string {
  if (!value) {
    return "";
  }

  const matchIndex = value.search(/[A-Za-zÄÖÜäöüß]/);
  if (matchIndex < 0) {
    return value;
  }

  return (
    value.slice(0, matchIndex) +
    value.charAt(matchIndex).toUpperCase() +
    value.slice(matchIndex + 1)
  );
}

function createSubitemEntry(description = ""): ServiceSubitemEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: capitalizeEntryStart(description),
    quantity: "",
    unit: UNIT_OPTIONS[0],
    price: "",
  };
}

function createSelectedServiceEntry(label: string): SelectedServiceEntry {
  const normalizedLabel = capitalizeEntryStart(label);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: normalizedLabel,
    subitems: [createSubitemEntry(normalizedLabel)],
  };
}

function selectedServiceToRequestValue(service: SelectedServiceEntry): string {
  return service.label.trim();
}

function selectedServicesToDraftPayload(
  services: SelectedServiceEntry[],
): CustomerDraftGroup[] {
  return services.map((service) => ({
    label: service.label.trim(),
    subitems: service.subitems.map((subitem) => ({
      description: subitem.description.trim(),
      quantity: subitem.quantity.trim(),
      unit: subitem.unit.trim(),
      price: subitem.price.trim(),
    })),
  }));
}

function selectedServicesFromDraftPayload(
  groups: CustomerDraftGroup[] | undefined,
): SelectedServiceEntry[] {
  if (!Array.isArray(groups) || groups.length === 0) {
    return [];
  }

  return groups
    .map((group) => {
      const label = capitalizeEntryStart(group.label?.trim() || "");
      const subitems = Array.isArray(group.subitems) ? group.subitems : [];
      const normalizedSubitems = subitems
        .map((subitem) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          description: capitalizeEntryStart(subitem.description?.trim() || ""),
          quantity: sanitizeQuantityInput(subitem.quantity?.trim() || ""),
          unit: subitem.unit?.trim() || UNIT_OPTIONS[0],
          price: sanitizePriceInput(subitem.price?.trim() || ""),
        }))
        .filter(
          (subitem) =>
            Boolean(subitem.description) ||
            Boolean(subitem.quantity) ||
            Boolean(subitem.price),
        );

      if (!label && normalizedSubitems.length === 0) {
        return null;
      }

      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: label || DEFAULT_MANUAL_GROUP_LABEL,
        subitems:
          normalizedSubitems.length > 0
            ? normalizedSubitems
            : [createSubitemEntry()],
      };
    })
    .filter((entry): entry is SelectedServiceEntry => Boolean(entry));
}

function getSubitemUnit(subitem: ServiceSubitemEntry): string {
  return subitem.unit.trim() || "Pauschal";
}

function hasValidThousandsGrouping(
  rawValue: string,
  separator: "," | ".",
): boolean {
  const parts = rawValue.split(separator);
  if (parts.length <= 1) {
    return true;
  }
  if (!parts.every((part) => /^\d+$/.test(part))) {
    return false;
  }
  if (parts[0].length < 1 || parts[0].length > 3) {
    return false;
  }

  return parts.slice(1).every((part) => part.length === 3);
}

function parseLocaleNumber(rawValue: string): number {
  const normalized = rawValue
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "");
  if (!normalized) {
    return NaN;
  }

  const isNegative = normalized.startsWith("-");
  const unsigned = normalized.replace(/-/g, "");
  if (!unsigned) {
    return NaN;
  }

  const lastCommaIndex = unsigned.lastIndexOf(",");
  const lastDotIndex = unsigned.lastIndexOf(".");
  const decimalIndex = Math.max(lastCommaIndex, lastDotIndex);
  const commaCount = (unsigned.match(/,/g) ?? []).length;
  const dotCount = (unsigned.match(/\./g) ?? []).length;
  let numberLiteral = "";

  if (decimalIndex < 0) {
    numberLiteral = unsigned.replace(/[^\d]/g, "");
  } else {
    const separatorCharacter = unsigned.charAt(decimalIndex);
    const integerPartRaw = unsigned.slice(0, decimalIndex);
    const fractionPartRaw = unsigned.slice(decimalIndex + 1);
    const integerDigits = integerPartRaw.replace(/[^\d]/g, "");
    const fractionDigits = fractionPartRaw.replace(/[^\d]/g, "");
    const hasOtherSeparator =
      separatorCharacter === "," ? dotCount > 0 : commaCount > 0;
    const hasMultipleSameSeparator =
      separatorCharacter === "," ? commaCount > 1 : dotCount > 1;
    const allowThreeDecimalDigits =
      fractionDigits.length === 3 &&
      (integerDigits.length === 0 || /^0+$/.test(integerDigits));
    const treatAsDecimal =
      fractionDigits.length > 0 &&
      (fractionDigits.length <= 2 || allowThreeDecimalDigits) &&
      (hasOtherSeparator || !hasMultipleSameSeparator || allowThreeDecimalDigits);

    if (treatAsDecimal) {
      if (fractionPartRaw.includes(",") || fractionPartRaw.includes(".")) {
        return NaN;
      }
      if (integerPartRaw.includes(separatorCharacter)) {
        return NaN;
      }
      if (hasOtherSeparator) {
        const thousandsSeparator = separatorCharacter === "," ? "." : ",";
        if (
          integerPartRaw.includes(thousandsSeparator) &&
          !hasValidThousandsGrouping(
            integerPartRaw,
            thousandsSeparator as "," | ".",
          )
        ) {
          return NaN;
        }
      }
      numberLiteral = `${integerDigits || "0"}.${fractionDigits}`;
    } else {
      if (hasOtherSeparator) {
        return NaN;
      }
      if (
        !hasValidThousandsGrouping(
          unsigned,
          separatorCharacter as "," | ".",
        )
      ) {
        return NaN;
      }
      numberLiteral = `${integerPartRaw}${fractionPartRaw}`.replace(/[^\d]/g, "");
    }
  }

  if (!numberLiteral) {
    return NaN;
  }

  const parsed = Number(isNegative ? `-${numberLiteral}` : numberLiteral);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function sanitizeQuantityInput(rawValue: string): string {
  const normalized = rawValue.replace(/\s+/g, "").replace(/[^\d.,]/g, "");
  let hasSeparator = false;
  let sanitized = "";

  for (const character of normalized) {
    if (/\d/.test(character)) {
      sanitized += character;
      continue;
    }

    if (!hasSeparator && (character === "," || character === ".")) {
      hasSeparator = true;
      sanitized += character;
    }
  }

  return sanitized;
}

function sanitizePriceInput(rawValue: string): string {
  const normalized = rawValue.replace(/\s+/g, "").replace(/[^\d.,]/g, "");
  if (!normalized) {
    return "";
  }

  const lastCommaIndex = normalized.lastIndexOf(",");
  const lastDotIndex = normalized.lastIndexOf(".");
  const decimalIndex = Math.max(lastCommaIndex, lastDotIndex);
  const commaCount = (normalized.match(/,/g) ?? []).length;
  const dotCount = (normalized.match(/\./g) ?? []).length;

  const integerRaw =
    decimalIndex >= 0 ? normalized.slice(0, decimalIndex) : normalized;
  const fractionRaw = decimalIndex >= 0 ? normalized.slice(decimalIndex + 1) : "";
  const integerDigits = integerRaw.replace(/[^\d]/g, "");
  const fractionDigits = fractionRaw.replace(/[^\d]/g, "");
  const trailingSeparator =
    decimalIndex >= 0 && fractionRaw.length === 0 && /[.,]$/.test(normalized);
  const separatorCharacter =
    decimalIndex >= 0 ? normalized.charAt(decimalIndex) : "";
  const hasOtherSeparator =
    separatorCharacter === "," ? dotCount > 0 : commaCount > 0;
  const hasMultipleSameSeparator =
    separatorCharacter === "," ? commaCount > 1 : dotCount > 1;
  const allowThreeDecimalDigits =
    fractionDigits.length === 3 &&
    (integerDigits.length === 0 || /^0+$/.test(integerDigits));
  const treatAsDecimal =
    decimalIndex >= 0 &&
    fractionDigits.length > 0 &&
    (fractionDigits.length <= 2 || allowThreeDecimalDigits) &&
    (hasOtherSeparator || !hasMultipleSameSeparator || allowThreeDecimalDigits);

  if (!integerDigits && !fractionDigits) {
    return "";
  }

  if (decimalIndex >= 0 && !treatAsDecimal && !trailingSeparator) {
    if (
      hasOtherSeparator ||
      !hasValidThousandsGrouping(
        normalized,
        separatorCharacter as "," | ".",
      )
    ) {
      return normalized;
    }
    return `${integerRaw}${fractionRaw}`.replace(/[^\d]/g, "");
  }

  const integerPart = integerDigits || "0";
  if (trailingSeparator) {
    return `${integerPart},`;
  }

  if (fractionDigits) {
    return `${integerPart},${fractionDigits}`;
  }

  return integerPart;
}

function formatPriceInputValue(rawValue: string): string {
  const sanitized = sanitizePriceInput(rawValue);
  if (!sanitized) {
    return "";
  }

  const parsed = parseLocaleNumber(sanitized);
  if (!Number.isFinite(parsed)) {
    return sanitized;
  }

  return formatEuroValue(parsed);
}

function formatEuroValue(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatArchiveDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

function hasVoiceFieldValue(key: string, form: OfferForm): boolean {
  switch (key) {
    case "companyName":
      return form.companyName.trim().length > 0;
    case "salutation":
      return form.salutation === "herr" || form.salutation === "frau";
    case "firstName":
      return form.firstName.trim().length > 0;
    case "lastName":
      return form.lastName.trim().length > 0;
    case "street":
      return form.street.trim().length > 0;
    case "postalCode":
      return form.postalCode.trim().length > 0;
    case "city":
      return form.city.trim().length > 0;
    case "customerEmail":
      return form.customerEmail.trim().length > 0;
    case "serviceDescription":
      return form.serviceDescription.trim().length > 0;
    case "hours":
      return form.hours.trim().length > 0;
    case "hourlyRate":
      return form.hourlyRate.trim().length > 0;
    case "materialCost":
      return form.materialCost.trim().length > 0;
    default:
      return false;
  }
}

function calculateSubitemTotal(subitem: ServiceSubitemEntry): number {
  const quantity = parseLocaleNumber(subitem.quantity);
  const price = parseLocaleNumber(subitem.price);
  if (!Number.isFinite(quantity) || !Number.isFinite(price)) {
    return 0;
  }

  return quantity * price;
}

function normalizeAddressSuggestion(
  item: NominatimItem,
): AddressSuggestion | null {
  const road = item.address?.road?.trim() ?? "";
  const houseNumber = item.address?.house_number?.trim() ?? "";
  const postalCode = item.address?.postcode?.trim() ?? "";
  const city =
    item.address?.city?.trim() ??
    item.address?.town?.trim() ??
    item.address?.village?.trim() ??
    item.address?.hamlet?.trim() ??
    item.address?.municipality?.trim() ??
    "";

  const street = [road, houseNumber].filter(Boolean).join(" ").trim();
  if (!street && !postalCode && !city) {
    return null;
  }

  const primary = street || item.display_name?.trim() || "Adresse auswählen";
  const secondary =
    [postalCode, city].filter(Boolean).join(" ").trim() ||
    item.display_name?.trim() ||
    "";

  return {
    street,
    postalCode,
    city,
    primary,
    secondary,
  };
}

export default function HomePage() {
  const router = useRouter();
  const [documentMode, setDocumentMode] = useState<DocumentMode>("offer");
  const [modeAnimationKey, setModeAnimationKey] = useState(0);
  const [form, setForm] = useState<OfferForm>(initialForm);
  const [error, setError] = useState("");
  const [postActionInfo, setPostActionInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeCustomerNumber, setActiveCustomerNumber] = useState("");
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(
    null,
  );
  const [addressSuggestions, setAddressSuggestions] = useState<
    AddressSuggestion[]
  >([]);
  const [isAddressLoading, setIsAddressLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const [voiceInfo, setVoiceInfo] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceMissingFields, setVoiceMissingFields] = useState<string[]>([]);
  const [serviceCatalog, setServiceCatalog] =
    useState<ServiceCatalogItem[]>(getSeedServices());
  const [serviceSearch, setServiceSearch] = useState("");
  const [selectedServices, setSelectedServices] = useState<
    SelectedServiceEntry[]
  >([]);
  const [activePriceSubitemId, setActivePriceSubitemId] = useState<
    string | null
  >(null);
  const [isServiceSearchOpen, setIsServiceSearchOpen] = useState(false);
  const [isServiceCatalogLoading, setIsServiceCatalogLoading] = useState(false);
  const [isAddingCustomService, setIsAddingCustomService] = useState(false);
  const [isServiceDateRangePickerOpen, setIsServiceDateRangePickerOpen] =
    useState(false);
  const [serviceDateRangeStart, setServiceDateRangeStart] = useState("");
  const [serviceDateRangeEnd, setServiceDateRangeEnd] = useState("");
  const [serviceDateCalendarMonth, setServiceDateCalendarMonth] = useState(
    toMonthStartValue(todayDateInputValue()),
  );
  const [serviceInfo, setServiceInfo] = useState("");
  const [serviceError, setServiceError] = useState("");
  const [storedCustomers, setStoredCustomers] = useState<StoredCustomerRecord[]>(
    [],
  );
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const [isCustomersLoading, setIsCustomersLoading] = useState(false);
  const [deletingCustomerNumber, setDeletingCustomerNumber] = useState<
    string | null
  >(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customersError, setCustomersError] = useState("");
  const [isCustomerArchiveOpen, setIsCustomerArchiveOpen] = useState(false);
  const [archiveDocuments, setArchiveDocuments] = useState<
    CustomerArchiveDocument[]
  >([]);
  const [archiveError, setArchiveError] = useState("");
  const [isArchiveDocumentsLoading, setIsArchiveDocumentsLoading] =
    useState(false);
  const [selectedArchiveCustomerNumber, setSelectedArchiveCustomerNumber] =
    useState("");
  const [isArchiveOffersOpen, setIsArchiveOffersOpen] = useState(false);
  const [isArchiveInvoicesOpen, setIsArchiveInvoicesOpen] = useState(false);
  const [isInfoLegalOpen, setIsInfoLegalOpen] = useState(false);
  const [isClosingInfoLegal, setIsClosingInfoLegal] = useState(false);
  const [isCompanySetupComplete, setIsCompanySetupComplete] = useState(false);
  const [isSetupHintOpen, setIsSetupHintOpen] = useState(false);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);
  const [isClosingCustomerArchive, setIsClosingCustomerArchive] = useState(false);
  const [isHomeStateHydrated, setIsHomeStateHydrated] = useState(false);
  const recognitionRef = useRef<any>(null);
  const modeSnapshotsRef = useRef<Record<DocumentMode, ModeSnapshot>>({
    offer: createInitialModeSnapshot(),
    invoice: createInitialModeSnapshot(),
  });
  const shouldAutoApplyVoiceRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const servicePickerRef = useRef<HTMLDivElement | null>(null);
  const serviceDateRangePickerRef = useRef<HTMLDivElement | null>(null);
  const finalTranscriptRef = useRef("");
  const settingsNavTimeoutRef = useRef<number | null>(null);
  const invoiceDateInputRef = useRef<HTMLInputElement | null>(null);
  const archiveLoadRequestRef = useRef(0);
  const archiveCloseTimeoutRef = useRef<number | null>(null);
  const infoLegalCloseTimeoutRef = useRef<number | null>(null);

  const serviceSearchValue = serviceSearch.trim();
  const serviceSuggestions = useMemo(
    () => searchServices(serviceCatalog, serviceSearchValue, 14),
    [serviceCatalog, serviceSearchValue],
  );
  const canCreateCustomService =
    serviceSearchValue.length >= 2 &&
    !hasServiceLabel(serviceCatalog, serviceSearchValue);
  const groupedServiceSuggestions = useMemo(() => {
    const grouped = new Map<string, ServiceCatalogItem[]>();

    for (const suggestion of serviceSuggestions) {
      const services = grouped.get(suggestion.category) ?? [];
      services.push(suggestion);
      grouped.set(suggestion.category, services);
    }

    return Array.from(grouped.entries());
  }, [serviceSuggestions]);
  const serviceDateCalendarDays = useMemo(
    () => buildServiceDateCalendarDays(serviceDateCalendarMonth),
    [serviceDateCalendarMonth],
  );
  const serviceDateCalendarMonthLabel = useMemo(() => {
    if (!isDateInputValue(serviceDateCalendarMonth)) {
      return "";
    }

    const year = Number(serviceDateCalendarMonth.slice(0, 4));
    const month = Number(serviceDateCalendarMonth.slice(5, 7));
    return new Intl.DateTimeFormat("de-DE", {
      month: "long",
      year: "numeric",
    }).format(new Date(year, month - 1, 1));
  }, [serviceDateCalendarMonth]);
  const serviceDateRangeSummary = useMemo(() => {
    if (serviceDateRangeStart && serviceDateRangeEnd) {
      return formatServiceDateRangeValue(serviceDateRangeStart, serviceDateRangeEnd);
    }
    if (serviceDateRangeStart) {
      return `${formatGermanDate(serviceDateRangeStart)} – ...`;
    }
    return "Start- und Enddatum auswählen";
  }, [serviceDateRangeEnd, serviceDateRangeStart]);
  const filteredStoredCustomers = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(customerSearch);
    if (!normalizedQuery) {
      return storedCustomers;
    }

    return storedCustomers.filter((customer) => {
      const searchableParts = [
        customer.customerName,
        customer.companyName,
        customer.firstName,
        customer.lastName,
        customer.customerAddress,
        customer.street,
        customer.postalCode,
        customer.city,
        customer.customerEmail,
        customer.customerNumber,
      ];

      return searchableParts.some((part) =>
        normalizeSearchValue(part).includes(normalizedQuery),
      );
    });
  }, [customerSearch, storedCustomers]);
  const archiveOfferDocuments = useMemo(
    () =>
      archiveDocuments.filter((document) => document.documentType !== "invoice"),
    [archiveDocuments],
  );
  const archiveInvoiceDocuments = useMemo(
    () =>
      archiveDocuments.filter((document) => document.documentType === "invoice"),
    [archiveDocuments],
  );
  const selectedArchiveCustomer = useMemo(
    () =>
      storedCustomers.find(
        (customer) => customer.customerNumber === selectedArchiveCustomerNumber,
      ) ?? null,
    [selectedArchiveCustomerNumber, storedCustomers],
  );
  const isInvoiceMode = documentMode === "invoice";
  const singularDocumentLabel = isInvoiceMode ? "Rechnung" : "Angebot";

  function applyModeSnapshot(snapshot: ModeSnapshot) {
    setForm({ ...snapshot.form });
    setActiveCustomerNumber(snapshot.activeCustomerNumber);
    setSelectedServices(cloneSelectedServices(snapshot.selectedServices));
    setVoiceTranscript(snapshot.voiceTranscript);
    setVoiceInfo(snapshot.voiceInfo);
    setVoiceError(snapshot.voiceError);
    setVoiceMissingFields([...snapshot.voiceMissingFields]);
    setError(snapshot.error);
    setPostActionInfo(snapshot.postActionInfo);
    setServiceSearch(snapshot.serviceSearch);
    setIsServiceSearchOpen(snapshot.isServiceSearchOpen);
    setServiceInfo(snapshot.serviceInfo);
    setServiceError(snapshot.serviceError);
    setAddressSuggestions(
      snapshot.addressSuggestions.map((suggestion) => ({ ...suggestion })),
    );
  }

  function createCurrentModeSnapshot(): ModeSnapshot {
    return {
      form: { ...form },
      activeCustomerNumber,
      selectedServices: cloneSelectedServices(selectedServices),
      voiceTranscript,
      voiceInfo,
      voiceError,
      voiceMissingFields: [...voiceMissingFields],
      error,
      postActionInfo,
      serviceSearch,
      isServiceSearchOpen,
      serviceInfo,
      serviceError,
      addressSuggestions: addressSuggestions.map((suggestion) => ({ ...suggestion })),
    };
  }

  function storeCurrentModeSnapshot(mode: DocumentMode) {
    modeSnapshotsRef.current[mode] = createCurrentModeSnapshot();
  }

  function switchDocumentMode(nextMode: DocumentMode) {
    if (nextMode === documentMode) {
      return;
    }

    storeCurrentModeSnapshot(documentMode);
    const nextSnapshot = modeSnapshotsRef.current[nextMode];
    if (nextSnapshot) {
      applyModeSnapshot(nextSnapshot);
    } else {
      applyModeSnapshot(createInitialModeSnapshot());
    }

    if (recognitionRef.current) {
      shouldAutoApplyVoiceRef.current = false;
      pauseRequestedRef.current = false;
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsListening(false);
    }
    setIsSpeechPaused(false);
    setActivePriceSubitemId(null);

    setDocumentMode(nextMode);
    setModeAnimationKey((value) => value + 1);
  }

  function resetCurrentInputs() {
    const confirmed = window.confirm(
      `Möchtest du wirklich alle Eingaben im aktuellen ${singularDocumentLabel.toLowerCase()} löschen?`,
    );
    if (!confirmed) {
      return;
    }

    if (recognitionRef.current) {
      shouldAutoApplyVoiceRef.current = false;
      pauseRequestedRef.current = false;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    finalTranscriptRef.current = "";
    setIsListening(false);
    setIsSpeechPaused(false);
    setIsAddressLoading(false);
    setIsCustomerPickerOpen(false);
    setCustomerSearch("");
    setCustomersError("");
    setDeletingCustomerNumber(null);
    setError("");
    setPostActionInfo("");

    const resetSnapshot = createInitialModeSnapshot();
    modeSnapshotsRef.current[documentMode] = resetSnapshot;
    applyModeSnapshot(resetSnapshot);
  }

  function openSettingsWithAnimation(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    if (isOpeningSettings) {
      return;
    }

    try {
      const snapshots: Record<DocumentMode, ModeSnapshot> = {
        ...modeSnapshotsRef.current,
        [documentMode]: createCurrentModeSnapshot(),
      };
      modeSnapshotsRef.current = snapshots;
      const payload: PersistedHomeState = {
        documentMode,
        modeSnapshots: snapshots,
      };
      window.sessionStorage.setItem(
        HOME_STATE_STORAGE_KEY,
        JSON.stringify(payload),
      );
    } catch {
      // Navigationswechsel darf nicht blockiert werden.
    }

    setIsOpeningSettings(true);
    if (settingsNavTimeoutRef.current !== null) {
      window.clearTimeout(settingsNavTimeoutRef.current);
    }
    settingsNavTimeoutRef.current = window.setTimeout(() => {
      router.push("/settings");
    }, 110);
  }

  useEffect(() => {
    const speechCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(speechCtor));

    return () => {
      if (settingsNavTimeoutRef.current !== null) {
        window.clearTimeout(settingsNavTimeoutRef.current);
      }
      if (archiveCloseTimeoutRef.current !== null) {
        window.clearTimeout(archiveCloseTimeoutRef.current);
      }
      if (infoLegalCloseTimeoutRef.current !== null) {
        window.clearTimeout(infoLegalCloseTimeoutRef.current);
      }
      if (recognitionRef.current) {
        shouldAutoApplyVoiceRef.current = false;
        pauseRequestedRef.current = false;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
    };
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const rawState = window.sessionStorage.getItem(HOME_STATE_STORAGE_KEY);
      if (rawState) {
        const persisted = hydratePersistedHomeState(JSON.parse(rawState));
        if (persisted) {
          modeSnapshotsRef.current = persisted.modeSnapshots;
          setDocumentMode(persisted.documentMode);
          applyModeSnapshot(persisted.modeSnapshots[persisted.documentMode]);
        }
      }
    } catch {
      // Ignorieren und mit initialem State starten.
    } finally {
      setIsHomeStateHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHomeStateHydrated || typeof window === "undefined") {
      return;
    }

    const snapshots: Record<DocumentMode, ModeSnapshot> = {
      ...modeSnapshotsRef.current,
      [documentMode]: createCurrentModeSnapshot(),
    };
    modeSnapshotsRef.current = snapshots;

    const payload: PersistedHomeState = {
      documentMode,
      modeSnapshots: snapshots,
    };

    try {
      window.sessionStorage.setItem(
        HOME_STATE_STORAGE_KEY,
        JSON.stringify(payload),
      );
    } catch {
      // Storage kann in einzelnen Browsern deaktiviert sein.
    }
  }, [
    addressSuggestions,
    activeCustomerNumber,
    documentMode,
    error,
    form,
    isServiceSearchOpen,
    postActionInfo,
    selectedServices,
    serviceError,
    serviceInfo,
    serviceSearch,
    voiceError,
    voiceInfo,
    voiceMissingFields,
    voiceTranscript,
    isHomeStateHydrated,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const hasBlockingOverlay = isCustomerArchiveOpen || isInfoLegalOpen;
    if (!hasBlockingOverlay) {
      return;
    }

    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousHtmlOverscroll = documentElement.style.overscrollBehavior;

    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    documentElement.style.overflow = "hidden";
    documentElement.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      documentElement.style.overflow = previousHtmlOverflow;
      documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [isCustomerArchiveOpen, isInfoLegalOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!isCustomerArchiveOpen && !isInfoLegalOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (isInfoLegalOpen) {
        closeInfoLegalModal();
        return;
      }

      if (isCustomerArchiveOpen) {
        closeCustomerArchive();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [
    isCustomerArchiveOpen,
    isClosingCustomerArchive,
    isInfoLegalOpen,
    isClosingInfoLegal,
  ]);

  useEffect(() => {
    if (!isServiceDateRangePickerOpen || typeof window === "undefined") {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsServiceDateRangePickerOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isServiceDateRangePickerOpen]);

  useEffect(() => {
    let mounted = true;

    async function loadSettingsStatus() {
      const draftSettings = readSettingsDraftFromSessionStorageForOffer();
      if (mounted && draftSettings) {
        setCompanySettings(draftSettings);
      }

      try {
        const response = await fetch("/api/settings");
        const data = (await response.json()) as SettingsApiResponse;
        if (!response.ok) {
          return;
        }
        if (mounted) {
          if (data.settings) {
            setCompanySettings(data.settings);
          }
          const isComplete = hasCompletedCompanySettings(data.settings);
          setIsCompanySetupComplete(isComplete);
          if (!isComplete) {
            setIsSetupHintOpen(false);
          }
        }
      } catch {
        // Nur UI-Hinweis; Fehler hier blockiert die Seite nicht.
      }
    }

    void loadSettingsStatus();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadServiceCatalog() {
      setIsServiceCatalogLoading(true);
      setServiceError("");

      try {
        const response = await fetch("/api/services?limit=250");
        const data = (await response.json()) as ServicesApiResponse;
        if (!response.ok) {
          if (mounted) {
            setServiceError(
              data.error ?? "Leistungen konnten nicht geladen werden.",
            );
          }
          return;
        }

        if (mounted) {
          setServiceCatalog(Array.isArray(data.services) ? data.services : []);
        }
      } catch {
        if (mounted) {
          setServiceError("Leistungen konnten nicht geladen werden.");
        }
      } finally {
        if (mounted) {
          setIsServiceCatalogLoading(false);
        }
      }
    }

    void loadServiceCatalog();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    function closeFloatingPanels(event: MouseEvent) {
      const target = event.target as Node;

      if (servicePickerRef.current && !servicePickerRef.current.contains(target)) {
        setIsServiceSearchOpen(false);
      }

      if (
        serviceDateRangePickerRef.current &&
        !serviceDateRangePickerRef.current.contains(target)
      ) {
        setIsServiceDateRangePickerOpen(false);
      }
    }

    document.addEventListener("mousedown", closeFloatingPanels);
    return () => document.removeEventListener("mousedown", closeFloatingPanels);
  }, []);

  useEffect(() => {
    const street = form.street.trim();
    if (street.length < 3) {
      setAddressSuggestions([]);
      setIsAddressLoading(false);
      return;
    }

    const searchText = [street, form.postalCode.trim(), form.city.trim()]
      .filter(Boolean)
      .join(" ");
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsAddressLoading(true);

      try {
        const params = new URLSearchParams({
          format: "jsonv2",
          addressdetails: "1",
          limit: "5",
          countrycodes: "de,at,ch",
          q: searchText,
        });

        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`,
          {
            signal: controller.signal,
            headers: {
              "Accept-Language": "de",
            },
          },
        );

        if (!response.ok) {
          setAddressSuggestions([]);
          return;
        }

        const data = (await response.json()) as NominatimItem[];
        const normalized = data
          .map(normalizeAddressSuggestion)
          .filter((item): item is AddressSuggestion => Boolean(item))
          .filter(
            (item, index, all) =>
              all.findIndex(
                (entry) =>
                  entry.street === item.street &&
                  entry.postalCode === item.postalCode &&
                  entry.city === item.city &&
                  entry.primary === item.primary,
              ) === index,
          );

        setAddressSuggestions(normalized);
      } catch (fetchError) {
        if ((fetchError as { name?: string }).name !== "AbortError") {
          setAddressSuggestions([]);
        }
      } finally {
        setIsAddressLoading(false);
      }
    }, 280);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [form.street, form.postalCode, form.city]);

  function applyAddressSuggestion(suggestion: AddressSuggestion) {
    setForm((prev) => ({
      ...prev,
      street: suggestion.street
        ? capitalizeEntryStart(suggestion.street)
        : prev.street,
      postalCode: suggestion.postalCode || prev.postalCode,
      city: suggestion.city ? capitalizeEntryStart(suggestion.city) : prev.city,
    }));
    setAddressSuggestions([]);
  }

  async function loadStoredCustomers() {
    setCustomersError("");
    setIsCustomersLoading(true);

    try {
      const response = await fetch("/api/customers");
      const data = (await response.json()) as CustomersApiResponse;
      if (!response.ok) {
        setCustomersError(
          data.error ?? "Gespeicherte Kunden konnten nicht geladen werden.",
        );
        return;
      }

      setStoredCustomers(Array.isArray(data.customers) ? data.customers : []);
    } catch {
      setCustomersError("Gespeicherte Kunden konnten nicht geladen werden.");
    } finally {
      setIsCustomersLoading(false);
    }
  }

  function toggleStoredCustomers() {
    const nextOpen = !isCustomerPickerOpen;
    setIsCustomerPickerOpen(nextOpen);
    setCustomersError("");
    if (!nextOpen) {
      setCustomerSearch("");
    }

    if (nextOpen && !isCustomersLoading && storedCustomers.length === 0) {
      void loadStoredCustomers();
    }
  }

  async function loadCustomerDocuments(customerNumber: string) {
    if (!customerNumber) {
      setArchiveDocuments([]);
      return;
    }
    const currentLoadRequest = archiveLoadRequestRef.current + 1;
    archiveLoadRequestRef.current = currentLoadRequest;

    setArchiveError("");
    setIsArchiveDocumentsLoading(true);
    setArchiveDocuments([]);

    try {
      const response = await fetch(
        `/api/customer-documents?customerNumber=${encodeURIComponent(customerNumber)}`,
      );
      const data = (await response.json()) as CustomerDocumentsApiResponse;
      if (archiveLoadRequestRef.current !== currentLoadRequest) {
        return;
      }
      if (!response.ok) {
        setArchiveError(data.error ?? "Dokumente konnten nicht geladen werden.");
        return;
      }

      const documents = Array.isArray(data.documents) ? data.documents : [];
      setArchiveDocuments(
        documents
          .map((document): CustomerArchiveDocument => ({
            ...document,
            documentType: document.documentType === "invoice" ? "invoice" : "offer",
          }))
          .sort((left, right) => {
            const rightTs = Date.parse(right.createdAt);
            const leftTs = Date.parse(left.createdAt);
            if (
              Number.isFinite(rightTs) &&
              Number.isFinite(leftTs) &&
              rightTs !== leftTs
            ) {
              return rightTs - leftTs;
            }

            return right.documentNumber.localeCompare(left.documentNumber);
          }),
      );
    } catch {
      if (archiveLoadRequestRef.current !== currentLoadRequest) {
        return;
      }
      setArchiveError("Dokumente konnten nicht geladen werden.");
    } finally {
      if (archiveLoadRequestRef.current !== currentLoadRequest) {
        return;
      }
      setIsArchiveDocumentsLoading(false);
    }
  }

  function openCustomerArchive() {
    if (archiveCloseTimeoutRef.current !== null) {
      window.clearTimeout(archiveCloseTimeoutRef.current);
      archiveCloseTimeoutRef.current = null;
    }
    setIsClosingCustomerArchive(false);
    setIsCustomerArchiveOpen(true);
    setArchiveError("");

    if (!isCustomersLoading && storedCustomers.length === 0) {
      void loadStoredCustomers();
    }
  }

  function closeCustomerArchive() {
    if (!isCustomerArchiveOpen || isClosingCustomerArchive) {
      return;
    }

    setIsClosingCustomerArchive(true);
    if (archiveCloseTimeoutRef.current !== null) {
      window.clearTimeout(archiveCloseTimeoutRef.current);
    }
    archiveCloseTimeoutRef.current = window.setTimeout(() => {
      setIsCustomerArchiveOpen(false);
      setIsClosingCustomerArchive(false);
      archiveCloseTimeoutRef.current = null;
    }, 170);
  }

  function clearArchiveCustomerSelection() {
    archiveLoadRequestRef.current += 1;
    setSelectedArchiveCustomerNumber("");
    setArchiveDocuments([]);
    setArchiveError("");
    setIsArchiveDocumentsLoading(false);
    setIsArchiveOffersOpen(false);
    setIsArchiveInvoicesOpen(false);
  }

  function openInfoLegalModal() {
    if (infoLegalCloseTimeoutRef.current !== null) {
      window.clearTimeout(infoLegalCloseTimeoutRef.current);
      infoLegalCloseTimeoutRef.current = null;
    }
    setIsClosingInfoLegal(false);
    setIsInfoLegalOpen(true);
  }

  function closeInfoLegalModal() {
    if (!isInfoLegalOpen || isClosingInfoLegal) {
      return;
    }

    setIsClosingInfoLegal(true);
    if (infoLegalCloseTimeoutRef.current !== null) {
      window.clearTimeout(infoLegalCloseTimeoutRef.current);
    }
    infoLegalCloseTimeoutRef.current = window.setTimeout(() => {
      setIsInfoLegalOpen(false);
      setIsClosingInfoLegal(false);
      infoLegalCloseTimeoutRef.current = null;
    }, 170);
  }

  function selectArchiveCustomer(customer: StoredCustomerRecord) {
    if (selectedArchiveCustomerNumber === customer.customerNumber) {
      return;
    }

    setSelectedArchiveCustomerNumber(customer.customerNumber);
    setIsArchiveOffersOpen(false);
    setIsArchiveInvoicesOpen(false);
    void loadCustomerDocuments(customer.customerNumber);
  }

  function openInvoiceDatePicker() {
    const input = invoiceDateInputRef.current;
    if (!input) {
      return;
    }

    const pickerInput = input as HTMLInputElement & {
      showPicker?: () => void;
    };

    try {
      if (typeof pickerInput.showPicker === "function") {
        pickerInput.showPicker();
        return;
      }
    } catch {
      // Fallback auf native Öffnung per Fokus/Klick.
    }

    input.focus();
    input.click();
  }

  function openServiceDateRangePicker() {
    const parsed = parseServiceDateRangeValue(form.serviceDate);
    if (parsed) {
      setServiceDateRangeStart(parsed.startDate);
      setServiceDateRangeEnd(parsed.endDate);
      setServiceDateCalendarMonth(toMonthStartValue(parsed.startDate));
    } else {
      setServiceDateRangeStart("");
      setServiceDateRangeEnd("");
      setServiceDateCalendarMonth(toMonthStartValue(todayDateInputValue()));
    }

    setIsServiceDateRangePickerOpen(true);
  }

  function closeServiceDateRangePicker() {
    setIsServiceDateRangePickerOpen(false);
  }

  function selectServiceDateRangeDay(dateValue: string) {
    if (!isDateInputValue(dateValue)) {
      return;
    }

    if (!serviceDateRangeStart || serviceDateRangeEnd) {
      setServiceDateRangeStart(dateValue);
      setServiceDateRangeEnd("");
      setForm((prev) => ({ ...prev, serviceDate: "" }));
      return;
    }

    const normalizedStart =
      dateValue < serviceDateRangeStart ? dateValue : serviceDateRangeStart;
    const normalizedEnd =
      dateValue < serviceDateRangeStart ? serviceDateRangeStart : dateValue;

    setServiceDateRangeStart(normalizedStart);
    setServiceDateRangeEnd(normalizedEnd);
    setForm((prev) => ({
      ...prev,
      serviceDate: formatServiceDateRangeValue(normalizedStart, normalizedEnd),
    }));
    setIsServiceDateRangePickerOpen(false);
  }

  function clearServiceDateRange() {
    setServiceDateRangeStart("");
    setServiceDateRangeEnd("");
    setForm((prev) => ({ ...prev, serviceDate: "" }));
  }

  async function deleteStoredCustomer(customer: StoredCustomerRecord) {
    const confirmed = window.confirm(
      `${customer.customerName} wirklich löschen?`,
    );
    if (!confirmed) {
      return;
    }

    setCustomersError("");
    setDeletingCustomerNumber(customer.customerNumber);

    try {
      const response = await fetch(
        `/api/customers?customerNumber=${encodeURIComponent(customer.customerNumber)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as DeleteCustomerApiResponse;
      if (!response.ok || !data.ok) {
        setCustomersError(data.error ?? "Kunde konnte nicht gelöscht werden.");
        return;
      }

      setStoredCustomers((prev) =>
        prev.filter(
          (entry) => entry.customerNumber !== customer.customerNumber,
        ),
      );
      if (selectedArchiveCustomerNumber === customer.customerNumber) {
        clearArchiveCustomerSelection();
      }
    } catch {
      setCustomersError("Gespeicherter Kunde konnte nicht gelöscht werden.");
    } finally {
      setDeletingCustomerNumber((prev) =>
        prev === customer.customerNumber ? null : prev,
      );
    }
  }

  function buildCustomerNameForStorage(currentForm: OfferForm): string {
    const personName = [currentForm.firstName.trim(), currentForm.lastName.trim()]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (currentForm.customerType === "company") {
      const company = currentForm.companyName.trim();
      if (!company) {
        return personName;
      }

      if (!personName) {
        return company;
      }

      const salutationLabel = currentForm.salutation === "frau" ? "Frau" : "Herr";
      return `${company} (z. Hd. ${salutationLabel} ${personName})`;
    }

    return personName;
  }

  function updateStoredCustomersRealtime(payload: ApiResponse) {
    const customerNumber = payload.customerNumber?.trim();
    if (!customerNumber) {
      return;
    }

    const nowIso = new Date().toISOString();
    const customerName = buildCustomerNameForStorage(form);
    const customerAddress = `${form.street.trim()}, ${form.postalCode.trim()} ${form.city.trim()}`;

    const optimisticCustomer: StoredCustomerRecord = {
      customerNumber,
      customerType: form.customerType,
      companyName: form.companyName.trim(),
      salutation: form.salutation,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      street: form.street.trim(),
      postalCode: form.postalCode.trim(),
      city: form.city.trim(),
      customerEmail: form.customerEmail.trim(),
      customerName,
      customerAddress,
      draftState: {
        serviceDescription: form.serviceDescription.trim(),
        hours: form.hours.trim(),
        hourlyRate: form.hourlyRate.trim(),
        materialCost: form.materialCost.trim(),
        invoiceDate: form.invoiceDate.trim(),
        serviceDate: form.serviceDate.trim(),
        paymentDueDays: form.paymentDueDays.trim(),
        positions: selectedServicesToDraftPayload(selectedServices),
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setStoredCustomers((prev) => {
      const existingIndex = prev.findIndex(
        (customer) => customer.customerNumber === customerNumber,
      );
      if (existingIndex < 0) {
        return [optimisticCustomer, ...prev];
      }

      const mergedCreatedAt = prev[existingIndex].createdAt || nowIso;
      const next = [...prev];
      next[existingIndex] = {
        ...optimisticCustomer,
        createdAt: mergedCreatedAt,
      };
      return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  function applyStoredCustomer(customer: StoredCustomerRecord) {
    const draftState = customer.draftState;
    const draftSelectedServices = selectedServicesFromDraftPayload(
      draftState?.positions,
    );

    setForm((prev) => ({
      ...prev,
      customerType: customer.customerType,
      companyName: capitalizeEntryStart(customer.companyName),
      salutation: customer.salutation,
      firstName: capitalizeEntryStart(customer.firstName),
      lastName: capitalizeEntryStart(customer.lastName),
      street: capitalizeEntryStart(customer.street),
      postalCode: customer.postalCode,
      city: capitalizeEntryStart(customer.city),
      customerEmail: customer.customerEmail,
      serviceDescription: draftState?.serviceDescription
        ? capitalizeEntryStart(draftState.serviceDescription)
        : "",
      hours: draftState?.hours ?? "",
      hourlyRate: draftState?.hourlyRate ?? "",
      materialCost: draftState?.materialCost ?? "",
      invoiceDate: draftState?.invoiceDate || todayDateInputValue(),
      serviceDate: "",
      paymentDueDays: draftState?.paymentDueDays || "14",
    }));
    setSelectedServices(draftSelectedServices);
    setActiveCustomerNumber(customer.customerNumber);
    setActivePriceSubitemId(null);
    setAddressSuggestions([]);
    setIsCustomerPickerOpen(false);
    setCustomerSearch("");
    setCustomersError("");
  }

  function addSelectedService(serviceLabel: string) {
    const trimmed = serviceLabel.trim();
    if (!trimmed) {
      return;
    }
    const normalizedLabel = capitalizeEntryStart(trimmed);

    setSelectedServices((prev) => {
      const key = normalizeSearchValue(normalizedLabel);
      const existingService = prev.find(
        (service) => normalizeSearchValue(service.label) === key,
      );

      if (existingService) {
        return prev.map((service) =>
          service.id === existingService.id
            ? {
                ...service,
                subitems: [
                  ...service.subitems,
                  createSubitemEntry(normalizedLabel),
                ],
              }
            : service,
        );
      }

      return [...prev, createSelectedServiceEntry(normalizedLabel)];
    });
    setForm((prev) => ({
      ...prev,
      serviceDescription: prev.serviceDescription.trim()
        ? prev.serviceDescription
        : normalizedLabel,
    }));
    setServiceSearch("");
    setIsServiceSearchOpen(false);
    setServiceError("");
  }

  function addEmptyPositionRow() {
    setSelectedServices((prev) => {
      if (prev.length === 0) {
        return [createSelectedServiceEntry(DEFAULT_MANUAL_GROUP_LABEL)];
      }

      const targetService = prev[prev.length - 1];
      return prev.map((service) =>
        service.id === targetService.id
          ? {
              ...service,
              subitems: [...service.subitems, createSubitemEntry()],
            }
          : service,
      );
    });
  }

  function removeSelectedService(serviceId: string) {
    setActivePriceSubitemId(null);
    setSelectedServices((prev) =>
      prev.filter((service) => service.id !== serviceId),
    );
  }

  function updateServiceSubitem(
    serviceId: string,
    subitemId: string,
    field: "description" | "quantity" | "unit" | "price",
    value: string,
  ) {
    setSelectedServices((prev) =>
      prev.map((service) => {
        if (service.id !== serviceId) {
          return service;
        }

        return {
          ...service,
          subitems: service.subitems.map((subitem) => {
            if (subitem.id !== subitemId) {
              return subitem;
            }

            if (field === "unit") {
              return {
                ...subitem,
                unit: value,
              };
            }

            if (field === "description") {
              return {
                ...subitem,
                description: capitalizeEntryStart(value),
              };
            }

            if (field === "quantity") {
              return {
                ...subitem,
                quantity: value,
              };
            }

            return {
              ...subitem,
              price: value,
            };
          }),
        };
      }),
    );
  }

  function updateQuantitySubitem(
    serviceId: string,
    subitemId: string,
    rawValue: string,
  ) {
    updateServiceSubitem(
      serviceId,
      subitemId,
      "quantity",
      sanitizeQuantityInput(rawValue),
    );
  }

  function updatePriceSubitem(
    serviceId: string,
    subitemId: string,
    rawValue: string,
  ) {
    updateServiceSubitem(
      serviceId,
      subitemId,
      "price",
      sanitizePriceInput(rawValue),
    );
  }

  function removeServiceSubitem(serviceId: string, subitemId: string) {
    setActivePriceSubitemId((prev) => (prev === subitemId ? null : prev));
    setSelectedServices((prev) =>
      prev.map((service) => {
        if (service.id !== serviceId) {
          return service;
        }

        const nextSubitems = service.subitems.filter(
          (subitem) => subitem.id !== subitemId,
        );
        return {
          ...service,
          subitems:
            nextSubitems.length > 0 ? nextSubitems : [createSubitemEntry()],
        };
      }),
    );
  }

  async function addCustomService() {
    const label = serviceSearch.trim();
    if (label.length < 2) {
      setServiceError("Bitte mindestens zwei Zeichen eingeben.");
      return;
    }

    setServiceError("");
    setServiceInfo("");
    setIsAddingCustomService(true);

    try {
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = (await response.json()) as ServicesApiResponse & {
        customService?: { label?: string };
      };

      if (!response.ok) {
        setServiceError(
          data.error ?? "Eigene Leistung konnte nicht gespeichert werden.",
        );
        return;
      }

      if (Array.isArray(data.services)) {
        setServiceCatalog(data.services);
      }
      const savedLabel = data.customService?.label?.trim() || label;
      addSelectedService(savedLabel);
      setServiceInfo(`Eigene Leistung gespeichert: ${savedLabel}`);
    } catch {
      setServiceError("Eigene Leistung konnte nicht gespeichert werden.");
    } finally {
      setIsAddingCustomService(false);
    }
  }

  function startSpeechInput() {
    if (isListening) {
      return;
    }

    const speechCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!speechCtor) {
      setVoiceError(
        "Spracherkennung wird auf diesem Gerät/Browser nicht unterstützt.",
      );
      return;
    }

    setVoiceError("");
    setVoiceMissingFields([]);
    setVoiceInfo(
      isSpeechPaused
        ? "Aufnahme fortgesetzt. Sprich weiter, der Text wird angehängt."
        : "Sprich jetzt. Du kannst frei alle Angebotsdaten diktieren.",
    );
    setIsSpeechPaused(false);
    shouldAutoApplyVoiceRef.current = true;
    pauseRequestedRef.current = false;
    finalTranscriptRef.current = voiceTranscript.trim();

    const recognition = new speechCtor();
    recognition.lang = "de-DE";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = String(event.results[i][0]?.transcript ?? "");
        if (event.results[i].isFinal) {
          finalTranscriptRef.current =
            `${finalTranscriptRef.current} ${text}`.trim();
        } else {
          interimTranscript += text;
        }
      }
      setVoiceTranscript(
        `${finalTranscriptRef.current} ${interimTranscript}`.trim(),
      );
    };

    recognition.onerror = (event: any) => {
      const code = String(event.error ?? "");
      if (pauseRequestedRef.current && code === "aborted") {
        pauseRequestedRef.current = false;
        recognitionRef.current = null;
        setIsListening(false);
        setIsSpeechPaused(true);
        setVoiceError("");
        setVoiceInfo(
          'Aufnahme pausiert. Mit "Fortsetzen" kannst du weiter diktieren.',
        );
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        setVoiceError(
          "Mikrofonzugriff wurde blockiert. Bitte Zugriff im Browser erlauben.",
        );
      } else if (code === "no-speech") {
        setVoiceError("Keine Sprache erkannt. Bitte erneut sprechen.");
      } else {
        setVoiceError(
          "Spracherkennung fehlgeschlagen. Bitte erneut versuchen.",
        );
      }
      shouldAutoApplyVoiceRef.current = false;
      pauseRequestedRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setIsSpeechPaused(false);
    };

    recognition.onend = () => {
      const finalizedTranscript = finalTranscriptRef.current.trim();
      const shouldAutoApply = shouldAutoApplyVoiceRef.current;
      const wasPaused = pauseRequestedRef.current;

      shouldAutoApplyVoiceRef.current = false;
      pauseRequestedRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceTranscript(finalizedTranscript);

      if (wasPaused) {
        setIsSpeechPaused(true);
        setVoiceInfo(
          'Aufnahme pausiert. Mit "Fortsetzen" weiter diktieren oder mit "Aufnahme stoppen" abschließen.',
        );
        return;
      }

      if (!shouldAutoApply) {
        return;
      }

      if (finalizedTranscript.length < 8) {
        setVoiceInfo("Keine Sprache erkannt. Felder blieben unverändert.");
        return;
      }

      setVoiceInfo("Aufnahme beendet. Felder werden automatisch übernommen.");
      void parseVoiceTranscript(finalizedTranscript, true);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
      setIsSpeechPaused(false);
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setIsSpeechPaused(false);
      setVoiceError(
        "Aufnahme konnte nicht gestartet werden. Bitte erneut versuchen.",
      );
      setVoiceInfo("");
    }
  }

  function pauseSpeechInput() {
    if (!recognitionRef.current || !isListening) {
      return;
    }

    pauseRequestedRef.current = true;
    shouldAutoApplyVoiceRef.current = false;
    recognitionRef.current.stop();
    setVoiceInfo("Aufnahme wird pausiert ...");
  }

  function stopSpeechInput() {
    if (recognitionRef.current) {
      pauseRequestedRef.current = false;
      setIsSpeechPaused(false);
      recognitionRef.current.stop();
      setVoiceInfo("Aufnahme wird beendet ...");
      return;
    }

    if (!isSpeechPaused) {
      return;
    }

    const finalizedTranscript = voiceTranscript.trim();
    finalTranscriptRef.current = finalizedTranscript;
    setIsSpeechPaused(false);

    if (finalizedTranscript.length < 8) {
      setVoiceInfo("Keine Sprache erkannt. Felder blieben unverändert.");
      return;
    }

    setVoiceInfo("Aufnahme beendet. Felder werden automatisch übernommen.");
    void parseVoiceTranscript(finalizedTranscript, true);
  }

  function numberToInput(value: number | undefined): string | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }
    if (value <= 0) {
      return undefined;
    }
    return String(value);
  }

  function sanitizeServiceDescription(
    value: string | undefined,
    transcript: string,
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    const cleaned = value.trim();
    if (cleaned.length < 3 || cleaned.length > 280) {
      return undefined;
    }

    const normalizedValue = cleaned.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedTranscript = transcript
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!normalizedTranscript) {
      return cleaned;
    }

    if (normalizedValue === normalizedTranscript) {
      return undefined;
    }

    const wordCount = normalizedValue.split(" ").filter(Boolean).length;
    if (normalizedTranscript.includes(normalizedValue) && wordCount > 16) {
      return undefined;
    }

    return cleaned;
  }

  function toDecimalInputValue(value: number): string {
    const asString = Number.isInteger(value) ? String(value) : String(value);
    return asString.replace(".", ",");
  }

  function normalizeVoiceUnit(rawUnit: string | undefined): string {
    const normalized = normalizeSearchValue(rawUnit ?? "");
    if (!normalized) {
      return UNIT_OPTIONS[0];
    }
    if (normalized === "stuck" || normalized === "stk") {
      return "Stück";
    }
    if (normalized === "m2" || normalized === "qm") {
      return "m²";
    }
    if (normalized === "m3") {
      return "m³";
    }
    if (
      normalized === "stunde" ||
      normalized === "stunden" ||
      normalized === "std" ||
      normalized === "h"
    ) {
      return "Std";
    }
    if (normalized === "psch" || normalized === "pauschale") {
      return "Pauschal";
    }

    const mapped = UNIT_OPTIONS.find(
      (option) => normalizeSearchValue(option) === normalized,
    );
    return mapped ?? UNIT_OPTIONS[0];
  }

  function toSelectedServicesFromVoicePositions(
    positions: ParsedVoicePosition[] | undefined,
  ): SelectedServiceEntry[] {
    if (!Array.isArray(positions) || positions.length === 0) {
      return [];
    }

    const grouped = new Map<string, SelectedServiceEntry>();

    for (const item of positions) {
      const description = capitalizeEntryStart(item.description ?? "");
      const quantity =
        typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
          ? item.quantity
          : NaN;
      const unitPrice =
        typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
          ? item.unitPrice
          : NaN;

      if (!description || !Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
        continue;
      }

      const groupLabel =
        capitalizeEntryStart(item.group ?? "") || DEFAULT_MANUAL_GROUP_LABEL;
      const existing = grouped.get(groupLabel);
      const subitem = createSubitemEntry(description);
      subitem.quantity = sanitizeQuantityInput(toDecimalInputValue(quantity));
      subitem.unit = normalizeVoiceUnit(item.unit);
      subitem.price = sanitizePriceInput(toDecimalInputValue(unitPrice));

      if (existing) {
        existing.subitems.push(subitem);
        continue;
      }

      grouped.set(groupLabel, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: groupLabel,
        subitems: [subitem],
      });
    }

    return Array.from(grouped.values());
  }

  async function parseVoiceTranscript(
    transcriptInput?: string,
    autoTriggered = false,
  ) {
    const transcript = (transcriptInput ?? voiceTranscript).trim();
    if (transcript.length < 8) {
      if (!autoTriggered) {
        setVoiceError(
          "Bitte etwas länger sprechen, damit die KI genug Daten hat.",
        );
      }
      return;
    }

    setIsParsingVoice(true);
    setVoiceError("");
    setVoiceMissingFields([]);

    try {
      const response = await fetch("/api/parse-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = (await response.json()) as VoiceParseResponse & {
        error?: string;
      };
      if (!response.ok) {
        setVoiceError(
          data.error ?? "Sprachdaten konnten nicht verarbeitet werden.",
        );
        return;
      }

      const fields = data.fields;
      const safeServiceDescription = sanitizeServiceDescription(
        fields.serviceDescription,
        transcript,
      );
      const parsedServiceEntries = toSelectedServicesFromVoicePositions(
        fields.positions,
      );
      const shouldAutofillServiceDescription =
        data.shouldAutofillServiceDescription === true;
      const applyConservativeFallback = data.usedFallback;
      const hasRecognizedStructuredContent =
        parsedServiceEntries.length > 0 ||
        Boolean(fields.companyName?.trim()) ||
        Boolean(fields.firstName?.trim()) ||
        Boolean(fields.lastName?.trim()) ||
        Boolean(fields.street?.trim()) ||
        Boolean(fields.postalCode?.trim()) ||
        Boolean(fields.city?.trim()) ||
        Boolean(fields.customerEmail?.trim()) ||
        Boolean(safeServiceDescription?.trim()) ||
        (typeof fields.hours === "number" &&
          Number.isFinite(fields.hours) &&
          fields.hours > 0) ||
        (typeof fields.hourlyRate === "number" &&
          Number.isFinite(fields.hourlyRate) &&
          fields.hourlyRate > 0) ||
        (typeof fields.materialCost === "number" &&
          Number.isFinite(fields.materialCost) &&
          fields.materialCost > 0);

      if (!hasRecognizedStructuredContent) {
        setVoiceInfo("Keine Sprache erkannt. Felder blieben unverändert.");
        setVoiceError("");
        setVoiceMissingFields([]);
        return;
      }
      let remainingMissingLabels: string[] = [];

      setForm((prev) => {
        const nextForm = {
          ...prev,
          customerType: fields.customerType ?? prev.customerType,
          companyName: fields.companyName
            ? capitalizeEntryStart(fields.companyName)
            : prev.companyName,
          salutation: fields.salutation ?? prev.salutation,
          firstName: applyConservativeFallback
            ? prev.firstName
            : (fields.firstName
              ? capitalizeEntryStart(fields.firstName)
              : prev.firstName),
          lastName: applyConservativeFallback
            ? prev.lastName
            : (fields.lastName
              ? capitalizeEntryStart(fields.lastName)
              : prev.lastName),
          street: fields.street
            ? capitalizeEntryStart(fields.street)
            : prev.street,
          postalCode: fields.postalCode ?? prev.postalCode,
          city: fields.city ? capitalizeEntryStart(fields.city) : prev.city,
          customerEmail: fields.customerEmail ?? prev.customerEmail,
          serviceDescription: applyConservativeFallback
            ? prev.serviceDescription
            : shouldAutofillServiceDescription
              ? (safeServiceDescription
                ? capitalizeEntryStart(safeServiceDescription)
                : prev.serviceDescription)
              : prev.serviceDescription,
          hours: numberToInput(fields.hours) ?? prev.hours,
          hourlyRate: numberToInput(fields.hourlyRate) ?? prev.hourlyRate,
          materialCost: numberToInput(fields.materialCost) ?? prev.materialCost,
        };

        remainingMissingLabels = (data.missingFieldKeys ?? [])
          .filter((key) => {
            if (key === "companyName") {
              return (
                nextForm.customerType === "company" &&
                !hasVoiceFieldValue(key, nextForm)
              );
            }

            if (key === "salutation" || key === "firstName" || key === "lastName") {
              return (
                nextForm.customerType === "person" &&
                !hasVoiceFieldValue(key, nextForm)
              );
            }

            return !hasVoiceFieldValue(key, nextForm);
          })
          .map((key) => VOICE_FIELD_LABELS[key] ?? key);

        return nextForm;
      });

      if (parsedServiceEntries.length > 0) {
        setSelectedServices(parsedServiceEntries);
        setServiceSearch("");
        setIsServiceSearchOpen(false);
      }

      const missingText =
        remainingMissingLabels.length > 0
          ? ` Bitte noch ergänzen: ${remainingMissingLabels.join(", ")}.`
          : " Alle Kernfelder wurden erkannt.";
      const modeText = data.usedFallback
        ? data.fallbackReason === "no_api_key"
          ? "KI nicht aktiv: OPENAI_API_KEY fehlt. Basis-Erkennung wurde verwendet."
          : "KI-Antwort fehlgeschlagen. Basis-Erkennung wurde verwendet."
        : "Sprachtext per KI übernommen.";
      const actionText = autoTriggered
        ? " Die Felder wurden automatisch ergänzt."
        : " Die Felder wurden ergänzt.";
      const tableText =
        parsedServiceEntries.length > 0
          ? " Die Positionstabelle wurde automatisch befüllt."
          : "";
      setVoiceInfo(`${modeText}${actionText}${tableText}${missingText}`);
      setVoiceError("");
      setVoiceMissingFields(remainingMissingLabels);
      setAddressSuggestions([]);
    } catch {
      setVoiceMissingFields([]);
      setVoiceError("Netzwerkfehler bei der Sprachverarbeitung.");
    } finally {
      setIsParsingVoice(false);
    }
  }

  function createPdfFile(pdfBase64: string, filename: string) {
    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: "application/pdf" });
  }

  function downloadPdfFile(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function openMailDraftWithDocument(
    payload: ApiResponse,
    mode: DocumentMode,
  ) {
    const resolvedDocumentNumber =
      payload.documentNumber?.trim() ||
      payload.offerNumber?.trim() ||
      payload.invoiceNumber?.trim() ||
      (mode === "invoice" ? "RECHNUNG" : "ANGEBOT");
    const fileName = `${resolvedDocumentNumber}.pdf`;
    const documentLabel = mode === "invoice" ? "Rechnung" : "Angebot";

    try {
      const draftResponse = await fetch("/api/email/create-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: form.customerEmail.trim(),
          subject: payload.offer.subject,
          text: payload.mailText,
          pdfBase64: payload.pdfBase64,
          filename: fileName,
        }),
      });

      const draftData = (await draftResponse.json()) as EmailDraftApiResponse;
      if (draftResponse.ok && draftData.ok) {
        window.location.href = draftData.composeUrl;
        return `Mail-Entwurf mit ${documentLabel}-PDF-Anhang wurde geöffnet.`;
      }

      if (!draftData.ok && draftData.reason !== "not_connected") {
        return draftData.info;
      }
    } catch {
      // Wenn Draft-Flow fehlschlägt, wird auf Share/Download zurückgefallen.
    }

    const file = createPdfFile(payload.pdfBase64, fileName);
    if (
      typeof navigator !== "undefined" &&
      "canShare" in navigator &&
      "share" in navigator
    ) {
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            title: payload.offer.subject,
            text: payload.mailText,
            files: [file],
          });
          return "Mail-Entwurf über den Teilen-Dialog geöffnet.";
        } catch {
          // Ignorieren und auf Download zurückfallen.
        }
      }
    }

    downloadPdfFile(file);
    return `Kein verbundenes Postfach gefunden. ${documentLabel}-PDF wurde heruntergeladen; bitte im Mail-Programm anhängen.`;
  }

  function buildValidatedPositions(services: SelectedServiceEntry[]): {
    positions: OfferPositionInput[];
    errorMessage: string;
  } {
    const positions: OfferPositionInput[] = [];

    for (const service of services) {
      for (const subitem of service.subitems) {
        const description = subitem.description.trim();
        const quantityRaw = subitem.quantity.trim();
        const priceRaw = subitem.price.trim();
        const hasAnyValue = Boolean(description || quantityRaw || priceRaw);

        if (!hasAnyValue) {
          continue;
        }

        if (!description) {
          return {
            positions: [],
            errorMessage: `Bitte Unterpunkt-Bezeichnung für "${service.label}" ausfüllen.`,
          };
        }

        const quantity = parseLocaleNumber(quantityRaw);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return {
            positions: [],
            errorMessage: `Bitte eine gültige Menge für "${description}" eingeben.`,
          };
        }

        if (!priceRaw) {
          return {
            positions: [],
            errorMessage: `EP / Preis EUR ist für "${description}" verpflichtend.`,
          };
        }

        const price = parseLocaleNumber(priceRaw);
        if (!Number.isFinite(price) || price < 0) {
          return {
            positions: [],
            errorMessage: `Bitte einen gültigen EP / Preis EUR für "${description}" eingeben.`,
          };
        }

        positions.push({
          group: service.label.trim(),
          description,
          quantity: String(quantity),
          unit: getSubitemUnit(subitem),
          unitPrice: String(price),
        });
      }
    }

    if (services.length > 0 && positions.length === 0) {
      return {
        positions: [],
        errorMessage:
          "Bitte mindestens einen Unterpunkt mit Menge und EP / Preis EUR erfassen.",
      };
    }

    return {
      positions,
      errorMessage: "",
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPostActionInfo("");

    const selectedServicesPayload = selectedServices
      .map(selectedServiceToRequestValue)
      .filter((value) => value.length > 0);
    const selectedServiceEntriesPayload =
      selectedServicesToDraftPayload(selectedServices);
    const { positions: positionsPayload, errorMessage } =
      buildValidatedPositions(selectedServices);

    if (errorMessage) {
      setError(errorMessage);
      return;
    }

    if (
      !form.serviceDescription.trim() &&
      selectedServicesPayload.length === 0 &&
      positionsPayload.length === 0
    ) {
      setError(
        "Bitte mindestens eine Leistung auswählen oder eine Projektbeschreibung eingeben.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      let settingsPayload = companySettings;
      try {
        const settingsResponse = await fetch("/api/settings");
        const settingsData = (await settingsResponse.json()) as SettingsApiResponse;
        if (settingsResponse.ok && settingsData.settings) {
          settingsPayload = settingsData.settings;
          setCompanySettings(settingsData.settings);
        }
      } catch {
        // Fallback auf zuletzt bekannte Einstellungen.
      }

      if (!settingsPayload) {
        settingsPayload = readSettingsDraftFromSessionStorageForOffer();
      }

      const response = await fetch("/api/generate-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          documentType: documentMode,
          customerNumber: activeCustomerNumber || undefined,
          selectedServices: selectedServicesPayload,
          selectedServiceEntries: selectedServiceEntriesPayload,
          positions: positionsPayload,
          settings: settingsPayload ?? undefined,
          sendEmail: false,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Unbekannter Fehler");
        return;
      }

      const payload = data as ApiResponse;
      if (payload.customerNumber?.trim()) {
        setActiveCustomerNumber(payload.customerNumber.trim());
      }
      updateStoredCustomersRealtime(payload);
      if (
        payload.customerNumber &&
        payload.documentNumber &&
        selectedArchiveCustomerNumber &&
        payload.customerNumber === selectedArchiveCustomerNumber
      ) {
        const nextDocument: CustomerArchiveDocument = {
          documentNumber: payload.documentNumber,
          documentType:
            payload.documentType === "invoice" ? "invoice" : "offer",
          customerNumber: payload.customerNumber,
          customerName: buildCustomerNameForStorage(form),
          createdAt: new Date().toISOString(),
        };
        setArchiveDocuments((prev) => {
          const deduplicated = prev.filter(
            (document) =>
              document.documentNumber !== nextDocument.documentNumber,
          );
          return [nextDocument, ...deduplicated];
        });
      }
      void loadStoredCustomers();
      const payloadMode =
        payload.documentType === "invoice" ? "invoice" : documentMode;
      const info = await openMailDraftWithDocument(payload, payloadMode);
      setPostActionInfo(info);
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container pageSurfaceTransition">
        <header className="topHeaderMinimal">
          <button
            type="button"
            className="topHeaderSettingsButton topHeaderArchiveButton"
            aria-label="Kundenarchiv öffnen"
            title="Kundenarchiv"
            onClick={openCustomerArchive}
          >
            <svg
              viewBox="0 0 24 24"
              className="topHeaderIcon"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M3.8 7.1a1.6 1.6 0 0 1 1.6-1.6h4.3l1.4 1.7h7.5a1.6 1.6 0 0 1 1.6 1.6v8.6a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6V7.1Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3.8 10h16.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className="pill topHeaderLogo">Visioro</span>
          <Link
            href="/settings"
            className={`topHeaderSettingsButton ${isOpeningSettings ? "isNavigating" : ""}`}
            aria-label="Einstellungen"
            title="Einstellungen"
            onClick={openSettingsWithAnimation}
          >
            <svg
              viewBox="0 0 24 24"
              className="topHeaderIcon"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M9.6 3.5h4.8l.44 2.1a6.88 6.88 0 0 1 1.5.87l2.03-.75 2.4 4.15-1.6 1.45c.06.45.06.91 0 1.36l1.6 1.45-2.4 4.15-2.03-.75c-.47.35-.98.64-1.5.87l-.44 2.1H9.6l-.44-2.1a6.88 6.88 0 0 1-1.5-.87l-2.03.75-2.4-4.15 1.6-1.45a5.5 5.5 0 0 1 0-1.36l-1.6-1.45 2.4-4.15 2.03.75c.47-.35.98-.64 1.5-.87L9.6 3.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx="12"
                cy="12"
                r="2.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              />
            </svg>
          </Link>
        </header>

        {isCustomerArchiveOpen ? (
          <div
            className={`customerArchiveBackdrop ${isClosingCustomerArchive ? "closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Kundenarchiv"
            onClick={closeCustomerArchive}
          >
            <section
              className={`customerArchiveSheet ${isClosingCustomerArchive ? "closing" : ""}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="customerArchiveHeader">
                <strong>Kundenarchiv</strong>
                <button
                  type="button"
                  className="customerArchiveCloseButton"
                  aria-label="Archiv schließen"
                  onClick={closeCustomerArchive}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="topHeaderIcon"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="customerArchiveTree">
                {!selectedArchiveCustomer ? (
                  <>
                    {isCustomersLoading ? (
                      <p className="customerArchiveHint">
                        Gespeicherte Kunden werden geladen ...
                      </p>
                    ) : null}
                    {!isCustomersLoading && customersError ? (
                      <p className="voiceWarning" role="alert">
                        {customersError}
                      </p>
                    ) : null}
                    {!isCustomersLoading &&
                    !customersError &&
                    storedCustomers.length === 0 ? (
                      <p className="customerArchiveHint">
                        Noch keine gespeicherten Kunden vorhanden.
                      </p>
                    ) : null}

                    {!isCustomersLoading &&
                    !customersError &&
                    storedCustomers.length > 0 ? (
                      <div className="customerArchiveList" role="list">
                        {storedCustomers.map((customer) => (
                          <div
                            key={customer.customerNumber}
                            className="customerArchiveNode"
                            role="listitem"
                          >
                            <button
                              type="button"
                              className="customerArchiveCustomerButton"
                              onClick={() => selectArchiveCustomer(customer)}
                            >
                              <div className="customerArchiveCustomerHead">
                                <strong>{customer.customerName}</strong>
                                <span>{customer.customerNumber}</span>
                              </div>
                              <div className="customerArchiveCustomerMeta">
                                <p>{customer.customerAddress}</p>
                                <svg
                                  viewBox="0 0 24 24"
                                  className="customerArchiveExpandIcon"
                                  aria-hidden="true"
                                  focusable="false"
                                >
                                  <path
                                    d="m10 7 5 5-5 5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.9"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </div>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="customerArchiveDetailView">
                    <button
                      type="button"
                      className="customerArchiveBackButton"
                      onClick={clearArchiveCustomerSelection}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="customerArchiveBackIcon"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="m14.6 6.7-5.2 5.3 5.2 5.3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Zurück zur Kundenliste
                    </button>

                    <div className="customerArchiveDetailHeader">
                      <strong>{selectedArchiveCustomer.customerName}</strong>
                      <span>{selectedArchiveCustomer.customerNumber}</span>
                      <p>{selectedArchiveCustomer.customerAddress}</p>
                    </div>

                    <p className="customerArchiveTitle">
                      Dokumente für {selectedArchiveCustomer.customerName}
                    </p>

                    {isArchiveDocumentsLoading ? (
                      <p className="customerArchiveHint">
                        Dokumente werden geladen ...
                      </p>
                    ) : null}
                    {!isArchiveDocumentsLoading && archiveError ? (
                      <p className="voiceWarning" role="alert">
                        {archiveError}
                      </p>
                    ) : null}
                    {!isArchiveDocumentsLoading &&
                    !archiveError &&
                    archiveDocuments.length === 0 ? (
                      <p className="customerArchiveHint">
                        Für diesen Kunden sind noch keine Dokumente gespeichert.
                      </p>
                    ) : null}

                    {!isArchiveDocumentsLoading &&
                    !archiveError &&
                    archiveDocuments.length > 0 ? (
                      <div className="customerArchiveDocumentGroups">
                        <div className="customerArchiveDocumentGroup">
                          <button
                            type="button"
                            className="customerArchiveSectionToggle"
                            aria-expanded={isArchiveOffersOpen}
                            onClick={() =>
                              setIsArchiveOffersOpen((value) => !value)
                            }
                          >
                            <span className="customerArchiveGroupLabel">
                              Angebote
                            </span>
                            <span className="customerArchiveSectionMeta">
                              {archiveOfferDocuments.length}
                            </span>
                          </button>
                          {isArchiveOffersOpen ? (
                            archiveOfferDocuments.length === 0 ? (
                              <p className="customerArchiveHint customerArchiveHintCompact">
                                Keine Angebote vorhanden.
                              </p>
                            ) : (
                              <div className="customerArchiveDocumentList">
                                {archiveOfferDocuments.map((document) => (
                                  <a
                                    key={document.documentNumber}
                                    className="customerArchiveDocumentItem customerArchiveDocumentLink"
                                    href={`/api/customer-documents/${encodeURIComponent(document.documentNumber)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <div className="customerArchiveDocumentMeta">
                                      <strong>{document.documentNumber}</strong>
                                      <span>
                                        Angebot •{" "}
                                        {formatArchiveDate(document.createdAt)}
                                      </span>
                                    </div>
                                  </a>
                                ))}
                              </div>
                            )
                          ) : null}
                        </div>

                        <div className="customerArchiveDocumentGroup">
                          <button
                            type="button"
                            className="customerArchiveSectionToggle"
                            aria-expanded={isArchiveInvoicesOpen}
                            onClick={() =>
                              setIsArchiveInvoicesOpen((value) => !value)
                            }
                          >
                            <span className="customerArchiveGroupLabel">
                              Rechnungen
                            </span>
                            <span className="customerArchiveSectionMeta">
                              {archiveInvoiceDocuments.length}
                            </span>
                          </button>
                          {isArchiveInvoicesOpen ? (
                            archiveInvoiceDocuments.length === 0 ? (
                              <p className="customerArchiveHint customerArchiveHintCompact">
                                Keine Rechnungen vorhanden.
                              </p>
                            ) : (
                              <div className="customerArchiveDocumentList">
                                {archiveInvoiceDocuments.map((document) => (
                                  <a
                                    key={document.documentNumber}
                                    className="customerArchiveDocumentItem customerArchiveDocumentLink"
                                    href={`/api/customer-documents/${encodeURIComponent(document.documentNumber)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <div className="customerArchiveDocumentMeta">
                                      <strong>{document.documentNumber}</strong>
                                      <span>
                                        Rechnung •{" "}
                                        {formatArchiveDate(document.createdAt)}
                                      </span>
                                    </div>
                                  </a>
                                ))}
                              </div>
                            )
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {isInfoLegalOpen ? (
          <div
            className={`infoLegalBackdrop ${isClosingInfoLegal ? "closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Info und rechtliche Hinweise"
            onClick={closeInfoLegalModal}
          >
            <section
              className={`infoLegalSheet ${isClosingInfoLegal ? "closing" : ""}`}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="infoLegalHeader">
                <h2 className="infoLegalHeading">Info &amp; Rechtliche Hinweise</h2>
                <button
                  type="button"
                  className="infoLegalCloseButton"
                  aria-label="Info-Fenster schließen"
                  onClick={closeInfoLegalModal}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="topHeaderIcon"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </header>

              <div className="infoLegalContent">
                <h3>Offline-Betrieb &amp; Datenschutz</h3>
                <p>
                  Diese Software arbeitet überwiegend lokal. Alle Kundendaten,
                  Angebots- und Rechnungsinformationen sowie PDF-Dateien werden
                  primär auf dem Gerät des Nutzers gespeichert.
                </p>
                <p>
                  Es findet keine automatische Weitergabe dieser Daten an den
                  Anbieter oder Dritte statt.
                </p>
                <p>
                  Sofern KI-Funktionen genutzt werden, können zur Verarbeitung
                  Inhalte temporär an externe Dienste (z. B. OpenAI) übermittelt
                  werden. Dabei werden keine Daten dauerhaft gespeichert oder
                  weitergegeben.
                </p>
                <p>
                  Der Nutzer ist verantwortlich für die Einhaltung der geltenden
                  Datenschutzbestimmungen (insbesondere DSGVO), sowie für
                  Datensicherung, sichere Passwörter und Zugriffsschutz.
                </p>

                <h3>Datenschutzrechte</h3>
                <p>
                  Nutzer haben im Rahmen der gesetzlichen Bestimmungen das Recht
                  auf Auskunft, Berichtigung, Löschung und Einschränkung der
                  Verarbeitung ihrer Daten.
                </p>
                <p>
                  Bei Fragen zum Datenschutz können Sie sich jederzeit an den
                  Anbieter wenden.
                </p>

                <h3>Lizenzprüfung &amp; Internetverbindung</h3>
                <p>
                  Zur Lizenzprüfung kann beim Start oder in regelmäßigen
                  Abständen - sofern eine Internetverbindung besteht - eine
                  anonyme Anfrage an den VISIORO-Server gesendet werden. Dabei
                  werden ausschließlich technische Informationen wie Lizenzstatus
                  und Zeitstempel übertragen.
                </p>
                <p>
                  Es werden keine sensiblen oder personenbezogenen Daten
                  übermittelt.
                </p>
                <p>
                  Die Nutzung der Software ist auch ohne Internetverbindung
                  möglich (mit Ausnahme von KI-Funktionen).
                </p>

                <h3>Verantwortlichkeit</h3>
                <p>
                  Für die Richtigkeit, Vollständigkeit und rechtliche
                  Zulässigkeit der erstellten Angebote und Rechnungen ist
                  ausschließlich der Nutzer verantwortlich. Der Anbieter
                  übernimmt keine Haftung für Fehler, unvollständige Angaben
                  oder daraus resultierende Schäden.
                </p>

                <h3>KI-Hinweis</h3>
                <p>
                  Die durch KI generierten Inhalte dienen lediglich als
                  Unterstützung und müssen vom Nutzer vor Verwendung geprüft und
                  freigegeben werden.
                </p>

                <h3>Endbenutzer-Lizenzvereinbarung (EULA)</h3>
                <p>
                  Diese Software darf ausschließlich im Rahmen ihrer vorgesehenen
                  Nutzung verwendet werden. Eine Weitergabe, Vervielfältigung
                  oder kommerzielle Weiterverwertung der Software oder ihrer
                  Bestandteile ist ohne ausdrückliche Genehmigung untersagt.
                </p>
                <p>
                  Mit der Nutzung der Software akzeptiert der Nutzer diese
                  Bedingungen.
                </p>

                <h3>Anbieter</h3>
                <p className="infoLegalProvider">
                  VISIORO SH.P.K.
                  <br />
                  Rr. Rifat Berisha 10
                  <br />
                  10000 Prishtina, Kosovo
                  <br />
                  E-Mail: info@visioro.com
                </p>
              </div>
            </section>
          </div>
        ) : null}

        <div className="documentModeSwitchTop">
          <div className="documentModeSwitch" role="group" aria-label="Modus auswählen">
            <button
              type="button"
              className={`documentModeSwitchButton ${documentMode === "offer" ? "active" : ""}`}
              aria-pressed={documentMode === "offer"}
              onClick={() => switchDocumentMode("offer")}
            >
              Angebote
            </button>
            <button
              type="button"
              className={`documentModeSwitchButton ${documentMode === "invoice" ? "active" : ""}`}
              aria-pressed={documentMode === "invoice"}
              onClick={() => switchDocumentMode("invoice")}
            >
              Rechnungen
            </button>
          </div>
        </div>

        <div key={`${documentMode}-${modeAnimationKey}`} className="documentModeContent">
          <section className="workspaceGrid workspaceGridSingle">
          <article className="glassCard formCard">
            <div className="customerPickerPanel">
              <button
                type="button"
                className="ghostButton customerPickerToggle"
                onClick={toggleStoredCustomers}
              >
                {isCustomerPickerOpen
                  ? "Gespeicherte Kunden schließen"
                  : "Gespeicherte Kunden"}
              </button>
              {isCustomerPickerOpen ? (
                <div className="customerPickerList">
                  <input
                    className="customerPickerSearch"
                    type="search"
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="Kunde suchen (Name, Firma, Adresse)"
                    aria-label="Gespeicherte Kunden suchen"
                  />

                  <div className="customerPickerResults" role="list">
                    {isCustomersLoading ? (
                      <p className="customerPickerHint">
                        Gespeicherte Kunden werden geladen ...
                      </p>
                    ) : null}
                    {!isCustomersLoading && customersError ? (
                      <p className="voiceWarning" role="alert">
                        {customersError}
                      </p>
                    ) : null}
                    {!isCustomersLoading &&
                    !customersError &&
                    storedCustomers.length === 0 ? (
                      <p className="customerPickerHint">
                        Noch keine gespeicherten Kunden vorhanden.
                      </p>
                    ) : null}
                    {!isCustomersLoading &&
                    !customersError &&
                    storedCustomers.length > 0 &&
                    filteredStoredCustomers.length === 0 ? (
                      <p className="customerPickerHint">
                        Keine Kunden zur Suche gefunden.
                      </p>
                    ) : null}
                    {!isCustomersLoading &&
                    !customersError &&
                    filteredStoredCustomers.length > 0
                      ? filteredStoredCustomers.map((customer) => (
                          <div
                            key={customer.customerNumber}
                            className="customerPickerItemRow"
                            role="listitem"
                          >
                            <button
                              type="button"
                              className="customerPickerItem customerPickerApplyButton"
                              onClick={() => applyStoredCustomer(customer)}
                            >
                              <div className="customerPickerItemHeader">
                                <strong>{customer.customerName}</strong>
                                <span>{customer.customerNumber}</span>
                              </div>
                              <p>{customer.customerAddress}</p>
                              <p>{customer.customerEmail}</p>
                            </button>
                            <button
                              type="button"
                              className="customerPickerDeleteButton"
                              aria-label={`${customer.customerName} löschen`}
                              title="Kunde löschen"
                              disabled={deletingCustomerNumber === customer.customerNumber}
                              onClick={() => void deleteStoredCustomer(customer)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className="customerPickerDeleteIcon"
                                aria-hidden="true"
                                focusable="false"
                              >
                                <path
                                  d="M9 4.5h6m-8 3h10m-8 0-.5 11h5l.5-11m-3.5 0V6.5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          </div>
                        ))
                      : null}
                  </div>
                </div>
              ) : null}
            </div>

            <form onSubmit={onSubmit} className="formGrid">
              <div className="voicePanel span2">
                <div className="voicePanelHeader">
                  <strong>Per Sprache ausfüllen</strong>
                  <p>
                    Sprich alle Angebotsdaten frei ein - relevante Angaben
                    werden automatisch erkannt und direkt in die Felder
                    übernommen.
                  </p>
                </div>

                <div className="voiceActions">
                  {isListening ? (
                    <>
                      <button
                        type="button"
                        className="ghostButton voiceActionButton voiceActionButtonPause"
                        onClick={pauseSpeechInput}
                        disabled={!speechSupported || isParsingVoice}
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        className="ghostButton voiceActionButton voiceActionButtonStop"
                        onClick={stopSpeechInput}
                        disabled={!speechSupported || isParsingVoice}
                      >
                        Aufnahme stoppen
                      </button>
                    </>
                  ) : isSpeechPaused ? (
                    <>
                      <button
                        type="button"
                        className="ghostButton voiceActionButton voiceActionButtonResume"
                        onClick={startSpeechInput}
                        disabled={!speechSupported || isParsingVoice}
                      >
                        Fortsetzen
                      </button>
                      <button
                        type="button"
                        className="ghostButton voiceActionButton voiceActionButtonStop"
                        onClick={stopSpeechInput}
                        disabled={!speechSupported || isParsingVoice}
                      >
                        Aufnahme stoppen
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ghostButton voiceActionButton voiceActionButtonStart"
                      onClick={startSpeechInput}
                      disabled={!speechSupported || isParsingVoice}
                    >
                      Aufnahme starten
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghostButton voiceActionButton voiceActionButtonClear"
                    onClick={resetCurrentInputs}
                    disabled={isSubmitting}
                  >
                    Felder leeren
                  </button>
                </div>

                <label className="field">
                  <span>Gesprochener Text</span>
                  <textarea
                    className="voiceTranscriptTextarea"
                    rows={3}
                    value={voiceTranscript}
                    onChange={(e) => {
                      setVoiceTranscript(e.target.value);
                      setVoiceMissingFields([]);
                    }}
                    placeholder="z. B. Max Müller, Musterstraße 5, Düsseldorf, Betonarbeiten 2 Stück à 120 Euro"
                  />
                </label>

                {!speechSupported ? (
                  <p className="voiceWarning">
                    Spracherkennung wird auf diesem Browser nicht unterstützt.
                  </p>
                ) : null}
                {voiceInfo ? (
                  <p className="voiceInfo" role="status" aria-live="polite">
                    {voiceInfo}
                  </p>
                ) : null}
                {voiceError ? (
                  <p className="voiceWarning" role="alert">
                    {voiceError}
                  </p>
                ) : null}
                {voiceMissingFields.length > 0 ? (
                  <div className="voiceMissingPanel">
                    <span className="voiceMissingLabel">
                      Noch zu ergänzen
                    </span>
                    <div className="voiceMissingList">
                      {voiceMissingFields.map((field) => (
                        <span key={field} className="voiceMissingTag">
                          {field}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div
                className="recipientType span2"
                role="group"
                aria-label="Kundenart"
              >
                <span>Kundenart</span>
                <div className="recipientTypeButtons">
                  <button
                    type="button"
                    className={`recipientTypeButton ${form.customerType === "person" ? "active" : ""}`}
                    onClick={() =>
                      setForm((prev) => ({ ...prev, customerType: "person" }))
                    }
                  >
                    Privatperson
                  </button>
                  <button
                    type="button"
                    className={`recipientTypeButton ${form.customerType === "company" ? "active" : ""}`}
                    onClick={() =>
                      setForm((prev) => ({ ...prev, customerType: "company" }))
                    }
                  >
                    Firma
                  </button>
                </div>
              </div>

              {form.customerType === "company" ? (
                <label className="field span2">
                  <span>Firma</span>
                  <input
                    required
                    autoComplete="organization"
                    autoCapitalize="words"
                    value={form.companyName}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        companyName: capitalizeEntryStart(e.target.value),
                      }))
                    }
                  />
                </label>
              ) : null}

              <label className="field span2">
                <span>
                  {form.customerType === "company"
                    ? "Anrede Ansprechpartner (optional)"
                    : "Anrede"}
                </span>
                <div className="selectWithIndicator">
                  <select
                    className="selectWithIndicatorInput"
                    required={form.customerType === "person"}
                    value={form.salutation}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        salutation: e.target.value === "frau" ? "frau" : "herr",
                      }))
                    }
                  >
                    <option value="herr">Herr</option>
                    <option value="frau">Frau</option>
                  </select>
                  <span className="serviceSearchIndicator" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      className="serviceSearchIndicatorIcon"
                      focusable="false"
                    >
                      <path
                        d="m8 10 4-4 4 4m-8 4 4 4 4-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
              </label>

              <label className="field">
                <span>Vorname</span>
                <input
                  required={form.customerType === "person"}
                  autoComplete="given-name"
                  autoCapitalize="words"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      firstName: capitalizeEntryStart(e.target.value),
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>Nachname</span>
                <input
                  required={form.customerType === "person"}
                  autoComplete="family-name"
                  autoCapitalize="words"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      lastName: capitalizeEntryStart(e.target.value),
                    }))
                  }
                />
              </label>

              <label className="field span2">
                <span>Straße und Hausnummer</span>
                <div className="addressAutocomplete">
                  <input
                    required
                    autoComplete="address-line1"
                    autoCapitalize="words"
                    value={form.street}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        street: capitalizeEntryStart(e.target.value),
                      }))
                    }
                  />
                  {(isAddressLoading || addressSuggestions.length > 0) && (
                    <div
                      className="addressSuggestions"
                      role="listbox"
                      aria-label="Adressvorschläge"
                    >
                      {isAddressLoading ? (
                        <p className="addressHint">Suche Adressen ...</p>
                      ) : null}
                      {addressSuggestions.map((suggestion, index) => (
                        <button
                          key={`${suggestion.primary}-${suggestion.secondary}-${index}`}
                          type="button"
                          className="addressSuggestionButton"
                          onClick={() => applyAddressSuggestion(suggestion)}
                        >
                          <strong>{suggestion.primary}</strong>
                          {suggestion.secondary ? (
                            <span>{suggestion.secondary}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>

              <label className="field">
                <span>PLZ</span>
                <input
                  required
                  autoComplete="postal-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.postalCode}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, postalCode: e.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Ort</span>
                <input
                  required
                  autoComplete="address-level2"
                  autoCapitalize="words"
                  value={form.city}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      city: capitalizeEntryStart(e.target.value),
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>Kunden-E-Mail</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={form.customerEmail}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      customerEmail: e.target.value,
                    }))
                  }
                />
              </label>

              {isInvoiceMode ? (
                <>
                  <label className="field invoiceMetaField">
                    <span>Rechnungsdatum</span>
                    <div className="dateInputWithIcon">
                      <input
                        ref={invoiceDateInputRef}
                        className="invoiceMetaInput"
                        required
                        type="date"
                        value={form.invoiceDate}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            invoiceDate: event.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="dateInputIconButton"
                        aria-label="Kalender öffnen"
                        title="Kalender öffnen"
                        onClick={openInvoiceDatePicker}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="dateInputIcon"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M7 4.5v2.2m10-2.2v2.2M5.5 9h13m-12 10h11.2a1 1 0 0 0 1-1V7.3a1 1 0 0 0-1-1H6.7a1 1 0 0 0-1 1V18a1 1 0 0 0 1 1Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </label>

                  <label className="field invoiceMetaField">
                    <span>Leistungszeitraum</span>
                    <div
                      className="serviceDateRangePicker"
                      ref={serviceDateRangePickerRef}
                    >
                      <div className="dateInputWithIcon serviceDateRangeInputWrap">
                        <input
                          className="invoiceMetaInput serviceDateRangeInput"
                          required
                          type="text"
                          readOnly
                          placeholder="Zeitraum auswählen"
                          value={form.serviceDate}
                          onClick={openServiceDateRangePicker}
                        />
                        <button
                          type="button"
                          className="dateInputIconButton"
                          aria-label="Leistungszeitraum auswählen"
                          title="Leistungszeitraum auswählen"
                          onClick={openServiceDateRangePicker}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="dateInputIcon"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path
                              d="M7 4.5v2.2m10-2.2v2.2M5.5 9h13m-12 10h11.2a1 1 0 0 0 1-1V7.3a1 1 0 0 0-1-1H6.7a1 1 0 0 0-1 1V18a1 1 0 0 0 1 1Z"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>

                      {isServiceDateRangePickerOpen ? (
                        <div
                          className="serviceDateRangePopover"
                          role="dialog"
                          aria-label="Leistungszeitraum auswählen"
                        >
                          <div className="serviceDateRangeHeader">
                            <button
                              type="button"
                              className="serviceDateRangeMonthButton"
                              aria-label="Vorheriger Monat"
                              onClick={() =>
                                setServiceDateCalendarMonth((prev) =>
                                  shiftMonthValue(prev, -1),
                                )
                              }
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className="serviceDateRangeMonthIcon"
                                aria-hidden="true"
                                focusable="false"
                              >
                                <path
                                  d="M14.7 6.8 9.3 12l5.4 5.2"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                            <strong>{serviceDateCalendarMonthLabel}</strong>
                            <button
                              type="button"
                              className="serviceDateRangeMonthButton"
                              aria-label="Nächster Monat"
                              onClick={() =>
                                setServiceDateCalendarMonth((prev) =>
                                  shiftMonthValue(prev, 1),
                                )
                              }
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className="serviceDateRangeMonthIcon"
                                aria-hidden="true"
                                focusable="false"
                              >
                                <path
                                  d="M9.3 6.8 14.7 12l-5.4 5.2"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          </div>

                          <div className="serviceDateRangeWeekdays">
                            {SERVICE_DATE_WEEKDAY_LABELS.map((weekday) => (
                              <span key={weekday}>{weekday}</span>
                            ))}
                          </div>

                          <div className="serviceDateRangeGrid">
                            {serviceDateCalendarDays.map((day) => {
                              const isStart = day.dateValue === serviceDateRangeStart;
                              const isEnd = day.dateValue === serviceDateRangeEnd;
                              const hasFullRange =
                                Boolean(serviceDateRangeStart) &&
                                Boolean(serviceDateRangeEnd);
                              const isInRange =
                                hasFullRange &&
                                day.dateValue > serviceDateRangeStart &&
                                day.dateValue < serviceDateRangeEnd;

                              return (
                                <button
                                  key={day.dateValue}
                                  type="button"
                                  className={`serviceDateRangeDay ${day.inCurrentMonth ? "" : "isOutside"} ${isInRange ? "isInRange" : ""} ${isStart ? "isStart" : ""} ${isEnd ? "isEnd" : ""}`}
                                  onClick={() =>
                                    selectServiceDateRangeDay(day.dateValue)
                                  }
                                >
                                  {day.dayNumber}
                                </button>
                              );
                            })}
                          </div>

                          <div className="serviceDateRangeFooter">
                            <span className="serviceDateRangeSummary">
                              {serviceDateRangeSummary}
                            </span>
                            <div className="serviceDateRangeActions">
                              <button
                                type="button"
                                className="ghostButton serviceDateRangeActionButton"
                                onClick={clearServiceDateRange}
                              >
                                Leeren
                              </button>
                              <button
                                type="button"
                                className="ghostButton serviceDateRangeActionButton"
                                onClick={closeServiceDateRangePicker}
                              >
                                Schließen
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </label>

                  <label className="field invoiceMetaField">
                    <span>Zahlungsziel (Tage)</span>
                    <input
                      className="invoiceMetaInput"
                      required
                      type="number"
                      min="1"
                      step="1"
                      value={form.paymentDueDays}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          paymentDueDays: event.target.value.replace(/[^\d]/g, ""),
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}

              <div className="field span2 positionsTableField">
                <div className="positionsIntegratedPanel">
                  <div className="positionsSearchPanel">
                    <div className="positionsSearchPanelHeader">
                      <span className="positionsSearchPanelTitle">
                        Leistung suchen
                      </span>
                      <span className="positionsSearchPanelHint">
                        Direkt im Bereich Bezeichnung / Unterpunkt hinzufügen
                      </span>
                    </div>
                    <div className="servicePicker positionsServicePicker" ref={servicePickerRef}>
                      <input
                        className="serviceSearchInput"
                        value={serviceSearch}
                        placeholder="z. B. Fliesenarbeiten, Betonarbeiten, Elektroinstallation"
                        autoCapitalize="words"
                        onFocus={() => setIsServiceSearchOpen(true)}
                        onChange={(event) => {
                          setServiceSearch(event.target.value);
                          setIsServiceSearchOpen(true);
                          setServiceInfo("");
                          setServiceError("");
                        }}
                      />
                      <span className="serviceSearchIndicator" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          className="serviceSearchIndicatorIcon"
                          focusable="false"
                        >
                          <path
                            d="m8 10 4-4 4 4m-8 4 4 4 4-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>

                      {isServiceSearchOpen ? (
                        <div
                          className="serviceSuggestionList"
                          role="listbox"
                          aria-label="Leistungsvorschläge"
                        >
                          {isServiceCatalogLoading ? (
                            <p className="serviceSuggestionHint">
                              Leistungen werden geladen ...
                            </p>
                          ) : null}

                          {groupedServiceSuggestions.map(
                            ([category, suggestions]) => (
                              <div
                                key={category}
                                className="serviceSuggestionGroup"
                              >
                                <p className="serviceSuggestionGroupLabel">
                                  {category}
                                </p>
                                {suggestions.map((service) => (
                                  <button
                                    key={service.id}
                                    type="button"
                                    className="serviceSuggestionButton"
                                    onClick={() =>
                                      addSelectedService(service.label)
                                    }
                                  >
                                    <strong>{service.label}</strong>
                                    {service.source === "custom" ? (
                                      <span>Eigene Leistung</span>
                                    ) : (
                                      <span>Standard</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            ),
                          )}

                          {!isServiceCatalogLoading &&
                          groupedServiceSuggestions.length === 0 ? (
                            <p className="serviceSuggestionHint">
                              Keine passenden Leistungen gefunden.
                            </p>
                          ) : null}

                          {canCreateCustomService ? (
                            <button
                              type="button"
                              className="serviceAddCustomButton"
                              onClick={addCustomService}
                              disabled={isAddingCustomService}
                            >
                              {isAddingCustomService
                                ? "Eigene Leistung wird gespeichert ..."
                                : `+ Eigene Leistung hinzufügen: "${serviceSearchValue}"`}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="positionsInputWrap positionsInputWrapMerged">
                    <table className="positionsInputTable">
                      <thead>
                        <tr>
                          <th>Bezeichnung / Unterpunkt</th>
                          <th>Menge</th>
                          <th>Einheit</th>
                          <th>EP / Preis EUR</th>
                          <th>Gesamtpreis EUR</th>
                          <th aria-label="Aktion" />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedServices.length === 0 ? (
                          <tr>
                            <td className="positionsInputEmpty" colSpan={6}>
                              Noch keine Positionen. Wähle eine Leistung über die
                              Suche oder füge manuell eine Position hinzu.
                            </td>
                          </tr>
                        ) : (
                          selectedServices.map((service) => (
                            <Fragment key={service.id}>
                              <tr className="positionsGroupRow">
                                <td colSpan={5}>{service.label}</td>
                                <td className="positionsGroupAction">
                                  <button
                                    type="button"
                                    className="positionsGroupDeleteButton"
                                    onClick={() =>
                                      removeSelectedService(service.id)
                                    }
                                    aria-label={`${service.label} Gruppe löschen`}
                                  >
                                    Gruppe löschen
                                  </button>
                                </td>
                              </tr>
                              {service.subitems.map((subitem, index) => {
                                const subitemTotal =
                                  calculateSubitemTotal(subitem);

                                return (
                                  <tr key={subitem.id}>
                                  <td>
                                    <input
                                      className="positionDescriptionInput"
                                      autoCapitalize="sentences"
                                      value={subitem.description}
                                      onChange={(event) =>
                                        updateServiceSubitem(
                                          service.id,
                                          subitem.id,
                                          "description",
                                          event.target.value,
                                        )
                                      }
                                      placeholder={
                                        index === 0
                                          ? "Bezeichnung / Unterpunkt"
                                          : "Weitere Position"
                                      }
                                      aria-label={`Bezeichnung für ${service.label}`}
                                    />
                                  </td>
                                  <td className="positionNumericCell">
                                    <input
                                      className="positionQuantityInput"
                                      value={subitem.quantity}
                                      onChange={(event) =>
                                        updateQuantitySubitem(
                                          service.id,
                                          subitem.id,
                                          event.target.value,
                                        )
                                      }
                                      onBeforeInput={(event) => {
                                        const nativeEvent =
                                          event.nativeEvent as InputEvent;
                                        const insertedText =
                                          nativeEvent.data ?? "";
                                        if (
                                          insertedText &&
                                          /[^\d.,]/.test(insertedText)
                                        ) {
                                          event.preventDefault();
                                        }
                                      }}
                                      onPaste={(event) => {
                                        event.preventDefault();
                                        const pastedText =
                                          event.clipboardData.getData("text");
                                        const input = event.currentTarget;
                                        const selectionStart =
                                          input.selectionStart ?? input.value.length;
                                        const selectionEnd =
                                          input.selectionEnd ?? input.value.length;
                                        const nextValue = `${input.value.slice(0, selectionStart)}${pastedText}${input.value.slice(selectionEnd)}`;
                                        updateQuantitySubitem(
                                          service.id,
                                          subitem.id,
                                          nextValue,
                                        );
                                      }}
                                      placeholder="0"
                                      inputMode="decimal"
                                      pattern="[0-9]+([.,][0-9]+)?"
                                      aria-label={`Menge für ${service.label}`}
                                    />
                                  </td>
                                  <td>
                                    <select
                                      className="positionUnitSelect"
                                      value={subitem.unit}
                                      onChange={(event) =>
                                        updateServiceSubitem(
                                          service.id,
                                          subitem.id,
                                          "unit",
                                          event.target.value,
                                        )
                                      }
                                      aria-label={`Einheit für ${service.label}`}
                                    >
                                      {UNIT_OPTIONS.map((unitOption) => (
                                        <option
                                          key={unitOption}
                                          value={unitOption}
                                        >
                                          {unitOption}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="positionNumericCell">
                                    <input
                                      className="positionPriceInput"
                                      value={
                                        activePriceSubitemId === subitem.id
                                          ? subitem.price
                                          : formatPriceInputValue(subitem.price)
                                      }
                                      onChange={(event) =>
                                        updatePriceSubitem(
                                          service.id,
                                          subitem.id,
                                          event.target.value,
                                        )
                                      }
                                      onBeforeInput={(event) => {
                                        const nativeEvent =
                                          event.nativeEvent as InputEvent;
                                        const insertedText =
                                          nativeEvent.data ?? "";
                                        if (
                                          insertedText &&
                                          /[^\d.,]/.test(insertedText)
                                        ) {
                                          event.preventDefault();
                                        }
                                      }}
                                      onPaste={(event) => {
                                        event.preventDefault();
                                        const pastedText =
                                          event.clipboardData.getData("text");
                                        const input = event.currentTarget;
                                        const selectionStart =
                                          input.selectionStart ?? input.value.length;
                                        const selectionEnd =
                                          input.selectionEnd ?? input.value.length;
                                        const nextValue = `${input.value.slice(0, selectionStart)}${pastedText}${input.value.slice(selectionEnd)}`;
                                        updatePriceSubitem(
                                          service.id,
                                          subitem.id,
                                          nextValue,
                                        );
                                      }}
                                      onFocus={() =>
                                        setActivePriceSubitemId(subitem.id)
                                      }
                                      onBlur={() =>
                                        setActivePriceSubitemId((prev) =>
                                          prev === subitem.id ? null : prev,
                                        )
                                      }
                                      placeholder="0,00"
                                      inputMode="decimal"
                                      pattern="[0-9]+([.,][0-9]+)?"
                                      aria-label={`EP / Preis EUR für ${service.label}`}
                                    />
                                  </td>
                                  <td className="positionTotalCell">
                                    {formatEuroValue(subitemTotal)}
                                  </td>
                                  <td className="positionActionCell">
                                    <button
                                      type="button"
                                      className="positionDeleteButton"
                                      onClick={() =>
                                        removeServiceSubitem(
                                          service.id,
                                          subitem.id,
                                        )
                                      }
                                      aria-label={`Position ${index + 1} für ${service.label} löschen`}
                                    >
                                      Löschen
                                    </button>
                                  </td>
                                  </tr>
                                );
                              })}
                            </Fragment>
                          ))
                        )}
                      </tbody>
                    </table>
                    <div className="positionsInputTableFooter">
                      <button
                        type="button"
                        className="ghostButton positionsAddRowButton"
                        onClick={addEmptyPositionRow}
                      >
                        + Position hinzufügen
                      </button>
                    </div>
                  </div>
                </div>

                {serviceInfo ? (
                  <p className="voiceInfo" role="status" aria-live="polite">
                    {serviceInfo}
                  </p>
                ) : null}
                {serviceError ? (
                  <p className="voiceWarning" role="alert">
                    {serviceError}
                  </p>
                ) : null}
              </div>
              <label className="field span2">
                <span>Projektbeschreibung / Zusatzdetails (frei)</span>
                <textarea
                  className="projectDescriptionTextarea"
                  rows={3}
                  placeholder="z. B. Verlegung von 60x60 Feinsteinzeugfliesen inkl. Fugenmaterial"
                  autoCapitalize="sentences"
                  value={form.serviceDescription}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      serviceDescription: capitalizeEntryStart(e.target.value),
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>Stunden</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.hours}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, hours: e.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Stundensatz (EUR)</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.hourlyRate}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, hourlyRate: e.target.value }))
                  }
                />
              </label>

              <button
                className="primaryButton submitButton"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? `${singularDocumentLabel} wird erstellt...`
                  : `${singularDocumentLabel} erstellen`}
              </button>

              <div className="formBottomMetaRow span2">
                {!isCompanySetupComplete ? (
                  <p className="formHint">
                    Tipp: Hinterlege zuerst deine Firmendaten in den{" "}
                    <Link href="/settings" className="formHintLink">
                      Einstellungen
                    </Link>{" "}
                    oder nutze dafür das Zahnradsymbol oben rechts.
                  </p>
                ) : (
                  <div className="formHintMiniWrap">
                    <button
                      type="button"
                      className="formHintMiniButton"
                      aria-label="Tipp anzeigen"
                      aria-expanded={isSetupHintOpen}
                      onClick={() => setIsSetupHintOpen((prev) => !prev)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="formHintMiniIcon"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M12 10.2v5.1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                        <circle cx="12" cy="7.2" r="1" fill="currentColor" />
                      </svg>
                    </button>
                    {isSetupHintOpen ? (
                      <p className="formHintMiniPopover">
                        Tipp: Deine Firmendaten sind hinterlegt. Du kannst sie
                        in den{" "}
                        <Link href="/settings" className="formHintLink">
                          Einstellungen
                        </Link>{" "}
                        oder über das Zahnradsymbol oben rechts bearbeiten.
                      </p>
                    ) : null}
                  </div>
                )}

                <button
                  type="button"
                  className="ghostButton infoLegalTriggerButton"
                  onClick={openInfoLegalModal}
                >
                  Info &amp; Rechtliches
                </button>
              </div>
            </form>

            {error ? <p className="error">{error}</p> : null}
            {!error && postActionInfo ? (
              <p className="voiceInfo" role="status" aria-live="polite">
                {postActionInfo}
              </p>
            ) : null}
          </article>
        </section>
        </div>
      </div>
    </main>
  );
}
