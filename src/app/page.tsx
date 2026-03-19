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
  detectedInputLanguage?: string;
  shouldAskFollowUp?: boolean;
  followUpQuestion?: string | null;
  followUpSpeechLocale?: string;
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

function todayDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

const DEFAULT_MANUAL_GROUP_LABEL = "Weitere Positionen";
const HOME_STATE_STORAGE_KEY = "visioro-home-state-v1";

type ConversationLanguage =
  | "de"
  | "en"
  | "tr"
  | "pl"
  | "ar"
  | "sq"
  | "bs"
  | "hr"
  | "sr"
  | "mk";

type AssistantSpeechKey =
  | "listening"
  | "processing"
  | "completed"
  | "partial"
  | "error";

function resolveSpeechLocale(value?: string): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "de-DE";
  }
  if (normalized.startsWith("de")) {
    return "de-DE";
  }
  if (normalized.startsWith("en")) {
    return "en-US";
  }
  if (normalized.startsWith("tr")) {
    return "tr-TR";
  }
  if (normalized.startsWith("pl")) {
    return "pl-PL";
  }
  if (normalized.startsWith("ar")) {
    return "ar-SA";
  }
  if (normalized.startsWith("sq") || normalized.startsWith("al")) {
    return "sq-AL";
  }
  if (normalized.startsWith("bs")) {
    return "bs-BA";
  }
  if (normalized.startsWith("hr")) {
    return "hr-HR";
  }
  if (normalized.startsWith("sr")) {
    return "sr-RS";
  }
  if (normalized.startsWith("mk")) {
    return "mk-MK";
  }
  return "de-DE";
}

function resolveConversationLanguage(value?: string): ConversationLanguage {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "de";
  }
  if (normalized.startsWith("de")) {
    return "de";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  if (normalized.startsWith("tr")) {
    return "tr";
  }
  if (normalized.startsWith("pl")) {
    return "pl";
  }
  if (normalized.startsWith("ar")) {
    return "ar";
  }
  if (normalized.startsWith("sq") || normalized.startsWith("al")) {
    return "sq";
  }
  if (normalized.startsWith("bs")) {
    return "bs";
  }
  if (normalized.startsWith("hr")) {
    return "hr";
  }
  if (normalized.startsWith("sr")) {
    return "sr";
  }
  if (normalized.startsWith("mk")) {
    return "mk";
  }
  return "de";
}

const ASSISTANT_SPEECH_TEXT: Record<
  ConversationLanguage,
  Record<AssistantSpeechKey, string>
