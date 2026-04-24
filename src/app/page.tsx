"use client";

import {
  ChangeEvent,
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
import { InfoLegalModal } from "@/components/InfoLegalModal";
import { VoiceLoginRequiredModal } from "@/components/VoiceLoginRequiredModal";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeCompanyLogoDataUrl } from "@/lib/logo-config";
import { formatIbanForDisplay, normalizeBicInput } from "@/lib/iban";
import { getDefaultPdfTableColumns } from "@/lib/pdf-table-config";
import { useDialogFocusTrap } from "@/lib/ui/use-dialog-focus-trap";
import {
  MAX_VOICE_TRANSCRIPT_LENGTH,
  isValidEmailAddress,
} from "@/lib/user-input";
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

type OfferMailActionState = {
  payload: ApiResponse;
  customerEmail: string;
  companyName: string;
  mode: DocumentMode;
  hasDownloadedPdfOnCreate: boolean;
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

type AccessStatusApiResponse = {
  authenticated?: boolean;
  user?: {
    email?: string;
  };
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
  inputMode?: "voice" | "photo";
  sourceText?: string | null;
};

type IntakeInputMode = "voice" | "photo";

type PhotoReviewPositionDraft = {
  id: string;
  group: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

type PhotoReviewDraft = {
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
  positions: PhotoReviewPositionDraft[];
  missingFieldKeys: string[];
  missingFieldLabels: string[];
  usedFallback: boolean;
  fallbackReason?: "no_api_key" | "model_error" | null;
  sourceText: string;
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
    customerType: "company",
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
  intakeInputMode: IntakeInputMode;
  hasUsedPrimaryVoiceIntake: boolean;
  voiceTranscript: string;
  voiceInfo: string;
  voiceError: string;
  voiceMissingFields: string[];
  photoInfo: string;
  photoError: string;
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
    selectedServices: [createManualSelectedServiceEntry()],
    intakeInputMode: "voice",
    hasUsedPrimaryVoiceIntake: false,
    voiceTranscript: "",
    voiceInfo: "",
    voiceError: "",
    voiceMissingFields: [],
    photoInfo: "",
    photoError: "",
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

const ACCOUNT_TIPS: Array<{
  title: string;
  text: string;
  points?: string[];
}> = [
  {
    title: "Schnellcheck",
    text: "Prüfe vor dem Erstellen kurz die wichtigsten Angaben.",
    points: [
      "Kundendaten vollständig",
      "Leistung klar beschrieben",
      "Menge, Einheit und Einzelpreis eingetragen",
      "Steuersatz geprüft",
      "Zahlungsziel oder Angebotsgültigkeit gesetzt",
    ],
  },
  {
    title: "KI richtig diktieren",
    text: "Sprich kurz, konkret und in derselben Reihenfolge wie im Formular.",
    points: [
      "Firma Müller, Hauptstraße 12 Köln, Betonarbeiten 2 Stück, Einzelpreis 120 Euro",
      "Herr Drews, Hauptquartierstraße 63, Gelsenkirchen, Trockenbau 8 Stunden à 45 Euro",
      "Rechnung für Malerarbeiten, 35 Quadratmeter, Einzelpreis 18 Euro, Zahlungsziel 14 Tage",
    ],
  },
  {
    title: "Angebot professionell machen",
    text: "Ein gutes Angebot ist eindeutig, befristet und später leicht nachvollziehbar.",
    points: [
      "Gültigkeit eintragen, z. B. 14 Tage",
      "Leistungen konkret statt allgemein beschreiben",
      "Bei schwankenden Materialpreisen einen Hinweis aufnehmen",
      "Pauschalen nur nutzen, wenn der Leistungsumfang klar ist",
    ],
  },
  {
    title: "Rechnung korrekt erstellen",
    text: "Rechnungen brauchen klare Pflichtangaben und eine saubere Zahlungsinformation.",
    points: [
      "Name und Anschrift von dir und dem Kunden prüfen",
      "Rechnungsnummer, Datum und Leistungsdatum setzen",
      "Leistungsbeschreibung, Netto, Steuer und Brutto kontrollieren",
      "IBAN und Zahlungsziel sichtbar halten",
      "Bei Kleinunternehmern den passenden Hinweis verwenden",
    ],
  },
  {
    title: "Nützliche Formulierungen",
    text: "Diese Sätze passen gut in Angebote, Rechnungen oder Zahlungsbedingungen.",
    points: [
      "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
      "Dieses Angebot basiert auf den aktuell gültigen Materialpreisen.",
      "Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot.",
      "Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer.",
    ],
  },
  {
    title: "Fehler vermeiden",
    text: "Diese Punkte führen häufig zu Rückfragen oder unprofessionellen Dokumenten.",
    points: [
      "Nicht nur 'Arbeiten' schreiben, sondern Leistung, Menge und Einzelpreis nennen",
      "Keine fehlende Rechnungsnummer",
      "Kein fehlendes Leistungsdatum",
      "Keine leere oder falsche IBAN",
      "Netto- und Bruttopreise nicht unklar mischen",
    ],
  },
];

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
const MAX_LOCAL_PHOTO_FILE_BYTES = 15 * 1024 * 1024;
const PHOTO_MAX_DIMENSION = 1920;
const PHOTO_JPEG_QUALITY = 0.88;

const DEFAULT_MANUAL_GROUP_LABEL = "Weitere Positionen";
const HOME_STATE_STORAGE_KEY = "visioro-home-state-v1";
const SETTINGS_DRAFT_STORAGE_KEY = "visioro-settings-draft-v1";
const SETTINGS_PERSISTENT_DRAFT_STORAGE_KEY = "visioro-settings-draft-persistent-v1";

const fallbackCompanySettings: CompanySettings = {
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
    customerType: value.customerType === "person" ? "person" : "company",
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
    return [createManualSelectedServiceEntry()];
  }

  const hydratedServices = value
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

  return hydratedServices.length > 0
    ? hydratedServices
    : [createManualSelectedServiceEntry()];
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
    intakeInputMode: value.intakeInputMode === "photo" ? "photo" : "voice",
    hasUsedPrimaryVoiceIntake: value.hasUsedPrimaryVoiceIntake === true,
    voiceTranscript: asString(value.voiceTranscript),
    voiceInfo: asString(value.voiceInfo),
    voiceError: asString(value.voiceError),
    voiceMissingFields: Array.isArray(value.voiceMissingFields)
      ? value.voiceMissingFields.map((entry) => asString(entry)).filter(Boolean)
      : [],
    photoInfo: asString(value.photoInfo),
    photoError: asString(value.photoError),
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
    companyIban: formatIbanForDisplay(
      asString(value.companyIban, fallbackCompanySettings.companyIban),
    ),
    companyBic: normalizeBicInput(
      asString(value.companyBic, fallbackCompanySettings.companyBic),
    ),
    companyBankName: asString(
      value.companyBankName,
      fallbackCompanySettings.companyBankName,
    ),
    ibanVerificationStatus:
      value.ibanVerificationStatus === "valid" ? "valid" : "not_checked",
    taxNumber: asString(value.taxNumber, fallbackCompanySettings.taxNumber),
    vatId: asString(value.vatId, fallbackCompanySettings.vatId),
    companyCountry: asString(
      value.companyCountry,
      fallbackCompanySettings.companyCountry,
    ),
    euVatNoticeText: asString(
      value.euVatNoticeText,
      fallbackCompanySettings.euVatNoticeText,
    ),
    includeCustomerVatId:
      typeof value.includeCustomerVatId === "boolean"
        ? value.includeCustomerVatId
        : fallbackCompanySettings.includeCustomerVatId,
    senderCopyEmail: asString(
      value.senderCopyEmail,
      fallbackCompanySettings.senderCopyEmail,
    ),
    logoDataUrl: sanitizeCompanyLogoDataUrl(
      asString(value.logoDataUrl, fallbackCompanySettings.logoDataUrl),
    ),
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
    lastInvoiceNumber: asString(
      value.lastInvoiceNumber,
      fallbackCompanySettings.lastInvoiceNumber,
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

  const parseDraft = (raw: string): CompanySettings | null => {
    const parsed = JSON.parse(raw) as unknown;
    if (isObjectRecord(parsed) && isObjectRecord(parsed.settings)) {
      return normalizeCompanySettingsInput(parsed.settings);
    }

    return normalizeCompanySettingsInput(parsed);
  };

  try {
    const raw = window.sessionStorage.getItem(SETTINGS_DRAFT_STORAGE_KEY);
    if (raw) {
      const sessionDraft = parseDraft(raw);
      if (sessionDraft) {
        return sessionDraft;
      }
    }
  } catch {
    // Fallback auf persistente Draft-Daten.
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_PERSISTENT_DRAFT_STORAGE_KEY);
    if (raw) {
      const localDraft = parseDraft(raw);
      if (localDraft) {
        return localDraft;
      }
    }
  } catch {
    return null;
  }

  return null;
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
    settings.companyIban,
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

function createManualSelectedServiceEntry(): SelectedServiceEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: DEFAULT_MANUAL_GROUP_LABEL,
    subitems: [createSubitemEntry()],
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
    return [createManualSelectedServiceEntry()];
  }

  const selectedFromDraft = groups
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

  return selectedFromDraft.length > 0
    ? selectedFromDraft
    : [createManualSelectedServiceEntry()];
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

function resolveRemainingMissingVoiceLabels(
  missingFieldKeys: string[] | undefined,
  nextForm: OfferForm,
): string[] {
  return (missingFieldKeys ?? [])
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
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => {
      const result =
        typeof reader.result === "string" ? reader.result.trim() : "";
      if (!result) {
        reject(new Error("file_read_empty"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = dataUrl;
  });
}

async function preparePhotoDataUrl(file: File): Promise<string> {
  const inputDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(inputDataUrl);
  const longestSide = Math.max(image.width, image.height);
  const resizeFactor =
    longestSide > PHOTO_MAX_DIMENSION ? PHOTO_MAX_DIMENSION / longestSide : 1;
  const targetWidth = Math.max(1, Math.round(image.width * resizeFactor));
  const targetHeight = Math.max(1, Math.round(image.height * resizeFactor));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return inputDataUrl;
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const optimized = canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY);
  return optimized?.startsWith("data:image/") ? optimized : inputDataUrl;
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
  const [documentMode, setDocumentMode] = useState<DocumentMode>("offer");
  const [form, setForm] = useState<OfferForm>(initialForm);
  const [error, setError] = useState("");
  const [postActionInfo, setPostActionInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [offerMailActionState, setOfferMailActionState] =
    useState<OfferMailActionState | null>(null);
  const [isPreparingOfferMailDraft, setIsPreparingOfferMailDraft] =
    useState(false);
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
  const [intakeInputMode, setIntakeInputMode] =
    useState<IntakeInputMode>("voice");
  const [hasUsedPrimaryVoiceIntake, setHasUsedPrimaryVoiceIntake] =
    useState(false);
  const [isPhotoScanSheetOpen, setIsPhotoScanSheetOpen] = useState(false);
  const [isPhotoCameraOpen, setIsPhotoCameraOpen] = useState(false);
  const [isStartingPhotoCamera, setIsStartingPhotoCamera] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const [isParsingPhoto, setIsParsingPhoto] = useState(false);
  const [voiceInfo, setVoiceInfo] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceMissingFields, setVoiceMissingFields] = useState<string[]>([]);
  const [photoInfo, setPhotoInfo] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [photoPreviewDataUrl, setPhotoPreviewDataUrl] = useState("");
  const [photoReviewDraft, setPhotoReviewDraft] =
    useState<PhotoReviewDraft | null>(null);
  const [serviceCatalog, setServiceCatalog] =
    useState<ServiceCatalogItem[]>(getSeedServices());
  const [serviceSearch, setServiceSearch] = useState("");
  const [selectedServices, setSelectedServices] = useState<
    SelectedServiceEntry[]
  >([createManualSelectedServiceEntry()]);
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
  const [isSettingsOverlayOpen, setIsSettingsOverlayOpen] = useState(false);
  const [isClosingSettingsOverlay, setIsClosingSettingsOverlay] = useState(false);
  const [isClosingCustomerPicker, setIsClosingCustomerPicker] = useState(false);
  const [, setIsCompanySetupComplete] = useState(false);
  const [isSetupHintOpen, setIsSetupHintOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isClosingAccountMenu, setIsClosingAccountMenu] = useState(false);
  const [isVoiceLoginModalOpen, setIsVoiceLoginModalOpen] = useState(false);
  const [isAuthenticatedUser, setIsAuthenticatedUser] = useState(false);
  const [isAuthStatusLoading, setIsAuthStatusLoading] = useState(true);
  const [accountIdentity, setAccountIdentity] = useState("");
  const [isClosingCustomerArchive, setIsClosingCustomerArchive] = useState(false);
  const [isHomeStateHydrated, setIsHomeStateHydrated] = useState(false);
  const recognitionRef = useRef<any>(null);
  const modeSnapshotsRef = useRef<Record<DocumentMode, ModeSnapshot>>({
    offer: createInitialModeSnapshot(),
    invoice: createInitialModeSnapshot(),
  });
  const shouldAutoApplyVoiceRef = useRef(false);
  const photoParseRequestRef = useRef(0);
  const pauseRequestedRef = useRef(false);
  const servicePickerRef = useRef<HTMLDivElement | null>(null);
  const serviceDateRangePickerRef = useRef<HTMLDivElement | null>(null);
  const photoCaptureInputRef = useRef<HTMLInputElement | null>(null);
  const photoUploadInputRef = useRef<HTMLInputElement | null>(null);
  const photoCameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const photoCameraStreamRef = useRef<MediaStream | null>(null);
  const finalTranscriptRef = useRef("");
  const settingsOverlayCloseTimeoutRef = useRef<number | null>(null);
  const customerPickerCloseTimeoutRef = useRef<number | null>(null);
  const invoiceDateInputRef = useRef<HTMLInputElement | null>(null);
  const archiveLoadRequestRef = useRef(0);
  const archiveAbortControllerRef = useRef<AbortController | null>(null);
  const archiveCloseTimeoutRef = useRef<number | null>(null);
  const infoLegalCloseTimeoutRef = useRef<number | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuCloseTimeoutRef = useRef<number | null>(null);
  const setupHintRef = useRef<HTMLElement | null>(null);
  const customerArchiveSheetRef = useRef<HTMLElement | null>(null);
  const settingsOverlaySheetRef = useRef<HTMLElement | null>(null);
  const customerPickerModalSheetRef = useRef<HTMLElement | null>(null);
  const photoScanMenuRef = useRef<HTMLDivElement | null>(null);
  const photoScanTriggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const photoCameraSheetRef = useRef<HTMLElement | null>(null);
  const infoLegalSheetRef = useRef<HTMLElement | null>(null);
  const voiceLoginModalSheetRef = useRef<HTMLElement | null>(null);
  const isAnyIntakeProcessing =
    isParsingVoice || isParsingPhoto || isStartingPhotoCamera;
  const isKiIntakeLocked = isAuthStatusLoading || !isAuthenticatedUser;

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
  const createDocumentFirstInfo = isInvoiceMode
    ? "Bitte zuerst eine Rechnung erstellen."
    : "Bitte zuerst ein Angebot erstellen.";
  const canOpenOfferMailDraft =
    Boolean(offerMailActionState?.payload.pdfBase64?.trim()) &&
    offerMailActionState?.mode === documentMode;
  const isCreateDocumentHint =
    postActionInfo === "Bitte zuerst ein Angebot erstellen." ||
    postActionInfo === "Bitte zuerst eine Rechnung erstellen.";
  const accountIdentityLabel = accountIdentity || "Nutzerkonto";

  useDialogFocusTrap({
    isOpen: isCustomerArchiveOpen,
    containerRef: customerArchiveSheetRef,
  });
  useDialogFocusTrap({
    isOpen: isSettingsOverlayOpen,
    containerRef: settingsOverlaySheetRef,
  });
  useDialogFocusTrap({
    isOpen: isSetupHintOpen,
    containerRef: setupHintRef,
  });
  useDialogFocusTrap({
    isOpen: isCustomerPickerOpen,
    containerRef: customerPickerModalSheetRef,
  });
  useDialogFocusTrap({
    isOpen: isInfoLegalOpen,
    containerRef: infoLegalSheetRef,
  });
  useDialogFocusTrap({
    isOpen: isVoiceLoginModalOpen,
    containerRef: voiceLoginModalSheetRef,
  });
  useDialogFocusTrap({
    isOpen: isPhotoCameraOpen,
    containerRef: photoCameraSheetRef,
  });

  function applyModeSnapshot(snapshot: ModeSnapshot) {
    setForm({ ...snapshot.form });
    setActiveCustomerNumber(snapshot.activeCustomerNumber);
    setSelectedServices(cloneSelectedServices(snapshot.selectedServices));
    setIntakeInputMode(snapshot.intakeInputMode);
    setHasUsedPrimaryVoiceIntake(snapshot.hasUsedPrimaryVoiceIntake);
    setVoiceTranscript(snapshot.voiceTranscript);
    setVoiceInfo(snapshot.voiceInfo);
    setVoiceError(snapshot.voiceError);
    setVoiceMissingFields([...snapshot.voiceMissingFields]);
    setPhotoInfo(snapshot.photoInfo);
    setPhotoError(snapshot.photoError);
    setPhotoReviewDraft(null);
    setPhotoPreviewDataUrl("");
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
      intakeInputMode,
      hasUsedPrimaryVoiceIntake,
      voiceTranscript,
      voiceInfo,
      voiceError,
      voiceMissingFields: [...voiceMissingFields],
      photoInfo,
      photoError,
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
    photoParseRequestRef.current += 1;
    setIsParsingPhoto(false);
    setPhotoReviewDraft(null);
    setPhotoPreviewDataUrl("");
    setIsPhotoScanSheetOpen(false);
    setIsSpeechPaused(false);
    setActivePriceSubitemId(null);
    setDocumentMode(nextMode);
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
    photoParseRequestRef.current += 1;
    setIsListening(false);
    setIsSpeechPaused(false);
    setIsParsingPhoto(false);
    setPhotoReviewDraft(null);
    setPhotoPreviewDataUrl("");
    setIsAddressLoading(false);
    setIsCustomerPickerOpen(false);
    setCustomerSearch("");
    setCustomersError("");
    setDeletingCustomerNumber(null);
    setError("");
    setPostActionInfo("");
    setOfferMailActionState(null);
    setIsPreparingOfferMailDraft(false);
    setIsPhotoScanSheetOpen(false);

    const resetSnapshot = createInitialModeSnapshot();
    modeSnapshotsRef.current[documentMode] = resetSnapshot;
    applyModeSnapshot(resetSnapshot);
  }

  function openSettingsOverlay() {
    if (settingsOverlayCloseTimeoutRef.current !== null) {
      window.clearTimeout(settingsOverlayCloseTimeoutRef.current);
      settingsOverlayCloseTimeoutRef.current = null;
    }
    setIsClosingSettingsOverlay(false);
    setIsSettingsOverlayOpen(true);
  }

  function closeSettingsOverlay() {
    if (!isSettingsOverlayOpen || isClosingSettingsOverlay) {
      return;
    }

    setIsClosingSettingsOverlay(true);
    if (settingsOverlayCloseTimeoutRef.current !== null) {
      window.clearTimeout(settingsOverlayCloseTimeoutRef.current);
    }
    settingsOverlayCloseTimeoutRef.current = window.setTimeout(() => {
      setIsSettingsOverlayOpen(false);
      setIsClosingSettingsOverlay(false);
      settingsOverlayCloseTimeoutRef.current = null;
    }, 170);
  }

  function openAccountMenu() {
    if (accountMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(accountMenuCloseTimeoutRef.current);
      accountMenuCloseTimeoutRef.current = null;
    }
    setIsClosingAccountMenu(false);
    setIsAccountMenuOpen(true);
  }

  function closeAccountMenu() {
    if (!isAccountMenuOpen || isClosingAccountMenu) {
      return;
    }

    setIsClosingAccountMenu(true);
    if (accountMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(accountMenuCloseTimeoutRef.current);
    }
    accountMenuCloseTimeoutRef.current = window.setTimeout(() => {
      setIsAccountMenuOpen(false);
      setIsClosingAccountMenu(false);
      accountMenuCloseTimeoutRef.current = null;
    }, 140);
  }

  function toggleAccountMenu() {
    if (isAccountMenuOpen && !isClosingAccountMenu) {
      closeAccountMenu();
      return;
    }
    openAccountMenu();
  }

  function openCustomerPickerPopup() {
    if (customerPickerCloseTimeoutRef.current !== null) {
      window.clearTimeout(customerPickerCloseTimeoutRef.current);
      customerPickerCloseTimeoutRef.current = null;
    }
    setIsClosingCustomerPicker(false);
    setIsCustomerPickerOpen(true);
    setCustomersError("");

    if (!isCustomersLoading && storedCustomers.length === 0) {
      void loadStoredCustomers();
    }
  }

  function closeCustomerPickerPopup() {
    if (!isCustomerPickerOpen || isClosingCustomerPicker) {
      return;
    }

    setIsClosingCustomerPicker(true);
    if (customerPickerCloseTimeoutRef.current !== null) {
      window.clearTimeout(customerPickerCloseTimeoutRef.current);
    }
    customerPickerCloseTimeoutRef.current = window.setTimeout(() => {
      setIsCustomerPickerOpen(false);
      setIsClosingCustomerPicker(false);
      setCustomerSearch("");
      customerPickerCloseTimeoutRef.current = null;
    }, 160);
  }

  function closeVoiceLoginModal() {
    setIsVoiceLoginModalOpen(false);
  }

  function openVoiceLoginModal() {
    setIsVoiceLoginModalOpen(true);
  }

  function navigateToAuthFromVoiceLoginModal() {
    setIsVoiceLoginModalOpen(false);
    window.location.href = "/auth";
  }

  useEffect(() => {
    const speechCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(speechCtor));

    return () => {
      if (settingsOverlayCloseTimeoutRef.current !== null) {
        window.clearTimeout(settingsOverlayCloseTimeoutRef.current);
      }
      if (customerPickerCloseTimeoutRef.current !== null) {
        window.clearTimeout(customerPickerCloseTimeoutRef.current);
      }
      if (archiveCloseTimeoutRef.current !== null) {
        window.clearTimeout(archiveCloseTimeoutRef.current);
      }
      if (archiveAbortControllerRef.current) {
        archiveAbortControllerRef.current.abort();
        archiveAbortControllerRef.current = null;
      }
      if (infoLegalCloseTimeoutRef.current !== null) {
        window.clearTimeout(infoLegalCloseTimeoutRef.current);
      }
      if (accountMenuCloseTimeoutRef.current !== null) {
        window.clearTimeout(accountMenuCloseTimeoutRef.current);
      }
      if (recognitionRef.current) {
        shouldAutoApplyVoiceRef.current = false;
        pauseRequestedRef.current = false;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      stopPhotoCameraStream();
      photoParseRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const rawState = window.sessionStorage.getItem(HOME_STATE_STORAGE_KEY);
      if (rawState) {
        const persisted = hydratePersistedHomeState(JSON.parse(rawState));
        if (persisted) {
          const offerSnapshot = persisted.modeSnapshots.offer;
          const normalizedOfferSnapshot: ModeSnapshot = {
            ...offerSnapshot,
            form: {
              ...offerSnapshot.form,
              customerType: "company",
            },
          };

          modeSnapshotsRef.current = {
            ...persisted.modeSnapshots,
            offer: normalizedOfferSnapshot,
          };
          setDocumentMode("offer");
          applyModeSnapshot(normalizedOfferSnapshot);
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
    intakeInputMode,
    hasUsedPrimaryVoiceIntake,
    photoError,
    photoInfo,
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

    const hasBlockingOverlay =
      isCustomerArchiveOpen ||
      isInfoLegalOpen ||
      isSettingsOverlayOpen ||
      isCustomerPickerOpen ||
      isPhotoCameraOpen ||
      isVoiceLoginModalOpen ||
      isSetupHintOpen;
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
  }, [
    isCustomerArchiveOpen,
    isInfoLegalOpen,
    isSettingsOverlayOpen,
    isCustomerPickerOpen,
    isPhotoCameraOpen,
    isVoiceLoginModalOpen,
    isSetupHintOpen,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (
      !isCustomerArchiveOpen &&
      !isInfoLegalOpen &&
      !isSettingsOverlayOpen &&
      !isCustomerPickerOpen &&
      !isPhotoCameraOpen &&
      !isPhotoScanSheetOpen &&
      !isVoiceLoginModalOpen &&
      !isAccountMenuOpen &&
      !isSetupHintOpen
    ) {
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

      if (isSettingsOverlayOpen) {
        closeSettingsOverlay();
        return;
      }

      if (isCustomerArchiveOpen) {
        closeCustomerArchive();
        return;
      }

      if (isCustomerPickerOpen) {
        closeCustomerPickerPopup();
        return;
      }

      if (isPhotoCameraOpen) {
        closePhotoCamera();
        return;
      }

      if (isPhotoScanSheetOpen) {
        closePhotoScanSheet();
        return;
      }

      if (isVoiceLoginModalOpen) {
        closeVoiceLoginModal();
        return;
      }

      if (isSetupHintOpen) {
        setIsSetupHintOpen(false);
      }

      if (isAccountMenuOpen) {
        closeAccountMenu();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [
    isCustomerArchiveOpen,
    isClosingCustomerArchive,
    isInfoLegalOpen,
    isClosingInfoLegal,
    isSettingsOverlayOpen,
    isClosingSettingsOverlay,
    isCustomerPickerOpen,
    isClosingCustomerPicker,
    isPhotoCameraOpen,
    isPhotoScanSheetOpen,
    isVoiceLoginModalOpen,
    isAccountMenuOpen,
    isClosingAccountMenu,
    isSetupHintOpen,
  ]);

  useEffect(() => {
    if (!isPhotoScanSheetOpen || typeof window === "undefined") {
      return;
    }

    function closeOnOutsidePointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (photoScanMenuRef.current?.contains(target)) {
        return;
      }

      if (photoScanTriggerButtonRef.current?.contains(target)) {
        return;
      }

      setIsPhotoScanSheetOpen(false);
    }

    window.addEventListener("mousedown", closeOnOutsidePointer);
    window.addEventListener("touchstart", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsidePointer);
      window.removeEventListener("touchstart", closeOnOutsidePointer);
    };
  }, [isPhotoScanSheetOpen]);

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
        const isCompleteFromDraft = hasCompletedCompanySettings(draftSettings);
        setIsCompanySetupComplete(isCompleteFromDraft);
        if (!isCompleteFromDraft) {
          setIsSetupHintOpen(false);
        }
      }

      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const data = (await response.json()) as SettingsApiResponse;
        if (!response.ok) {
          return;
        }
        if (mounted) {
          if (data.settings && !draftSettings) {
            setCompanySettings(data.settings);
          }
          const settingsForCompletionCheck = draftSettings ?? data.settings;
          const isComplete = hasCompletedCompanySettings(
            settingsForCompletionCheck,
          );
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

    async function loadAccountStatus() {
      setIsAuthStatusLoading(true);
      try {
        const response = await fetch("/api/access/status", { cache: "no-store" });
        if (!mounted) {
          return;
        }

        if (!response.ok) {
          setIsAuthenticatedUser(false);
          setAccountIdentity("");
          return;
        }

        const data = (await response.json()) as AccessStatusApiResponse;
        setIsAuthenticatedUser(Boolean(data.authenticated));
        setAccountIdentity(
          typeof data.user?.email === "string" ? data.user.email.trim() : "",
        );
      } catch {
        if (!mounted) {
          return;
        }
        setIsAuthenticatedUser(false);
        setAccountIdentity("");
      } finally {
        if (mounted) {
          setIsAuthStatusLoading(false);
        }
      }
    }

    void loadAccountStatus();

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
    if ((!isAccountMenuOpen && !isSetupHintOpen) || typeof document === "undefined") {
      return;
    }

    function closeAccountUiOnOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        accountMenuRef.current?.contains(target) ||
        setupHintRef.current?.contains(target)
      ) {
        return;
      }

      if (isSetupHintOpen) {
        setIsSetupHintOpen(false);
      }

      if (isAccountMenuOpen) {
        closeAccountMenu();
      }
    }

    document.addEventListener("mousedown", closeAccountUiOnOutsideClick);
    return () =>
      document.removeEventListener("mousedown", closeAccountUiOnOutsideClick);
  }, [isAccountMenuOpen, isClosingAccountMenu, isSetupHintOpen]);

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
    if (isCustomerPickerOpen) {
      closeCustomerPickerPopup();
      return;
    }
    openCustomerPickerPopup();
  }

  async function loadCustomerDocuments(customerNumber: string) {
    if (!customerNumber) {
      if (archiveAbortControllerRef.current) {
        archiveAbortControllerRef.current.abort();
        archiveAbortControllerRef.current = null;
      }
      setArchiveDocuments([]);
      return;
    }
    const currentLoadRequest = archiveLoadRequestRef.current + 1;
    archiveLoadRequestRef.current = currentLoadRequest;
    if (archiveAbortControllerRef.current) {
      archiveAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    archiveAbortControllerRef.current = controller;

    setArchiveError("");
    setIsArchiveDocumentsLoading(true);
    setArchiveDocuments([]);

    try {
      const response = await fetch(
        `/api/customer-documents?customerNumber=${encodeURIComponent(customerNumber)}`,
        { signal: controller.signal },
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
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return;
      }
      if (archiveLoadRequestRef.current !== currentLoadRequest) {
        return;
      }
      setArchiveError("Dokumente konnten nicht geladen werden.");
    } finally {
      if (archiveAbortControllerRef.current === controller) {
        archiveAbortControllerRef.current = null;
      }
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

    if (archiveAbortControllerRef.current) {
      archiveAbortControllerRef.current.abort();
      archiveAbortControllerRef.current = null;
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
    if (archiveAbortControllerRef.current) {
      archiveAbortControllerRef.current.abort();
      archiveAbortControllerRef.current = null;
    }
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

  function toggleTipsFromAccountMenu() {
    setIsSetupHintOpen((prev) => !prev);
    closeAccountMenu();
  }

  function openInfoLegalFromAccountMenu() {
    setIsSetupHintOpen(false);
    closeAccountMenu();
    openInfoLegalModal();
  }

  function openSettingsFromAccountMenu() {
    setIsSetupHintOpen(false);
    closeAccountMenu();
    openSettingsOverlay();
  }

  function openCustomerArchiveFromAccountMenu() {
    setIsSetupHintOpen(false);
    closeAccountMenu();
    openCustomerArchive();
  }

  function navigateToAuthFromAccountMenu() {
    setIsSetupHintOpen(false);
    closeAccountMenu();
    window.location.href = "/auth";
  }

  async function handleLogoutFromAccountMenu() {
    setIsSetupHintOpen(false);
    closeAccountMenu();
    await handleLogout();
  }

  async function handleLogout() {
    try {
      if (isSupabaseConfigured()) {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.signOut();
      }
    } finally {
      window.location.href = "/auth";
    }
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
    if (customerPickerCloseTimeoutRef.current !== null) {
      window.clearTimeout(customerPickerCloseTimeoutRef.current);
      customerPickerCloseTimeoutRef.current = null;
    }
    setIsClosingCustomerPicker(false);
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
        return [createManualSelectedServiceEntry()];
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

  function switchIntakeMode(nextMode: IntakeInputMode) {
    setIntakeInputMode(nextMode);
    if (nextMode === "voice") {
      closePhotoCamera();
      setPhotoError("");
      return;
    }
    if (recognitionRef.current) {
      shouldAutoApplyVoiceRef.current = false;
      pauseRequestedRef.current = false;
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsListening(false);
      setIsSpeechPaused(false);
    }
    setVoiceError("");
    setVoiceMissingFields([]);
  }

  function startPrimaryVoiceIntake() {
    if (isKiIntakeLocked) {
      setVoiceError("");
      setVoiceInfo("");
      openVoiceLoginModal();
      return;
    }
    setHasUsedPrimaryVoiceIntake(true);
    setIsPhotoScanSheetOpen(false);
    switchIntakeMode("voice");
    startSpeechInput();
  }

  function openPhotoScanSheet() {
    if (isAnyIntakeProcessing) {
      return;
    }
    if (isKiIntakeLocked) {
      setPhotoError("");
      setPhotoInfo("");
      setIsPhotoScanSheetOpen(false);
      openVoiceLoginModal();
      return;
    }
    setPhotoError("");
    setPhotoInfo("");
    setIsPhotoScanSheetOpen((prev) => !prev);
  }

  function closePhotoScanSheet() {
    setIsPhotoScanSheetOpen(false);
  }

  function stopPhotoCameraStream() {
    const stream = photoCameraStreamRef.current;
    if (!stream) {
      return;
    }

    stream.getTracks().forEach((track) => track.stop());
    photoCameraStreamRef.current = null;
    if (photoCameraVideoRef.current) {
      photoCameraVideoRef.current.srcObject = null;
    }
  }

  function closePhotoCamera() {
    stopPhotoCameraStream();
    setIsPhotoCameraOpen(false);
    setIsStartingPhotoCamera(false);
  }

  function resolvePhotoCameraErrorMessage(error: unknown): string {
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name ?? "")
        : "";

    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Kamerazugriff ist blockiert. Bitte im Browser erlauben oder Foto hochladen.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "Keine Kamera gefunden. Bitte Foto hochladen.";
    }
    if (name === "NotReadableError" || name === "AbortError") {
      return "Kamera ist gerade nicht verfügbar. Bitte andere Apps schließen oder Foto hochladen.";
    }

    return "Kamera konnte nicht gestartet werden. Bitte Foto hochladen.";
  }

  async function openPhotoCamera() {
    if (isAnyIntakeProcessing) {
      return;
    }

    if (isKiIntakeLocked) {
      setPhotoError("");
      setPhotoInfo("");
      setIsPhotoScanSheetOpen(false);
      openVoiceLoginModal();
      return;
    }

    switchIntakeMode("photo");
    setIsPhotoScanSheetOpen(false);
    setPhotoError("");
    setPhotoInfo("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setPhotoError("Kamera-Liveansicht wird in diesem Browser nicht unterstützt.");
      photoCaptureInputRef.current?.click();
      return;
    }

    stopPhotoCameraStream();
    setIsPhotoCameraOpen(true);
    setIsStartingPhotoCamera(true);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
      });
      photoCameraStreamRef.current = stream;

      const video = photoCameraVideoRef.current;
      if (!video) {
        throw new Error("camera_video_missing");
      }

      video.srcObject = stream;
      await video.play();
      setPhotoInfo("Kamera bereit.");
    } catch (error) {
      stopPhotoCameraStream();
      setPhotoError(resolvePhotoCameraErrorMessage(error));
      setPhotoInfo("");
    } finally {
      setIsStartingPhotoCamera(false);
    }
  }

  async function capturePhotoFromCamera() {
    const video = photoCameraVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      setPhotoError("Kamera ist noch nicht bereit.");
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 960;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setPhotoError("Foto konnte nicht erstellt werden.");
      return;
    }

    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY);
    });
    if (!blob) {
      setPhotoError("Foto konnte nicht erstellt werden.");
      return;
    }

    const file = new File([blob], `aufnahme-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    closePhotoCamera();
    void handlePhotoFileSelection(file);
  }

  function startSpeechInput() {
    if (isListening || isParsingPhoto) {
      return;
    }

    if (isAuthStatusLoading) {
      setVoiceError("");
      setVoiceInfo("Loginstatus wird geprüft ...");
      return;
    }

    if (!isAuthenticatedUser) {
      setVoiceError("");
      setVoiceInfo("");
      openVoiceLoginModal();
      return;
    }

    console.log("[voice] start requested", {
      isSpeechPaused,
      existingTranscriptLength: voiceTranscript.trim().length,
    });

    const speechCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!speechCtor) {
      setVoiceInfo("");
      setVoiceError(
        "Spracherkennung wird auf diesem Gerät/Browser nicht unterstützt.",
      );
      return;
    }

    const isResumingRecording = isSpeechPaused;
    setVoiceError("");
    setVoiceMissingFields([]);
    setIsSpeechPaused(false);
    shouldAutoApplyVoiceRef.current = true;
    pauseRequestedRef.current = false;
    finalTranscriptRef.current = voiceTranscript.trim();

    const navWithPermissions = navigator as Navigator & {
      permissions?: {
        query?: (descriptor: { name: string }) => Promise<{ state?: string }>;
      };
    };
    if (typeof navWithPermissions.permissions?.query === "function") {
      void navWithPermissions.permissions
        .query({ name: "microphone" })
        .then((result) => {
          if (result?.state === "denied") {
            console.warn("[voice] microphone permission denied");
            setVoiceError(
              "Mikrofonzugriff ist blockiert. Bitte im Browser erlauben und erneut versuchen.",
            );
            setVoiceInfo("");
          }
        })
        .catch(() => {
          // Browser ohne stabile Permissions API sollen weiterhin aufnehmen können.
        });
    }

    const recognition = new speechCtor();
    recognition.lang = "de-DE";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setVoiceInfo(
        isResumingRecording
          ? "Aufnahme fortgesetzt. Sprich weiter, der Text wird angehängt."
          : "Sprich jetzt. Du kannst frei alle Angebotsdaten diktieren.",
      );
    };

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
      console.warn("[voice] recognition error", { code });
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
          "Mikrofonzugriff ist blockiert. Bitte im Browser erlauben und erneut versuchen.",
        );
      } else if (code === "no-speech") {
        setVoiceError("Keine Sprache erkannt. Bitte erneut sprechen.");
      } else {
        setVoiceError(
          "Spracherkennung fehlgeschlagen. Bitte erneut versuchen.",
        );
      }
      setVoiceInfo("");
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
      console.log("[voice] recording ended", {
        transcriptLength: finalizedTranscript.length,
        shouldAutoApply,
        wasPaused,
      });

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
      console.log("[voice] recording started");
    } catch {
      console.error("[voice] failed to start recording");
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
    if (!rawUnit) {
      return UNIT_OPTIONS[0];
    }
    const compact = rawUnit
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/²/g, "2")
      .replace(/³/g, "3")
      .replace(/\s+/g, "")
      .replace(/\./g, "")
      .trim();
    if (!compact) {
      return UNIT_OPTIONS[0];
    }

    if (compact === "stuck" || compact === "stueck" || compact === "stk") {
      return "Stück";
    }
    if (
      compact === "m2" ||
      compact === "qm" ||
      compact === "quadratmeter" ||
      compact === "quadratmetern"
    ) {
      return "m²";
    }
    if (
      compact === "m3" ||
      compact === "cbm" ||
      compact === "kubikmeter" ||
      compact === "kubikmetern"
    ) {
      return "m³";
    }
    if (compact === "m" || compact === "meter" || compact === "metern") {
      return "m";
    }
    if (compact === "kg" || compact === "kilogramm") {
      return "kg";
    }
    if (compact === "t" || compact === "tonne" || compact === "tonnen") {
      return "t";
    }
    if (compact === "l" || compact === "liter") {
      return "l";
    }
    if (
      compact === "stunde" ||
      compact === "stunden" ||
      compact === "std" ||
      compact === "h"
    ) {
      return "Std";
    }
    if (compact === "tag" || compact === "tage") {
      return "Tag";
    }
    if (
      compact === "psch" ||
      compact === "pauschale" ||
      compact === "pauschal"
    ) {
      return "Pauschal";
    }

    const mapped = UNIT_OPTIONS.find((option) => {
      const optionCompact = option
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/²/g, "2")
        .replace(/³/g, "3")
        .replace(/\s+/g, "")
        .replace(/\./g, "")
        .trim();
      return optionCompact === compact;
    });
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
          : undefined;

      if (!description || !Number.isFinite(quantity)) {
        continue;
      }

      const groupLabel =
        capitalizeEntryStart(item.group ?? "") || DEFAULT_MANUAL_GROUP_LABEL;
      const existing = grouped.get(groupLabel);
      const subitem = createSubitemEntry(description);
      subitem.quantity = sanitizeQuantityInput(toDecimalInputValue(quantity));
      subitem.unit = normalizeVoiceUnit(item.unit);
      subitem.price =
        typeof unitPrice === "number"
          ? sanitizePriceInput(toDecimalInputValue(unitPrice))
          : "";

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
    console.log("[voice] parse requested", {
      transcriptLength: transcript.length,
      autoTriggered,
    });
    if (transcript.length < 8) {
      if (!autoTriggered) {
        setVoiceInfo("");
        setVoiceError(
          "Bitte etwas länger sprechen, damit die KI genug Daten hat.",
        );
      }
      console.warn("[voice] parse skipped because transcript is too short");
      return;
    }

    if (transcript.length > MAX_VOICE_TRANSCRIPT_LENGTH) {
      if (!autoTriggered) {
        setVoiceInfo("");
        setVoiceError(
          `Bitte auf maximal ${MAX_VOICE_TRANSCRIPT_LENGTH.toLocaleString("de-DE")} Zeichen kürzen.`,
        );
      }
      console.warn("[voice] parse skipped because transcript is too long");
      return;
    }

    setIsParsingVoice(true);
    setVoiceError("");
    setVoiceMissingFields([]);
    setVoiceInfo("Verarbeite Eingabe...");

    try {
      const response = await fetch("/api/parse-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputMode: "voice", transcript }),
      });
      console.log("[voice] parse response received", {
        status: response.status,
        ok: response.ok,
      });
      const data = (await response.json()) as VoiceParseResponse & {
        error?: string;
      };
      if (!response.ok) {
        const errorText =
          data.error ?? "Sprachdaten konnten nicht verarbeitet werden.";
        if (response.status === 401) {
          setVoiceInfo("");
          setVoiceError("Bitte zuerst einloggen, um die KI-Sprachfunktion zu nutzen.");
          console.warn("[voice] parse rejected because user is not logged in");
          return;
        }
        if (response.status === 402) {
          setVoiceInfo("");
          setVoiceError(errorText);
          console.warn("[voice] parse rejected because app access is not active");
          return;
        }
        setVoiceInfo("");
        setVoiceError(
          /zugriff/i.test(errorText)
            ? "Sprachverarbeitung fehlgeschlagen. Bitte erneut versuchen."
            : errorText,
        );
        console.warn("[voice] parse rejected", { error: errorText });
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
        console.log("[voice] parse returned no structured content");
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

        remainingMissingLabels = resolveRemainingMissingVoiceLabels(
          data.missingFieldKeys,
          nextForm,
        );

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
      console.log("[voice] parse applied", {
        missingCount: remainingMissingLabels.length,
        positionsCount: parsedServiceEntries.length,
      });
    } catch (error) {
      setVoiceMissingFields([]);
      setVoiceInfo("");
      setVoiceError("Sprachverarbeitung fehlgeschlagen. Bitte erneut versuchen.");
      console.error("[voice] parse failed", error);
    } finally {
      setIsParsingVoice(false);
    }
  }

  function createPhotoReviewPositionDraft(
    position?: ParsedVoicePosition,
  ): PhotoReviewPositionDraft {
    const quantity =
      typeof position?.quantity === "number" &&
      Number.isFinite(position.quantity) &&
      position.quantity > 0
        ? sanitizeQuantityInput(toDecimalInputValue(position.quantity))
        : "";
    const unitPrice =
      typeof position?.unitPrice === "number" &&
      Number.isFinite(position.unitPrice) &&
      position.unitPrice >= 0
        ? sanitizePriceInput(toDecimalInputValue(position.unitPrice))
        : "";

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      group: capitalizeEntryStart(position?.group ?? ""),
      description: capitalizeEntryStart(position?.description ?? ""),
      quantity,
      unit: normalizeVoiceUnit(position?.unit),
      unitPrice,
    };
  }

  function updatePhotoReviewPosition(
    positionId: string,
    field: "group" | "description" | "quantity" | "unit" | "unitPrice",
    value: string,
  ) {
    setPhotoReviewDraft((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        positions: prev.positions.map((position) => {
          if (position.id !== positionId) {
            return position;
          }

          if (field === "group") {
            return { ...position, group: capitalizeEntryStart(value) };
          }
          if (field === "description") {
            return { ...position, description: capitalizeEntryStart(value) };
          }
          if (field === "quantity") {
            return { ...position, quantity: sanitizeQuantityInput(value) };
          }
          if (field === "unit") {
            return { ...position, unit: normalizeVoiceUnit(value) };
          }
          return { ...position, unitPrice: sanitizePriceInput(value) };
        }),
      };
    });
  }

  function addPhotoReviewPosition() {
    setPhotoReviewDraft((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        positions: [...prev.positions, createPhotoReviewPositionDraft()],
      };
    });
  }

  function removePhotoReviewPosition(positionId: string) {
    setPhotoReviewDraft((prev) => {
      if (!prev) {
        return prev;
      }

      const nextPositions = prev.positions.filter(
        (position) => position.id !== positionId,
      );
      return {
        ...prev,
        positions: nextPositions,
      };
    });
  }

  function dismissPhotoReview() {
    setPhotoReviewDraft(null);
    setPhotoInfo("Foto-Erkennung verworfen. Felder blieben unverändert.");
    setPhotoError("");
  }

  function applyPhotoReview() {
    if (!photoReviewDraft) {
      return;
    }

    const normalizedPositions = photoReviewDraft.positions
      .map((position): ParsedVoicePosition | null => {
        const description = capitalizeEntryStart(position.description.trim());
        const quantity = parseLocaleNumber(position.quantity);
        if (!description || !Number.isFinite(quantity) || quantity <= 0) {
          return null;
        }

        const unitPriceParsed = parseLocaleNumber(position.unitPrice);
        const normalizedPosition: ParsedVoicePosition = {
          description,
          quantity,
          unit: normalizeVoiceUnit(position.unit),
        };
        const group = capitalizeEntryStart(position.group.trim());
        if (group) {
          normalizedPosition.group = group;
        }
        if (Number.isFinite(unitPriceParsed) && unitPriceParsed >= 0) {
          normalizedPosition.unitPrice = unitPriceParsed;
        }
        return normalizedPosition;
      })
      .filter((position): position is ParsedVoicePosition => position !== null);

    const parsedServiceEntries = toSelectedServicesFromVoicePositions(
      normalizedPositions,
    );
    let remainingMissingLabels: string[] = [];

    setForm((prev) => {
      const nextForm = {
        ...prev,
        customerType: photoReviewDraft.customerType,
        companyName: photoReviewDraft.companyName.trim()
          ? capitalizeEntryStart(photoReviewDraft.companyName)
          : prev.companyName,
        salutation: photoReviewDraft.salutation,
        firstName: photoReviewDraft.firstName.trim()
          ? capitalizeEntryStart(photoReviewDraft.firstName)
          : prev.firstName,
        lastName: photoReviewDraft.lastName.trim()
          ? capitalizeEntryStart(photoReviewDraft.lastName)
          : prev.lastName,
        street: photoReviewDraft.street.trim()
          ? capitalizeEntryStart(photoReviewDraft.street)
          : prev.street,
        postalCode: photoReviewDraft.postalCode.trim() || prev.postalCode,
        city: photoReviewDraft.city.trim()
          ? capitalizeEntryStart(photoReviewDraft.city)
          : prev.city,
        customerEmail: photoReviewDraft.customerEmail.trim() || prev.customerEmail,
        serviceDescription: photoReviewDraft.serviceDescription.trim()
          ? capitalizeEntryStart(photoReviewDraft.serviceDescription)
          : prev.serviceDescription,
        hours: sanitizeQuantityInput(photoReviewDraft.hours) || prev.hours,
        hourlyRate:
          sanitizePriceInput(photoReviewDraft.hourlyRate) || prev.hourlyRate,
        materialCost:
          sanitizePriceInput(photoReviewDraft.materialCost) || prev.materialCost,
      };

      remainingMissingLabels = resolveRemainingMissingVoiceLabels(
        photoReviewDraft.missingFieldKeys,
        nextForm,
      );

      return nextForm;
    });

    if (parsedServiceEntries.length > 0) {
      setSelectedServices(parsedServiceEntries);
      setServiceSearch("");
      setIsServiceSearchOpen(false);
    }

    setVoiceMissingFields(remainingMissingLabels);
    setAddressSuggestions([]);
    setPhotoReviewDraft(null);
    setPhotoError("");
    setPhotoInfo(
      remainingMissingLabels.length > 0
        ? `Daten übernommen. Bitte noch ergänzen: ${remainingMissingLabels.join(", ")}.`
        : "Daten übernommen. Alle Kernfelder wurden erkannt.",
    );
  }

  async function handlePhotoFileSelection(file: File) {
    if (isKiIntakeLocked) {
      setPhotoError("");
      setPhotoInfo("");
      openVoiceLoginModal();
      return;
    }

    if (!file.type.startsWith("image/")) {
      setPhotoError("Bitte ein gültiges Bild auswählen.");
      setPhotoInfo("");
      return;
    }

    if (file.size > MAX_LOCAL_PHOTO_FILE_BYTES) {
      setPhotoError(
        `Das Foto ist zu groß. Bitte auf maximal ${Math.round(
          MAX_LOCAL_PHOTO_FILE_BYTES / (1024 * 1024),
        ).toLocaleString("de-DE")} MB reduzieren.`,
      );
      setPhotoInfo("");
      return;
    }

    if (recognitionRef.current) {
      shouldAutoApplyVoiceRef.current = false;
      pauseRequestedRef.current = false;
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setIsListening(false);
      setIsSpeechPaused(false);
    }

    const parseRequestId = photoParseRequestRef.current + 1;
    photoParseRequestRef.current = parseRequestId;

    setIsParsingPhoto(true);
    setPhotoReviewDraft(null);
    setPhotoError("");
    setPhotoInfo("Foto wird verarbeitet ...");
    setVoiceMissingFields([]);

    try {
      const preparedPhotoDataUrl = await preparePhotoDataUrl(file);
      if (parseRequestId !== photoParseRequestRef.current) {
        return;
      }

      setPhotoPreviewDataUrl(preparedPhotoDataUrl);
      setPhotoInfo("Informationen werden mit KI analysiert ...");

      const response = await fetch("/api/parse-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputMode: "photo",
          photoDataUrl: preparedPhotoDataUrl,
        }),
      });
      if (parseRequestId !== photoParseRequestRef.current) {
        return;
      }

      const data = (await response.json()) as VoiceParseResponse & {
        error?: string;
      };
      if (!response.ok) {
        const errorText = data.error ?? "Fotodaten konnten nicht verarbeitet werden.";
        if (response.status === 401) {
          setPhotoError("Bitte zuerst einloggen, um die KI-Fotofunktion zu nutzen.");
          return;
        }
        if (response.status === 402) {
          setPhotoError(errorText);
          return;
        }
        setPhotoError(errorText);
        return;
      }

      const fields = data.fields;
      const sourceText = typeof data.sourceText === "string" ? data.sourceText : "";
      const safeServiceDescription = sanitizeServiceDescription(
        fields.serviceDescription,
        sourceText,
      );
      const parsedServiceEntries = toSelectedServicesFromVoicePositions(
        fields.positions,
      );
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
        setPhotoReviewDraft(null);
        setPhotoInfo("Keine relevanten Daten erkannt.");
        setPhotoError("");
        return;
      }

      const reviewDraft: PhotoReviewDraft = {
        customerType: fields.customerType === "company" ? "company" : "person",
        companyName: fields.companyName ?? "",
        salutation: fields.salutation === "frau" ? "frau" : "herr",
        firstName: fields.firstName ?? "",
        lastName: fields.lastName ?? "",
        street: fields.street ?? "",
        postalCode: fields.postalCode ?? "",
        city: fields.city ?? "",
        customerEmail: fields.customerEmail ?? "",
        serviceDescription: safeServiceDescription ?? "",
        hours: numberToInput(fields.hours) ?? "",
        hourlyRate: numberToInput(fields.hourlyRate) ?? "",
        materialCost: numberToInput(fields.materialCost) ?? "",
        positions: Array.isArray(fields.positions)
          ? fields.positions.map((position) => createPhotoReviewPositionDraft(position))
          : [],
        missingFieldKeys: Array.isArray(data.missingFieldKeys)
          ? data.missingFieldKeys
          : [],
        missingFieldLabels: Array.isArray(data.missingFieldKeys)
          ? data.missingFieldKeys.map((key) => VOICE_FIELD_LABELS[key] ?? key)
          : [],
        usedFallback: data.usedFallback,
        fallbackReason: data.fallbackReason ?? null,
        sourceText: sourceText.trim(),
      };

      setPhotoReviewDraft(reviewDraft);
      const modeText = data.usedFallback
        ? data.fallbackReason === "no_api_key"
          ? "KI nicht aktiv: OPENAI_API_KEY fehlt."
          : "KI-Antwort fehlgeschlagen."
        : "Relevante Daten wurden erkannt.";
      setPhotoInfo(`${modeText} Bitte prüfen und übernehmen.`);
      setPhotoError("");
    } catch (error) {
      console.error("[photo] parse failed", error);
      setPhotoError("Fotodaten konnten nicht verarbeitet werden.");
      setPhotoInfo("");
    } finally {
      if (parseRequestId === photoParseRequestRef.current) {
        setIsParsingPhoto(false);
      }
    }
  }

  function onPhotoInputChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";
    if (!selectedFile) {
      return;
    }
    void handlePhotoFileSelection(selectedFile);
  }

  function triggerPhotoCaptureInput() {
    void openPhotoCamera();
  }

  function triggerPhotoUploadInput() {
    if (isAnyIntakeProcessing) {
      return;
    }

    if (isKiIntakeLocked) {
      setPhotoError("");
      setPhotoInfo("");
      setIsPhotoScanSheetOpen(false);
      openVoiceLoginModal();
      return;
    }

    switchIntakeMode("photo");
    setIsPhotoScanSheetOpen(false);
    setPhotoError("");
    setPhotoInfo("");
    photoUploadInputRef.current?.click();
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
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function resolveDraftDocumentNumber(
    payload: ApiResponse,
    mode: DocumentMode,
  ): string {
    return (
      payload.documentNumber?.trim() ||
      payload.offerNumber?.trim() ||
      payload.invoiceNumber?.trim() ||
      (mode === "invoice" ? "RECHNUNG" : "ANGEBOT")
    );
  }

  function resolveOfferReferenceNumber(payload: ApiResponse): string {
    const resolved = resolveDraftDocumentNumber(payload, "offer").trim();
    if (resolved && resolved !== "ANGEBOT") {
      return resolved;
    }
    const year = new Date().getFullYear();
    return `ANG-${year}-000`;
  }

  function buildOfferMailDraftContent(
    companyName: string,
    offerNumber: string,
  ) {
    const senderName = companyName.trim();
    const normalizedOfferNumber = offerNumber.trim();
    const subject = senderName
      ? `Ihr Angebot ${normalizedOfferNumber} von ${senderName}`
      : `Ihr Angebot ${normalizedOfferNumber}`;
    const signature = senderName ? `\n${senderName}` : "";
    return {
      subject,
      text:
        `Sehr geehrte Damen und Herren,\n\n` +
        `anbei erhalten Sie unser Angebot.\n\n` +
        `Bei Fragen stehen wir Ihnen gerne zur Verfügung.\n\n` +
        `Mit freundlichen Grüßen${signature}`,
    };
  }

  function openSystemMailDraft(to: string, subject: string, text: string) {
    const params = new URLSearchParams();
    if (subject.trim()) {
      params.set("subject", subject);
    }
    if (text.trim()) {
      params.set("body", text);
    }
    const query = params.toString();
    const href = `mailto:${encodeURIComponent(to)}${query ? `?${query}` : ""}`;
    window.location.href = href;
  }

  async function openMailDraftWithDocument(
    payload: ApiResponse,
    mode: DocumentMode,
    options?: {
      to?: string;
      subject?: string;
      text?: string;
      skipDownloadFallback?: boolean;
    },
  ) {
    const recipientEmail = options?.to?.trim() || form.customerEmail.trim();
    if (!recipientEmail) {
      return "Bitte zuerst eine Kunden-E-Mail hinterlegen.";
    }

    if (!isValidEmailAddress(recipientEmail)) {
      return "Bitte eine gültige Kunden-E-Mail-Adresse hinterlegen.";
    }

    const resolvedDocumentNumber = resolveDraftDocumentNumber(payload, mode);
    const fileName = `${resolvedDocumentNumber}.pdf`;
    const documentLabel = mode === "invoice" ? "Rechnung" : "Angebot";
    const subject = options?.subject?.trim() || payload.offer.subject;
    const text = options?.text?.trim() || payload.mailText;

    try {
      const draftResponse = await fetch("/api/email/create-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipientEmail,
          subject,
          text,
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
            title: subject,
            text,
            files: [file],
          });
          return "Mail-Entwurf über den Teilen-Dialog geöffnet.";
        } catch {
          // Ignorieren und auf Download zurückfallen.
        }
      }
    }

    if (!options?.skipDownloadFallback) {
      downloadPdfFile(file);
    }
    openSystemMailDraft(recipientEmail, subject, text);
    if (options?.skipDownloadFallback) {
      return `Kein verbundenes Postfach gefunden. Dein Standard-Mailprogramm wurde geöffnet. Die ${documentLabel}-PDF ist bereits heruntergeladen und kann manuell angehängt werden.`;
    }
    return `Kein verbundenes Postfach gefunden. ${documentLabel}-PDF wurde heruntergeladen und dein Standard-Mailprogramm wurde geöffnet.`;
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
            errorMessage: `Einzelpreis / Preis EUR ist für "${description}" verpflichtend.`,
          };
        }

        const price = parseLocaleNumber(priceRaw);
        if (!Number.isFinite(price) || price < 0) {
          return {
            positions: [],
            errorMessage: `Bitte einen gültigen Einzelpreis / Preis EUR für "${description}" eingeben.`,
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
          "Bitte mindestens einen Unterpunkt mit Menge und Einzelpreis / Preis EUR erfassen.",
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
    setOfferMailActionState(null);
    setIsPreparingOfferMailDraft(false);

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
      const localDraftSettings = readSettingsDraftFromSessionStorageForOffer();
      try {
        const settingsResponse = await fetch("/api/settings", {
          cache: "no-store",
        });
        const settingsData = (await settingsResponse.json()) as SettingsApiResponse;
        if (settingsResponse.ok && settingsData.settings) {
          settingsPayload = localDraftSettings ?? settingsData.settings;
          setCompanySettings(settingsPayload);
        }
      } catch {
        // Fallback auf zuletzt bekannte Einstellungen.
      }

      if (!settingsPayload) {
        settingsPayload = localDraftSettings;
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
      const hasDownloadedPdfOnCreate =
        payloadMode === "offer" && Boolean(payload.pdfBase64?.trim());
      if (hasDownloadedPdfOnCreate) {
        const downloadDocumentNumber = resolveDraftDocumentNumber(payload, "offer");
        const file = createPdfFile(
          payload.pdfBase64,
          `${downloadDocumentNumber}.pdf`,
        );
        downloadPdfFile(file);
      }
      const companyNameForMail =
        settingsPayload?.companyName?.trim() ||
        companySettings?.companyName?.trim() ||
        "";
      const customerEmailForMail = form.customerEmail.trim();
      const createdDocumentLabel =
        payloadMode === "invoice" ? "Rechnung" : "Angebot";
      const createdDocumentPronoun = payloadMode === "invoice" ? "sie" : "es";
      setOfferMailActionState({
        payload,
        customerEmail: customerEmailForMail,
        companyName: companyNameForMail,
        mode: payloadMode,
        hasDownloadedPdfOnCreate,
      });
      setPostActionInfo(
        customerEmailForMail
          ? `${createdDocumentLabel} wurde erstellt. Du kannst ${createdDocumentPronoun} jetzt per E-Mail versenden.`
          : `${createdDocumentLabel} wurde erstellt. Für den Versand bitte zuerst eine Kunden-E-Mail angeben.`,
      );
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOfferMailDraftOpen() {
    setError("");

    if (!offerMailActionState || offerMailActionState.mode !== documentMode) {
      setPostActionInfo(createDocumentFirstInfo);
      return;
    }

    const mailMode = offerMailActionState.mode;
    const recipientEmail = offerMailActionState.customerEmail.trim();
    if (!recipientEmail) {
      setPostActionInfo("Bitte zuerst eine Kunden-E-Mail hinterlegen.");
      return;
    }

    if (!offerMailActionState.payload.pdfBase64?.trim()) {
      setPostActionInfo(
        mailMode === "invoice"
          ? "Kein PDF vorhanden. Bitte Rechnung zuerst neu erstellen."
          : "Kein PDF vorhanden. Bitte Angebot zuerst neu erstellen.",
      );
      return;
    }

    setError("");
    setIsPreparingOfferMailDraft(true);
    try {
      let info = "";
      if (mailMode === "offer") {
        const draft = buildOfferMailDraftContent(
          offerMailActionState.companyName,
          resolveOfferReferenceNumber(offerMailActionState.payload),
        );
        info = await openMailDraftWithDocument(
          offerMailActionState.payload,
          "offer",
          {
            to: recipientEmail,
            subject: draft.subject,
            text: draft.text,
            skipDownloadFallback: offerMailActionState.hasDownloadedPdfOnCreate,
          },
        );
      } else {
        info = await openMailDraftWithDocument(
          offerMailActionState.payload,
          "invoice",
          {
            to: recipientEmail,
          },
        );
      }
      setPostActionInfo(info);
    } catch {
      setPostActionInfo("Mail-Entwurf konnte nicht geöffnet werden.");
    } finally {
      setIsPreparingOfferMailDraft(false);
    }
  }

  return (
    <main className="page">
      <div className="ambient ambientA" aria-hidden />
      <div className="ambient ambientB" aria-hidden />
      <div className="container pageSurfaceTransition dashboardCanvas">
        <header className="topHeaderMinimal">
          <img
            src="/visioro-logo.png"
            alt="Visioro"
            className="topHeaderMobileBrandLogo"
          />
          <div className="accountMenuWrap" ref={accountMenuRef}>
            <button
              type="button"
              className="topHeaderSettingsButton accountMenuTrigger topHeaderMenuTrigger"
              aria-label="Navigationsmenü"
              title="Menü"
              aria-haspopup="menu"
              aria-expanded={isAccountMenuOpen}
              onClick={toggleAccountMenu}
            >
              <svg
                viewBox="0 0 24 24"
                className="topHeaderIcon"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M5.5 7.6h13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M5.5 12h13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M5.5 16.4h13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {isAccountMenuOpen ? (
              <div
                className={`accountMenuPanel ${isClosingAccountMenu ? "closing" : ""}`}
                role="menu"
                aria-label="Navigationsmenü"
              >
                <p className="accountMenuHeader">
                  <span>Nutzerbereich</span>
                  {isAuthenticatedUser ? (
                    <strong className="accountMenuIdentity">
                      {accountIdentityLabel}
                    </strong>
                  ) : null}
                </p>
                <div className="accountMenuDivider" aria-hidden />
                <button
                  type="button"
                  className="accountMenuItem"
                  role="menuitem"
                  onClick={openSettingsFromAccountMenu}
                >
                  Einstellungen
                </button>
                <button
                  type="button"
                  className="accountMenuItem"
                  role="menuitem"
                  onClick={openCustomerArchiveFromAccountMenu}
                >
                  Kundenarchiv
                </button>
                <button
                  type="button"
                  className="accountMenuItem"
                  role="menuitem"
                  onClick={toggleTipsFromAccountMenu}
                >
                  Tipps
                </button>
                <button
                  type="button"
                  className="accountMenuItem"
                  role="menuitem"
                  onClick={openInfoLegalFromAccountMenu}
                >
                  Info &amp; Rechtliches
                </button>
                <div className="accountMenuDivider" aria-hidden />
                {isAuthenticatedUser ? (
                  <button
                    type="button"
                    className="accountMenuItem accountMenuLogoutItem"
                    role="menuitem"
                    onClick={() => void handleLogoutFromAccountMenu()}
                  >
                    Logout
                  </button>
                ) : (
                  <button
                    type="button"
                    className="accountMenuItem accountMenuLoginItem"
                    role="menuitem"
                    onClick={navigateToAuthFromAccountMenu}
                  >
                    Login / Registrieren
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </header>

        {isCustomerArchiveOpen ? (
          <div
            className={`customerArchiveBackdrop ${isClosingCustomerArchive ? "closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-archive-title"
            onClick={closeCustomerArchive}
          >
            <section
              className={`customerArchiveSheet ${isClosingCustomerArchive ? "closing" : ""}`}
              onClick={(event) => event.stopPropagation()}
              ref={customerArchiveSheetRef}
            >
              <div className="customerArchiveHeader">
                <strong id="customer-archive-title">Kundenarchiv</strong>
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

        <VoiceLoginRequiredModal
          isOpen={isVoiceLoginModalOpen}
          onClose={closeVoiceLoginModal}
          onLogin={navigateToAuthFromVoiceLoginModal}
          sheetRef={voiceLoginModalSheetRef}
        />

        {isPhotoCameraOpen ? (
          <div
            className="settingsOverlayBackdrop photoCameraBackdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-camera-title"
            onClick={closePhotoCamera}
          >
            <section
              className="settingsOverlaySheet photoCameraSheet"
              onClick={(event) => event.stopPropagation()}
              ref={photoCameraSheetRef}
            >
              <div className="settingsOverlayHeader photoCameraHeader">
                <strong id="photo-camera-title">Foto aufnehmen</strong>
                <button
                  type="button"
                  className="settingsOverlayCloseButton"
                  aria-label="Kamera schließen"
                  onClick={closePhotoCamera}
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
              <div className="photoCameraBody">
                <div className="photoCameraPreview">
                  <video
                    ref={photoCameraVideoRef}
                    className="photoCameraVideo"
                    autoPlay
                    muted
                    playsInline
                  />
                  {isStartingPhotoCamera ? (
                    <div className="photoCameraStatus">Kamera wird gestartet ...</div>
                  ) : null}
                  {photoError ? (
                    <div className="photoCameraStatus photoCameraStatusError">
                      {photoError}
                    </div>
                  ) : null}
                </div>
                <div className="photoCameraActions">
                  <button
                    type="button"
                    className="primaryButton"
                    onClick={capturePhotoFromCamera}
                    disabled={isStartingPhotoCamera || !photoCameraStreamRef.current}
                  >
                    Auslösen
                  </button>
                  <button
                    type="button"
                    className="ghostButton"
                    onClick={() => {
                      closePhotoCamera();
                      triggerPhotoUploadInput();
                    }}
                  >
                    Foto hochladen
                  </button>
                  <button
                    type="button"
                    className="ghostButton"
                    onClick={closePhotoCamera}
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {isSettingsOverlayOpen ? (
          <div
            className={`settingsOverlayBackdrop ${isClosingSettingsOverlay ? "closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-overlay-title"
            onClick={closeSettingsOverlay}
          >
            <section
              className={`settingsOverlaySheet ${isClosingSettingsOverlay ? "closing" : ""}`}
              onClick={(event) => event.stopPropagation()}
              ref={settingsOverlaySheetRef}
            >
              <div className="settingsOverlayHeader">
                <strong id="settings-overlay-title">Einstellungen</strong>
                <button
                  type="button"
                  className="settingsOverlayCloseButton"
                  aria-label="Einstellungen schließen"
                  onClick={closeSettingsOverlay}
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
              <div className="settingsOverlayFrameWrap">
                <iframe
                  src="/settings?embedded=1"
                  title="Einstellungen"
                  className="settingsOverlayFrame"
                />
              </div>
            </section>
          </div>
        ) : null}

        {isSetupHintOpen ? (
          <div
            className="settingsOverlayBackdrop tipsOverlayBackdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tips-overlay-title"
            onClick={() => setIsSetupHintOpen(false)}
          >
            <section
              className="settingsOverlaySheet tipsOverlaySheet"
              onClick={(event) => event.stopPropagation()}
              ref={setupHintRef}
            >
              <div className="settingsOverlayHeader">
                <strong id="tips-overlay-title">Tipps für Angebot &amp; Rechnung</strong>
                <button
                  type="button"
                  className="settingsOverlayCloseButton"
                  aria-label="Tipps schließen"
                  onClick={() => setIsSetupHintOpen(false)}
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
              <div className="settingsOverlayFrameWrap tipsOverlayBody">
                <ul className="tipsOverlayList">
                  {ACCOUNT_TIPS.map((tip) => (
                    <li key={tip.title} className="tipsOverlayItem">
                      <h3>{tip.title}</h3>
                      <p>{tip.text}</p>
                      {tip.points ? (
                        <ul className="tipsOverlayPointList">
                          {tip.points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="tipsOverlayMeta">
                  Kurzübersicht auf Basis öffentlicher Quellen, keine Rechtsberatung.
                </p>
              </div>
            </section>
          </div>
        ) : null}

        {isCustomerPickerOpen ? (
          <div
            className={`customerPickerModalBackdrop ${isClosingCustomerPicker ? "closing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-picker-title"
            onClick={closeCustomerPickerPopup}
          >
            <section
              className={`customerPickerModalSheet ${isClosingCustomerPicker ? "closing" : ""}`}
              onClick={(event) => event.stopPropagation()}
              ref={customerPickerModalSheetRef}
            >
              <div className="customerPickerModalHeader">
                <strong id="customer-picker-title">Gespeicherte Kunden</strong>
                <button
                  type="button"
                  className="customerPickerModalCloseButton"
                  aria-label="Gespeicherte Kunden schließen"
                  onClick={closeCustomerPickerPopup}
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

              <div className="customerPickerList customerPickerListModal">
                <input
                  className="customerPickerSearch"
                  type="search"
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Kunde suchen (Name, Firma, Adresse)"
                  aria-label="Gespeicherte Kunden suchen"
                />

                <div className="customerPickerResults customerPickerResultsModal" role="list">
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
            </section>
          </div>
        ) : null}

        <InfoLegalModal
          isOpen={isInfoLegalOpen}
          isClosing={isClosingInfoLegal}
          onClose={closeInfoLegalModal}
          sheetRef={infoLegalSheetRef}
        />

        <div className="appFrameWithSidebar">
          <aside className="appSidebar" aria-label="Schnellnavigation">
            <div className="appSidebarTop">
              <div className="appSidebarBrandWrap">
                <img
                  src="/visioro-logo.png"
                  alt="Visioro"
                  className="appSidebarBrandPill"
                />
              </div>
              <div className="appSidebarNav">
                <div className={`appSidebarNavItem ${isSettingsOverlayOpen ? "active" : ""}`}>
                  <button
                    type="button"
                    className="appSidebarNavIconWrap"
                    onClick={openSettingsFromAccountMenu}
                    aria-label="Einstellungen öffnen"
                    title="Einstellungen"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="appSidebarNavIcon"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M9.2 4.8h5.6l4.1 4.1v5.6l-4.1 4.1H9.2l-4.1-4.1V8.9l4.1-4.1Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.55"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle
                        cx="12"
                        cy="11.9"
                        r="2.55"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.55"
                      />
                    </svg>
                  </button>
                  <span className="appSidebarNavLabel">Einstellungen</span>
                </div>
                <div className={`appSidebarNavItem ${isCustomerArchiveOpen ? "active" : ""}`}>
                  <button
                    type="button"
                    className="appSidebarNavIconWrap"
                    onClick={openCustomerArchiveFromAccountMenu}
                    aria-label="Gespeicherte Kunden öffnen"
                    title="Gespeicherte Kunden"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="appSidebarNavIcon"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M3.8 7.3a2.1 2.1 0 0 1 2.1-2.1H11l1.9 2.2h5.3a2.1 2.1 0 0 1 2.1 2.1v8.4a2.1 2.1 0 0 1-2.1 2.1H5.9a2.1 2.1 0 0 1-2.1-2.1V7.3Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <span className="appSidebarNavLabel">Gespeicherte Kunden</span>
                </div>
                <div className={`appSidebarNavItem ${isSetupHintOpen ? "active" : ""}`}>
                  <button
                    type="button"
                    className="appSidebarNavIconWrap"
                    onClick={toggleTipsFromAccountMenu}
                    aria-label="Tipps anzeigen"
                    title="Tipps"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="appSidebarNavIcon"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M12 4.4a5.7 5.7 0 0 0-3.7 10c.8.7 1.3 1.6 1.5 2.5h4.4c.2-.9.7-1.8 1.5-2.5A5.7 5.7 0 0 0 12 4.4Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M9.4 18.3h5.2M10.1 20.1h3.8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  <span className="appSidebarNavLabel">Tipps</span>
                </div>
                <div className={`appSidebarNavItem ${isInfoLegalOpen ? "active" : ""}`}>
                  <button
                    type="button"
                    className="appSidebarNavIconWrap"
                    onClick={openInfoLegalFromAccountMenu}
                    aria-label="Info und Rechtliches öffnen"
                    title="Info und Rechtliches"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="appSidebarNavIcon"
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
                  <span className="appSidebarNavLabel">Info &amp; Rechtliches</span>
                </div>
              </div>
            </div>

            <div className="appSidebarBottom">
              {isAuthenticatedUser ? (
                <div className="appSidebarActionButton">
                  <button
                    type="button"
                    className="appSidebarNavIconWrap"
                    onClick={() => void handleLogoutFromAccountMenu()}
                    aria-label="Ausloggen"
                    title="Ausloggen"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="appSidebarNavIcon"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M15 7.5V6.2a2.2 2.2 0 0 0-2.2-2.2H7.2A2.2 2.2 0 0 0 5 6.2v11.6A2.2 2.2 0 0 0 7.2 20h5.6A2.2 2.2 0 0 0 15 17.8v-1.3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M10.5 12h8m-2.7-2.7L18.5 12l-2.7 2.7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <span className="appSidebarNavLabel">Ausloggen</span>
                </div>
              ) : (
                <div className="appSidebarActionButton">
                  <button
                    type="button"
                    className="appSidebarNavIconWrap"
                    onClick={navigateToAuthFromAccountMenu}
                    aria-label="Login oder Registrierung"
                    title="Login / Registrieren"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="appSidebarNavIcon"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M9 7.4V6.2A2.2 2.2 0 0 1 11.2 4h5.6A2.2 2.2 0 0 1 19 6.2v11.6a2.2 2.2 0 0 1-2.2 2.2h-5.6A2.2 2.2 0 0 1 9 17.8v-1.2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M4.8 12h8m-2.7-2.7L12.8 12l-2.7 2.7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <span className="appSidebarNavLabel">Login / Registrieren</span>
                </div>
              )}
            </div>
          </aside>

          <div className="appMainContent">
            <div
              key={documentMode}
              className="documentModeContent"
            >
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
              <section className="workspaceGrid workspaceGridSingle dashboardWorkspace">
              <article className="glassCard formCard dashboardPrimaryCard">
            <form onSubmit={onSubmit} className="formGrid dashboardFormGrid">
              <div className="voicePanel dashboardVoicePanel span2">
                <div className="voicePanelHeader">
                  <strong>Per KI erfassen</strong>
                  <p>
                    Diktiere frei oder nutze ein Foto. Die Eingaben werden
                    automatisch in die Felder übernommen.
                  </p>
                </div>

                <input
                  ref={photoCaptureInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPhotoInputChange}
                  style={{ display: "none" }}
                />
                <input
                  ref={photoUploadInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onPhotoInputChange}
                  style={{ display: "none" }}
                />

                <div
                  className="intakePrimaryActions"
                  role="group"
                  aria-label="Per KI erfassen"
                >
                  <button
                    type="button"
                    className="intakePrimaryActionButton intakePrimaryActionButtonPrimary"
                    onClick={startPrimaryVoiceIntake}
                    disabled={isAnyIntakeProcessing || isKiIntakeLocked}
                  >
                    KI-Aufnahme starten
                  </button>
                  <div className="photoScanQuickMenuAnchor">
                    <button
                      type="button"
                      className="intakePrimaryActionButton intakePrimaryActionButtonSecondary"
                      onClick={openPhotoScanSheet}
                      disabled={isAnyIntakeProcessing || isKiIntakeLocked}
                      aria-label="Foto scannen"
                      title="Foto scannen"
                      aria-expanded={isPhotoScanSheetOpen}
                      aria-haspopup="menu"
                      ref={photoScanTriggerButtonRef}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="intakePhotoScanIcon"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M4.6 8.4h2.9l1.3-2h6.4l1.3 2h2.9a1.8 1.8 0 0 1 1.8 1.8v7.8a1.8 1.8 0 0 1-1.8 1.8H4.6A1.8 1.8 0 0 1 2.8 18V10.2a1.8 1.8 0 0 1 1.8-1.8Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle
                          cx="12"
                          cy="14"
                          r="3.2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                      </svg>
                    </button>

                    {isPhotoScanSheetOpen ? (
                      <div
                        className="photoScanQuickMenu"
                        role="menu"
                        aria-label="Fotooptionen"
                        ref={photoScanMenuRef}
                      >
                        <button
                          type="button"
                          className="photoScanQuickMenuItem"
                          role="menuitem"
                          onClick={triggerPhotoCaptureInput}
                          disabled={isAnyIntakeProcessing}
                        >
                          Foto aufnehmen
                        </button>
                        <button
                          type="button"
                          className="photoScanQuickMenuItem"
                          role="menuitem"
                          onClick={triggerPhotoUploadInput}
                          disabled={isAnyIntakeProcessing}
                        >
                          Foto hochladen
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                {isKiIntakeLocked ? (
                  <p className="voiceWarning" role="status" aria-live="polite">
                    {isAuthStatusLoading
                      ? "Loginstatus wird geprüft ..."
                      : "Bitte zuerst einloggen, um die KI-Aufnahmefunktion zu nutzen."}
                  </p>
                ) : null}

                {intakeInputMode === "voice" ? (
                  <>
                    {isListening || isSpeechPaused ? (
                      <div className="voiceActions">
                        {isListening ? (
                          <>
                            <button
                              type="button"
                              className="ghostButton voiceActionButton voiceActionButtonPause"
                              onClick={pauseSpeechInput}
                              disabled={!speechSupported || isAnyIntakeProcessing}
                            >
                              Pause
                            </button>
                            <button
                              type="button"
                              className="ghostButton voiceActionButton voiceActionButtonStop"
                              onClick={stopSpeechInput}
                              disabled={!speechSupported || isAnyIntakeProcessing}
                            >
                              Aufnahme stoppen
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="ghostButton voiceActionButton voiceActionButtonResume"
                              onClick={startSpeechInput}
                              disabled={!speechSupported || isAnyIntakeProcessing}
                            >
                              Fortsetzen
                            </button>
                            <button
                              type="button"
                              className="ghostButton voiceActionButton voiceActionButtonStop"
                              onClick={stopSpeechInput}
                              disabled={!speechSupported || isAnyIntakeProcessing}
                            >
                              Aufnahme stoppen
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}

                    <label className="field">
                      <span>Gesprochener Text</span>
                      <div className="voiceTranscriptFieldBody">
                        <textarea
                          className="voiceTranscriptTextarea"
                          rows={3}
                          value={voiceTranscript}
                          onChange={(e) => {
                            setVoiceTranscript(e.target.value);
                            setVoiceMissingFields([]);
                          }}
                          placeholder="z. B. Kunde, Beispielweg 5, Stadt, Betonarbeiten 2 Stück à 120 Euro"
                        />
                      </div>
                      {hasUsedPrimaryVoiceIntake ? (
                        <div className="voiceTranscriptActions">
                          <button
                            type="button"
                            className="voiceTranscriptResetAction"
                            onClick={resetCurrentInputs}
                            disabled={isSubmitting || isAnyIntakeProcessing}
                          >
                            Felder leeren
                          </button>
                        </div>
                      ) : null}
                    </label>

                    {!speechSupported || voiceInfo || voiceError ? (
                      <div className="voiceStatusSection">
                        <span className="voiceStatusSectionLabel">Status</span>
                        <div className="voiceStatusGroup">
                          {!speechSupported ? (
                            <p
                              className="voiceStatusCard voiceStatusCardWarning"
                              role="alert"
                            >
                              <span
                                className="voiceStatusIcon"
                                aria-hidden="true"
                              >
                                !
                              </span>
                              <span className="voiceStatusText">
                                Spracherkennung wird auf diesem Browser nicht
                                unterstützt.
                              </span>
                            </p>
                          ) : null}
                          {voiceInfo ? (
                            <p
                              className={`voiceStatusCard voiceStatusCardInfo ${isListening ? "voiceStatusCardLive" : ""}`}
                              role="status"
                              aria-live="polite"
                            >
                              <span
                                className="voiceStatusIcon"
                                aria-hidden="true"
                              >
                                i
                              </span>
                              <span className="voiceStatusText">{voiceInfo}</span>
                              {isListening ? (
                                <span
                                  className="voiceStatusBadge"
                                  aria-hidden="true"
                                >
                                  live
                                </span>
                              ) : null}
                            </p>
                          ) : null}
                          {voiceError ? (
                            <p
                              className="voiceStatusCard voiceStatusCardError"
                              role="alert"
                            >
                              <span
                                className="voiceStatusIcon"
                                aria-hidden="true"
                              >
                                !
                              </span>
                              <span className="voiceStatusText">{voiceError}</span>
                            </p>
                          ) : null}
                        </div>
                      </div>
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
                  </>
                ) : (
                  <>
                    {!photoPreviewDataUrl && !photoInfo && !photoError ? (
                      <p className="intakeFlowHint">
                        Klicke auf den roten Kamera-Button, um ein Foto
                        aufzunehmen oder hochzuladen.
                      </p>
                    ) : null}

                    {photoPreviewDataUrl ? (
                      <div className="photoPreviewWrap">
                        <img
                          src={photoPreviewDataUrl}
                          alt="Hochgeladenes Notizfoto"
                          className="photoPreviewImage"
                        />
                      </div>
                    ) : null}
                    {photoInfo || photoError ? (
                      <div className="voiceStatusSection">
                        <span className="voiceStatusSectionLabel">Status</span>
                        <div className="voiceStatusGroup">
                          {photoInfo ? (
                            <p
                              className="voiceStatusCard voiceStatusCardInfo"
                              role="status"
                              aria-live="polite"
                            >
                              <span
                                className="voiceStatusIcon"
                                aria-hidden="true"
                              >
                                i
                              </span>
                              <span className="voiceStatusText">{photoInfo}</span>
                            </p>
                          ) : null}
                          {photoError ? (
                            <p
                              className="voiceStatusCard voiceStatusCardError"
                              role="alert"
                            >
                              <span
                                className="voiceStatusIcon"
                                aria-hidden="true"
                              >
                                !
                              </span>
                              <span className="voiceStatusText">{photoError}</span>
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {photoReviewDraft ? (
                      <div className="photoReviewPanel">
                        <div className="photoReviewHeader">
                          <strong>Erkannte Daten prüfen</strong>
                          <p>
                            Bitte Daten kontrollieren, fehlende Angaben ergänzen
                            und erst dann übernehmen.
                          </p>
                        </div>

                        {photoReviewDraft.sourceText ? (
                          <details className="photoReviewSource">
                            <summary>Erkannter Notiztext</summary>
                            <p>{photoReviewDraft.sourceText}</p>
                          </details>
                        ) : null}

                        <div className="recipientType photoReviewRecipientType" role="group" aria-label="Kundenart im Foto-Review">
                          <span>Kundenart</span>
                          <div className="recipientTypeButtons">
                            <button
                              type="button"
                              className={`recipientTypeButton ${photoReviewDraft.customerType === "company" ? "active" : ""}`}
                              aria-pressed={photoReviewDraft.customerType === "company"}
                              onClick={() =>
                                setPhotoReviewDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        customerType: "company",
                                      }
                                    : prev,
                                )
                              }
                            >
                              Firma
                            </button>
                            <button
                              type="button"
                              className={`recipientTypeButton ${photoReviewDraft.customerType === "person" ? "active" : ""}`}
                              aria-pressed={photoReviewDraft.customerType === "person"}
                              onClick={() =>
                                setPhotoReviewDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        customerType: "person",
                                      }
                                    : prev,
                                )
                              }
                            >
                              Privatperson
                            </button>
                          </div>
                        </div>

                        <div className="photoReviewGrid">
                          {photoReviewDraft.customerType === "company" ? (
                            <label className="field">
                              <span>Firma</span>
                              <input
                                value={photoReviewDraft.companyName}
                                onChange={(event) =>
                                  setPhotoReviewDraft((prev) =>
                                    prev
                                      ? { ...prev, companyName: event.target.value }
                                      : prev,
                                  )
                                }
                              />
                            </label>
                          ) : (
                            <>
                              <label className="field">
                                <span>Anrede</span>
                                <select
                                  value={photoReviewDraft.salutation}
                                  onChange={(event) =>
                                    setPhotoReviewDraft((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            salutation:
                                              event.target.value === "frau"
                                                ? "frau"
                                                : "herr",
                                          }
                                        : prev,
                                    )
                                  }
                                >
                                  <option value="herr">Herr</option>
                                  <option value="frau">Frau</option>
                                </select>
                              </label>
                              <label className="field">
                                <span>Vorname</span>
                                <input
                                  value={photoReviewDraft.firstName}
                                  onChange={(event) =>
                                    setPhotoReviewDraft((prev) =>
                                      prev
                                        ? { ...prev, firstName: event.target.value }
                                        : prev,
                                    )
                                  }
                                />
                              </label>
                              <label className="field">
                                <span>Nachname</span>
                                <input
                                  value={photoReviewDraft.lastName}
                                  onChange={(event) =>
                                    setPhotoReviewDraft((prev) =>
                                      prev
                                        ? { ...prev, lastName: event.target.value }
                                        : prev,
                                    )
                                  }
                                />
                              </label>
                            </>
                          )}
                          <label className="field">
                            <span>Straße / Hausnummer</span>
                            <input
                              value={photoReviewDraft.street}
                              onChange={(event) =>
                                setPhotoReviewDraft((prev) =>
                                  prev ? { ...prev, street: event.target.value } : prev,
                                )
                              }
                            />
                          </label>
                          <label className="field">
                            <span>PLZ</span>
                            <input
                              value={photoReviewDraft.postalCode}
                              onChange={(event) =>
                                setPhotoReviewDraft((prev) =>
                                  prev
                                    ? { ...prev, postalCode: event.target.value }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Ort</span>
                            <input
                              value={photoReviewDraft.city}
                              onChange={(event) =>
                                setPhotoReviewDraft((prev) =>
                                  prev ? { ...prev, city: event.target.value } : prev,
                                )
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Kunden-E-Mail</span>
                            <input
                              type="email"
                              value={photoReviewDraft.customerEmail}
                              onChange={(event) =>
                                setPhotoReviewDraft((prev) =>
                                  prev
                                    ? { ...prev, customerEmail: event.target.value }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <label className="field span2">
                            <span>Leistungsbeschreibung / Notizen</span>
                            <textarea
                              className="voiceTranscriptTextarea photoReviewTextarea"
                              rows={3}
                              value={photoReviewDraft.serviceDescription}
                              onChange={(event) =>
                                setPhotoReviewDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        serviceDescription: event.target.value,
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Stunden</span>
                            <input
                              inputMode="decimal"
                              value={photoReviewDraft.hours}
                              onChange={(event) =>
                                setPhotoReviewDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        hours: sanitizeQuantityInput(event.target.value),
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Stundensatz</span>
                            <input
                              inputMode="decimal"
                              value={photoReviewDraft.hourlyRate}
                              onChange={(event) =>
                                setPhotoReviewDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        hourlyRate: sanitizePriceInput(
                                          event.target.value,
                                        ),
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Materialkosten</span>
                            <input
                              inputMode="decimal"
                              value={photoReviewDraft.materialCost}
                              onChange={(event) =>
                                setPhotoReviewDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        materialCost: sanitizePriceInput(
                                          event.target.value,
                                        ),
                                      }
                                    : prev,
                                )
                              }
                            />
                          </label>
                        </div>

                        <div className="photoReviewPositions">
                          <div className="photoReviewPositionsHeader">
                            <strong>Positionen</strong>
                            <button
                              type="button"
                              className="ghostButton positionsAddRowButton"
                              onClick={addPhotoReviewPosition}
                            >
                              Position hinzufügen
                            </button>
                          </div>
                          {photoReviewDraft.positions.length === 0 ? (
                            <p className="selectedServiceHint">
                              Keine Position erkannt. Bei Bedarf manuell
                              ergänzen.
                            </p>
                          ) : (
                            <div className="photoReviewPositionList">
                              {photoReviewDraft.positions.map((position) => (
                                <div key={position.id} className="photoReviewPositionRow">
                                  <input
                                    placeholder="Gruppe"
                                    value={position.group}
                                    onChange={(event) =>
                                      updatePhotoReviewPosition(
                                        position.id,
                                        "group",
                                        event.target.value,
                                      )
                                    }
                                  />
                                  <input
                                    placeholder="Beschreibung"
                                    value={position.description}
                                    onChange={(event) =>
                                      updatePhotoReviewPosition(
                                        position.id,
                                        "description",
                                        event.target.value,
                                      )
                                    }
                                  />
                                  <input
                                    inputMode="decimal"
                                    placeholder="Menge"
                                    value={position.quantity}
                                    onChange={(event) =>
                                      updatePhotoReviewPosition(
                                        position.id,
                                        "quantity",
                                        event.target.value,
                                      )
                                    }
                                  />
                                  <select
                                    value={position.unit}
                                    onChange={(event) =>
                                      updatePhotoReviewPosition(
                                        position.id,
                                        "unit",
                                        event.target.value,
                                      )
                                    }
                                  >
                                    {UNIT_OPTIONS.map((unitOption) => (
                                      <option key={unitOption} value={unitOption}>
                                        {unitOption}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    inputMode="decimal"
                                    placeholder="Einzelpreis"
                                    value={position.unitPrice}
                                    onChange={(event) =>
                                      updatePhotoReviewPosition(
                                        position.id,
                                        "unitPrice",
                                        event.target.value,
                                      )
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="positionDeleteButton"
                                    onClick={() =>
                                      removePhotoReviewPosition(position.id)
                                    }
                                  >
                                    Entfernen
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {photoReviewDraft.missingFieldLabels.length > 0 ? (
                          <div className="voiceMissingPanel">
                            <span className="voiceMissingLabel">Noch zu ergänzen</span>
                            <div className="voiceMissingList">
                              {photoReviewDraft.missingFieldLabels.map((field) => (
                                <span key={field} className="voiceMissingTag">
                                  {field}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="photoReviewActions">
                          <button
                            type="button"
                            className="ghostButton voiceActionButton voiceActionButtonResume"
                            onClick={applyPhotoReview}
                          >
                            Daten übernehmen
                          </button>
                          <button
                            type="button"
                            className="ghostButton voiceActionButton voiceActionButtonClear"
                            onClick={dismissPhotoReview}
                          >
                            Verwerfen
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
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
                    className={`recipientTypeButton ${form.customerType === "company" ? "active" : ""}`}
                    aria-pressed={form.customerType === "company"}
                    onClick={() =>
                      setForm((prev) => ({ ...prev, customerType: "company" }))
                    }
                  >
                    Firma
                  </button>
                  <button
                    type="button"
                    className={`recipientTypeButton ${form.customerType === "person" ? "active" : ""}`}
                    aria-pressed={form.customerType === "person"}
                    onClick={() =>
                      setForm((prev) => ({ ...prev, customerType: "person" }))
                    }
                  >
                    Privatperson
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
                <div className="positionsIntegratedPanel dashboardPositionsPanel">
                  <div className="positionsSearchPanel">
                    <div className="positionsModuleHeader">
                      <h3 className="positionsModuleTitle positionsTableHeadingTypo">
                        LEISTUNGEN &amp; POSITIONEN
                      </h3>
                    </div>
                    <div className="positionsSearchRow">
                      <div className="servicePicker positionsServicePicker" ref={servicePickerRef}>
                        <input
                          id="positionsServiceSearch"
                          className="serviceSearchInput"
                          aria-label="Leistung suchen"
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
                  </div>

                  <div className="positionsInputWrap positionsInputWrapMerged">
                    <table className="positionsInputTable">
                      <thead>
                        <tr>
                          <th className="positionsTableHeaderLikeRecipient">Bezeichnung / Unterpunkt</th>
                          <th className="positionsTableHeaderLikeRecipient">Menge</th>
                          <th className="positionsTableHeaderLikeRecipient">Einheit</th>
                          <th className="positionsTableHeaderLikeRecipient">Einzelpreis</th>
                          <th className="positionsTableHeaderLikeRecipient">Gesamtpreis</th>
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
                              {service.label.trim() !== DEFAULT_MANUAL_GROUP_LABEL ? (
                                <tr className="positionsGroupRow">
                                  <td colSpan={6}>{service.label}</td>
                                </tr>
                              ) : null}
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
                                      aria-label={`Einzelpreis / Preis EUR für ${service.label}`}
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
                                      <svg
                                        viewBox="0 0 24 24"
                                        className="positionDeleteIcon"
                                        aria-hidden="true"
                                        focusable="false"
                                      >
                                        <path
                                          d="M3 6h18"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M8 6V4h8v2"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M19 6 18 20H6L5 6"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M10 11v6M14 11v6"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
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
                        +
                      </button>
                    </div>
                    {serviceInfo ? (
                      <p className="voiceInfo positionsPanelInfo" role="status" aria-live="polite">
                        {serviceInfo}
                      </p>
                    ) : null}
                    {serviceError &&
                    !/^nicht eingeloggt\.?$/i.test(serviceError.trim()) ? (
                      <p className="voiceWarning positionsPanelWarning" role="alert">
                        {serviceError}
                      </p>
                    ) : null}
                  </div>
                </div>
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

              <div
                className="submitActionRow dashboardCtaRow span2"
              >
                <button
                  className="primaryButton submitButton"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? `${singularDocumentLabel} wird erstellt...`
                    : `${singularDocumentLabel} erstellen`}
                </button>
                <button
                  type="button"
                  className="ghostButton submitMailButton"
                  onClick={handleOfferMailDraftOpen}
                  disabled={
                    isPreparingOfferMailDraft
                  }
                  title={
                    !canOpenOfferMailDraft
                      ? createDocumentFirstInfo
                      : offerMailActionState?.customerEmail.trim()
                      ? `${singularDocumentLabel} per E-Mail versenden`
                      : "Für den Versand fehlt eine Kunden-E-Mail"
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="submitMailButtonIcon"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M3 11.5 20 3l-5.1 18.1-3.6-6.1-6.3-3.5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="m20 3-8.7 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="submitMailButtonLabel">
                    {isPreparingOfferMailDraft
                      ? "Mail wird geöffnet..."
                      : "Per E-Mail senden"}
                  </span>
                </button>
              </div>

            </form>

            {error ? <p className="error">{error}</p> : null}
            {!error && postActionInfo ? (
              <p className={`voiceInfo${isCreateDocumentHint ? " postActionError" : ""}`} role="status" aria-live="polite">
                {postActionInfo}
              </p>
            ) : null}
              </article>
            </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