> = {
  de: {
    listening: "Alles klar. Ich höre zu.",
    processing: "Einen Moment, ich prüfe deine Angaben.",
    completed: "Verstanden. Ich habe die Felder aktualisiert.",
    partial: "Ich habe schon einiges übernommen. Bitte ergänze noch die fehlenden Angaben.",
    error: "Entschuldige, das habe ich nicht sauber verstanden. Bitte wiederhole es kurz.",
  },
  en: {
    listening: "Great, I am listening.",
    processing: "One moment, I am checking your details.",
    completed: "Understood. I have updated the fields.",
    partial: "I have filled in a lot already. Please add the missing details.",
    error: "Sorry, I could not process that clearly. Please repeat briefly.",
  },
  tr: {
    listening: "Tamam, seni dinliyorum.",
    processing: "Bir an, bilgileri kontrol ediyorum.",
    completed: "Anladim. Alanlari guncelledim.",
    partial: "Bir cogu tamamlandi. Lutfen eksik bilgileri de soyle.",
    error: "Uzgunum, bunu net anlayamadim. Lutfen kisaca tekrar et.",
  },
  pl: {
    listening: "Dobrze, slucham.",
    processing: "Moment, sprawdzam podane dane.",
    completed: "Zrozumialam. Pola zostaly zaktualizowane.",
    partial: "Sporo danych juz uzupelnilam. Prosze dopowiedz brakujace informacje.",
    error: "Przepraszam, nie zrozumialam tego wyraznie. Powtorz prosze krotko.",
  },
  ar: {
    listening: "حسنًا، أنا أستمع الآن.",
    processing: "لحظة من فضلك، أتحقق من البيانات.",
    completed: "تم الفهم. لقد قمت بتحديث الحقول.",
    partial: "أضفت جزءًا كبيرًا من البيانات. من فضلك أكمل المعلومات الناقصة.",
    error: "عذرًا، لم أفهم ذلك بشكل واضح. من فضلك أعده باختصار.",
  },
  sq: {
    listening: "Ne rregull, po te degjoj.",
    processing: "Nje moment, po kontrolloj te dhenat.",
    completed: "U kuptua. I perditesova fushat.",
    partial: "Kam plotesuar nje pjese te madhe. Ju lutem shto te dhenat qe mungojne.",
    error: "Me fal, nuk e kuptova qarte. Te lutem perserite shkurt.",
  },
  bs: {
    listening: "U redu, slusam.",
    processing: "Samo trenutak, provjeravam podatke.",
    completed: "Razumijem. Polja su azurirana.",
    partial: "Dobar dio je vec popunjen. Molim dopuni preostale podatke.",
    error: "Izvini, nisam to jasno razumjela. Molim ponovi ukratko.",
  },
  hr: {
    listening: "U redu, slusam.",
    processing: "Trenutak, provjeravam podatke.",
    completed: "Razumijem. Polja su azurirana.",
    partial: "Dobar dio je vec popunjen. Molim te dopuni preostale podatke.",
    error: "Oprosti, to nisam jasno razumjela. Molim ponovi ukratko.",
  },
  sr: {
    listening: "U redu, slusam.",
    processing: "Samo trenutak, proveravam podatke.",
    completed: "Razumem. Polja su azurirana.",
    partial: "Dobar deo je vec popunjen. Molim dopuni preostale podatke.",
    error: "Izvini, nisam to jasno razumela. Molim ponovi ukratko.",
  },
  mk: {
    listening: "Vo red, te slusam.",
    processing: "Eden moment, gi proveruvam podatocite.",
    completed: "Razbrav. Polinjata se azurirani.",
    partial: "Dobar del e veke popolnet. Te molam dopolni gi preostanatite podatoci.",
    error: "Izvini, ova ne go razbrav jasno. Te molam povtori nakratko.",
  },
};

function assistantSpeechText(
  key: AssistantSpeechKey,
  languageHint?: string,
): string {
  const language = resolveConversationLanguage(languageHint);
  return ASSISTANT_SPEECH_TEXT[language][key] ?? ASSISTANT_SPEECH_TEXT.de[key];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
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

function parseLocaleNumber(rawValue: string): number {
  const normalized = rawValue.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) {
    return NaN;
  }

  const parsed = Number(normalized);
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
  return sanitizeQuantityInput(rawValue);
}

function formatEuroValue(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
  const [isAiAskingFollowUp, setIsAiAskingFollowUp] = useState(false);
  const [voiceMissingFields, setVoiceMissingFields] = useState<string[]>([]);
  const [serviceCatalog, setServiceCatalog] =
    useState<ServiceCatalogItem[]>(getSeedServices());
  const [serviceSearch, setServiceSearch] = useState("");
  const [selectedServices, setSelectedServices] = useState<
    SelectedServiceEntry[]
  >([]);
  const [isServiceSearchOpen, setIsServiceSearchOpen] = useState(false);
  const [isServiceCatalogLoading, setIsServiceCatalogLoading] = useState(false);
  const [isAddingCustomService, setIsAddingCustomService] = useState(false);
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
  const [isCompanySetupComplete, setIsCompanySetupComplete] = useState(false);
  const [isSetupHintOpen, setIsSetupHintOpen] = useState(false);
  const [isOpeningSettings, setIsOpeningSettings] = useState(false);
  const [isHomeStateHydrated, setIsHomeStateHydrated] = useState(false);
  const recognitionRef = useRef<any>(null);
  const modeSnapshotsRef = useRef<Record<DocumentMode, ModeSnapshot>>({
    offer: createInitialModeSnapshot(),
    invoice: createInitialModeSnapshot(),
  });
  const shouldAutoApplyVoiceRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const isListeningRef = useRef(false);
  const isParsingVoiceRef = useRef(false);
  const speechLanguageHintRef = useRef("de-DE");
  const followUpRoundRef = useRef(0);
  const followUpSpeechTimeoutRef = useRef<number | null>(null);
  const skipStartAnnouncementRef = useRef(false);
  const speechSessionIdRef = useRef(0);
  const servicePickerRef = useRef<HTMLDivElement | null>(null);
  const finalTranscriptRef = useRef("");
  const settingsNavTimeoutRef = useRef<number | null>(null);
  const invoiceDateInputRef = useRef<HTMLInputElement | null>(null);

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
  const isInvoiceMode = documentMode === "invoice";
  const singularDocumentLabel = isInvoiceMode ? "Rechnung" : "Angebot";

  function applyModeSnapshot(snapshot: ModeSnapshot) {
    setForm({ ...snapshot.form });
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
    cancelFollowUpSpeech();
    speechLanguageHintRef.current = "de-DE";
    followUpRoundRef.current = 0;
    setIsSpeechPaused(false);

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
    cancelFollowUpSpeech();

    finalTranscriptRef.current = "";
    speechLanguageHintRef.current = "de-DE";
    skipStartAnnouncementRef.current = false;
    followUpRoundRef.current = 0;
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
      speechSessionIdRef.current += 1;
      if (followUpSpeechTimeoutRef.current !== null) {
        window.clearTimeout(followUpSpeechTimeoutRef.current);
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
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
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isParsingVoiceRef.current = isParsingVoice;
  }, [isParsingVoice]);

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
    let mounted = true;

    async function loadSettingsStatus() {
      try {
        const response = await fetch("/api/settings");
        const data = (await response.json()) as SettingsApiResponse;
        if (!response.ok) {
          return;
        }
        if (mounted) {
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
    function closeServiceSearch(event: MouseEvent) {
      if (!servicePickerRef.current) {
        return;
      }

      if (servicePickerRef.current.contains(event.target as Node)) {
        return;
      }

      setIsServiceSearchOpen(false);
    }

    document.addEventListener("mousedown", closeServiceSearch);
    return () => document.removeEventListener("mousedown", closeServiceSearch);
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

  function cancelFollowUpSpeech() {
    speechSessionIdRef.current += 1;

    if (followUpSpeechTimeoutRef.current !== null) {
      window.clearTimeout(followUpSpeechTimeoutRef.current);
      followUpSpeechTimeoutRef.current = null;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setIsAiAskingFollowUp(false);
  }

  function speakAssistant(
    textInput: string,
    options?: {
      languageHint?: string;
      autoResumeListening?: boolean;
      onEnd?: () => void;
    },
  ): boolean {
    const text = textInput.trim();
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return false;
    }

    const autoResumeListening = options?.autoResumeListening === true;
    const synthesis = window.speechSynthesis;
    const locale = resolveSpeechLocale(options?.languageHint);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    utterance.rate = 0.94;
    utterance.pitch = 1.03;
    utterance.volume = 1;

    const sessionId = speechSessionIdRef.current + 1;
    speechSessionIdRef.current = sessionId;

    const localePrefix = locale.split("-")[0].toLowerCase();
    const matchingVoices = synthesis
      .getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith(localePrefix));
    const femaleVoiceHints =
      /(female|woman|samantha|victoria|zira|aria|emma|sofia|anna|maria|helena|serena|siri|google.*female|nora|eva|lisa)/i;
    const maleVoiceHints =
      /(male|man|david|thomas|mark|alex|daniel|jorge|filip|nikola|pavel)/i;
    const preferredVoice =
      matchingVoices.find(
        (voice) =>
          femaleVoiceHints.test(voice.name) && !maleVoiceHints.test(voice.name),
      ) ?? matchingVoices[0];
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => {
      if (sessionId !== speechSessionIdRef.current) {
        return;
      }
      setIsAiAskingFollowUp(true);
    };

    utterance.onerror = () => {
      if (sessionId !== speechSessionIdRef.current) {
        return;
      }
      setIsAiAskingFollowUp(false);
      options?.onEnd?.();
    };

    utterance.onend = () => {
      if (sessionId !== speechSessionIdRef.current) {
        return;
      }
      setIsAiAskingFollowUp(false);
      options?.onEnd?.();

      if (!autoResumeListening) {
        return;
      }

      if (followUpSpeechTimeoutRef.current !== null) {
        window.clearTimeout(followUpSpeechTimeoutRef.current);
      }
      followUpSpeechTimeoutRef.current = window.setTimeout(() => {
        if (sessionId !== speechSessionIdRef.current) {
          return;
        }
        followUpSpeechTimeoutRef.current = null;
        if (
          !recognitionRef.current &&
          !isListeningRef.current &&
          !isParsingVoiceRef.current
        ) {
          skipStartAnnouncementRef.current = true;
          startSpeechInput();
        }
      }, 180);
    };

    synthesis.cancel();
    synthesis.speak(utterance);
    return true;
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
    cancelFollowUpSpeech();
    const shouldAnnounceStart = !skipStartAnnouncementRef.current;
    skipStartAnnouncementRef.current = false;
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
    const browserSpeechLanguage =
      (Array.isArray(window.navigator.languages) &&
      window.navigator.languages.length > 0
        ? window.navigator.languages[0]
        : window.navigator.language) || "de-DE";
    const normalizedSpeechLanguage = resolveSpeechLocale(browserSpeechLanguage);
    speechLanguageHintRef.current = normalizedSpeechLanguage;
    recognition.lang = normalizedSpeechLanguage;
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
      void speakAssistant(
        assistantSpeechText("error", speechLanguageHintRef.current),
        {
          languageHint: speechLanguageHintRef.current,
        },
      );
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
        setVoiceInfo(
          "Aufnahme beendet. Sprich bitte etwas länger oder ergänze den Text manuell.",
        );
        return;
      }

      setVoiceInfo("Aufnahme beendet. Felder werden automatisch übernommen.");
      void parseVoiceTranscript(finalizedTranscript, true);
    };

    recognitionRef.current = recognition;

    const beginRecognition = () => {
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
    };

    if (shouldAnnounceStart) {
      const announced = speakAssistant(
        assistantSpeechText("listening", normalizedSpeechLanguage),
        {
          languageHint: normalizedSpeechLanguage,
          onEnd: beginRecognition,
        },
      );
      if (!announced) {
        beginRecognition();
      }
      return;
    }

    beginRecognition();
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
      setVoiceInfo(
        "Aufnahme beendet. Sprich bitte etwas länger oder ergänze den Text manuell.",
      );
      return;
    }

    setVoiceInfo("Aufnahme beendet. Felder werden automatisch übernommen.");
    void parseVoiceTranscript(finalizedTranscript, true);
  }

  function numberToInput(value: number | undefined): string | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
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
    if (autoTriggered) {
      speakAssistant(
        assistantSpeechText("processing", speechLanguageHintRef.current),
        { languageHint: speechLanguageHintRef.current },
      );
    }

    try {
      const response = await fetch("/api/parse-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          speechLanguageHint: speechLanguageHintRef.current,
        }),
      });
      const data = (await response.json()) as VoiceParseResponse & {
        error?: string;
      };
      if (!response.ok) {
        setVoiceError(
          data.error ?? "Sprachdaten konnten nicht verarbeitet werden.",
        );
        speakAssistant(
          assistantSpeechText("error", speechLanguageHintRef.current),
          { languageHint: speechLanguageHintRef.current },
        );
        return;
      }

      const detectedConversationLocale = resolveSpeechLocale(
        data.followUpSpeechLocale ??
          data.detectedInputLanguage ??
          speechLanguageHintRef.current,
      );
      speechLanguageHintRef.current = detectedConversationLocale;

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
      const baseInfoText = `${modeText}${actionText}${tableText}${missingText}`;
      const followUpQuestionText =
        typeof data.followUpQuestion === "string"
          ? data.followUpQuestion.trim()
          : "";
      const shouldSpeakFollowUp =
        autoTriggered &&
        data.shouldAskFollowUp === true &&
        followUpQuestionText.length > 0 &&
        remainingMissingLabels.length > 0 &&
        followUpRoundRef.current < 3;

      if (remainingMissingLabels.length === 0) {
        followUpRoundRef.current = 0;
      }

      if (shouldSpeakFollowUp) {
        followUpRoundRef.current += 1;
        const didSpeakFollowUp = speakAssistant(
          followUpQuestionText,
          {
            languageHint: speechLanguageHintRef.current,
            autoResumeListening: true,
          },
        );
        if (!didSpeakFollowUp) {
          skipStartAnnouncementRef.current = true;
          startSpeechInput();
        }
        setVoiceInfo(`${baseInfoText} Rückfrage: ${followUpQuestionText}`);
      } else {
        setVoiceInfo(baseInfoText);
        if (autoTriggered) {
          const assistantSummaryKey =
            remainingMissingLabels.length > 0 ? "partial" : "completed";
          speakAssistant(
            assistantSpeechText(
              assistantSummaryKey,
              speechLanguageHintRef.current,
            ),
            { languageHint: speechLanguageHintRef.current },
          );
        }
      }
      setVoiceError("");
      setVoiceMissingFields(remainingMissingLabels);
      setAddressSuggestions([]);
    } catch {
      setVoiceMissingFields([]);
      setVoiceError("Netzwerkfehler bei der Sprachverarbeitung.");
      speakAssistant(assistantSpeechText("error", speechLanguageHintRef.current), {
        languageHint: speechLanguageHintRef.current,
      });
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
      const response = await fetch("/api/generate-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          documentType: documentMode,
          selectedServices: selectedServicesPayload,
          selectedServiceEntries: selectedServiceEntriesPayload,
          positions: positionsPayload,
          sendEmail: false,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Unbekannter Fehler");
        return;
      }

      const payload = data as ApiResponse;
      updateStoredCustomersRealtime(payload);
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
      <div className="container">
        <header className="topHeaderMinimal">
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
                </div>

                {isAiAskingFollowUp ? (
                  <p className="voiceAssistantIndicator" role="status" aria-live="polite">
                    KI fragt nach ...
                  </p>
                ) : null}

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
                <select
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
                    <input
                      className="invoiceMetaInput"
                      required
                      type="text"
                      placeholder="z. B. 01.03.2026 bis 05.03.2026"
                      value={form.serviceDate}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          serviceDate: event.target.value,
                        }))
                      }
                    />
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

              <div className="field span2">
                <span>Leistung suchen</span>
                <div className="servicePicker" ref={servicePickerRef}>
                  <input
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

                <div className="positionsInputWrap">
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
                                      value={subitem.price}
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
                                      placeholder="0,00"
                                      inputMode="decimal"
                                      pattern="[0-9]+([.,][0-9]+)?"
                                      aria-label={`EP / Preis EUR für ${service.label}`}
                                    />
                                  </td>
                                  <td className="positionTotalCell">
                                    {`${formatEuroValue(subitemTotal)} EUR`}
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
                </div>
                <button
                  type="button"
                  className="ghostButton positionsAddRowButton"
                  onClick={addEmptyPositionRow}
                >
                  + Position hinzufügen
                </button>

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
                type="button"
                className="ghostButton resetAllButton span2"
                onClick={resetCurrentInputs}
                disabled={isSubmitting}
              >
                Alles löschen
              </button>

              <button
                className="primaryButton submitButton"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? `${singularDocumentLabel} wird erstellt...`
                  : `${singularDocumentLabel} erstellen`}
              </button>

              {!isCompanySetupComplete ? (
                <p className="formHint span2">
                  Tipp: Hinterlege zuerst deine Firmendaten in den{" "}
                  <Link href="/settings" className="formHintLink">
                    Einstellungen
                  </Link>{" "}
                  oder nutze dafür das Zahnradsymbol oben rechts.
                </p>
              ) : (
                <div className="formHintMiniWrap span2">
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
                      Tipp: Deine Firmendaten sind hinterlegt. Du kannst sie in
                      den{" "}
                      <Link href="/settings" className="formHintLink">
                        Einstellungen
                      </Link>{" "}
                      oder über das Zahnradsymbol oben rechts bearbeiten.
                    </p>
                  ) : null}
                </div>
              )}
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
