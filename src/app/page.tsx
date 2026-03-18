"use client";

import Link from "next/link";
import {
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

type ServicesApiResponse = {
  services?: ServiceCatalogItem[];
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

type StepProgress = {
  customerDataStarted: boolean;
  pdfGenerationStarted: boolean;
  mailDraftStarted: boolean;
};

const initialStepProgress: StepProgress = {
  customerDataStarted: false,
  pdfGenerationStarted: false,
  mailDraftStarted: false,
};

type ModeSnapshot = {
  form: OfferForm;
  selectedServices: SelectedServiceEntry[];
  voiceTranscript: string;
  voiceInfo: string;
  voiceError: string;
  voiceMissingFields: string[];
  stepProgress: StepProgress;
  error: string;
  postActionInfo: string;
  serviceSearch: string;
  isServiceSearchOpen: boolean;
  serviceInfo: string;
  serviceError: string;
  addressSuggestions: AddressSuggestion[];
};

function cloneSelectedServices(
  services: SelectedServiceEntry[],
): SelectedServiceEntry[] {
  return services.map((service) => ({
    ...service,
    subitems: service.subitems.map((subitem) => ({ ...subitem })),
  }));
}

function cloneStepProgress(progress: StepProgress): StepProgress {
  return {
    customerDataStarted: progress.customerDataStarted,
    pdfGenerationStarted: progress.pdfGenerationStarted,
    mailDraftStarted: progress.mailDraftStarted,
  };
}

function createInitialModeSnapshot(): ModeSnapshot {
  return {
    form: createInitialForm(),
    selectedServices: [],
    voiceTranscript: "",
    voiceInfo: "",
    voiceError: "",
    voiceMissingFields: [],
    stepProgress: { ...initialStepProgress },
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
  const [voiceMissingFields, setVoiceMissingFields] = useState<string[]>([]);
  const [stepProgress, setStepProgress] =
    useState<StepProgress>(initialStepProgress);
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
  const [customerSearch, setCustomerSearch] = useState("");
  const [customersError, setCustomersError] = useState("");
  const recognitionRef = useRef<any>(null);
  const modeSnapshotsRef = useRef<Record<DocumentMode, ModeSnapshot>>({
    offer: createInitialModeSnapshot(),
    invoice: createInitialModeSnapshot(),
  });
  const shouldAutoApplyVoiceRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const servicePickerRef = useRef<HTMLDivElement | null>(null);
  const finalTranscriptRef = useRef("");

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
  const modeTitle = isInvoiceMode
    ? "Rechnungen für Handwerker"
    : "Angebote für Handwerker";
  const singularDocumentLabel = isInvoiceMode ? "Rechnung" : "Angebot";
  const progressSteps = [
    {
      id: "customer",
      label: "Kundendaten erfassen",
      done: stepProgress.customerDataStarted,
    },
    {
      id: "pdf",
      label: "Text + PDF generieren",
      done: stepProgress.pdfGenerationStarted,
    },
    {
      id: "mail",
      label: "Mailentwurf absenden",
      done: stepProgress.mailDraftStarted,
    },
  ] as const;
  const completedProgressSteps = progressSteps.filter((step) => step.done).length;
  const progressPercent = Math.round(
    (completedProgressSteps / progressSteps.length) * 100,
  );
  const activeProgressIndex =
    completedProgressSteps === 0 ||
    completedProgressSteps === progressSteps.length
      ? -1
      : progressSteps.findIndex((step) => !step.done);
  const progressToneClass =
    completedProgressSteps === 0
      ? "stepProgressFillStart"
      : completedProgressSteps === progressSteps.length
        ? "stepProgressFillDone"
        : "stepProgressFillMiddle";

  function applyModeSnapshot(snapshot: ModeSnapshot) {
    setForm({ ...snapshot.form });
    setSelectedServices(cloneSelectedServices(snapshot.selectedServices));
    setVoiceTranscript(snapshot.voiceTranscript);
    setVoiceInfo(snapshot.voiceInfo);
    setVoiceError(snapshot.voiceError);
    setVoiceMissingFields([...snapshot.voiceMissingFields]);
    setStepProgress(cloneStepProgress(snapshot.stepProgress));
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

  function storeCurrentModeSnapshot(mode: DocumentMode) {
    modeSnapshotsRef.current[mode] = {
      form: { ...form },
      selectedServices: cloneSelectedServices(selectedServices),
      voiceTranscript,
      voiceInfo,
      voiceError,
      voiceMissingFields: [...voiceMissingFields],
      stepProgress: cloneStepProgress(stepProgress),
      error,
      postActionInfo,
      serviceSearch,
      isServiceSearchOpen,
      serviceInfo,
      serviceError,
      addressSuggestions: addressSuggestions.map((suggestion) => ({ ...suggestion })),
    };
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

    setDocumentMode(nextMode);
    setModeAnimationKey((value) => value + 1);
  }

  useEffect(() => {
    const speechCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(speechCtor));

    return () => {
      if (recognitionRef.current) {
        shouldAutoApplyVoiceRef.current = false;
        pauseRequestedRef.current = false;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
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
    if (stepProgress.customerDataStarted) {
      return;
    }

    const formTouched = [
      form.companyName,
      form.firstName,
      form.lastName,
      form.street,
      form.postalCode,
      form.city,
      form.customerEmail,
      form.serviceDescription,
      form.hours,
      form.hourlyRate,
      form.materialCost,
    ].some((value) => value.trim().length > 0);

    if (formTouched || selectedServices.length > 0) {
      setStepProgress((prev) => ({ ...prev, customerDataStarted: true }));
    }
  }, [form, selectedServices.length, stepProgress.customerDataStarted]);

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
        setVoiceInfo(
          "Aufnahme beendet. Sprich bitte etwas länger oder ergänze den Text manuell.",
        );
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
    if (cleaned.length < 3 || cleaned.length > 140) {
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
    setStepProgress((prev) =>
      prev.mailDraftStarted ? prev : { ...prev, mailDraftStarted: true },
    );
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

    setStepProgress((prev) =>
      prev.pdfGenerationStarted
        ? prev
        : { ...prev, pdfGenerationStarted: true },
    );
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
        <div className="documentModeSwitchTop">
          <div className="documentModeSwitch" role="group" aria-label="Modus auswählen">
            <button
              type="button"
              className={`documentModeSwitchButton ${documentMode === "offer" ? "active" : ""}`}
              onClick={() => switchDocumentMode("offer")}
            >
              Angebote
            </button>
            <button
              type="button"
              className={`documentModeSwitchButton ${documentMode === "invoice" ? "active" : ""}`}
              onClick={() => switchDocumentMode("invoice")}
            >
              Rechnungen
            </button>
          </div>
        </div>

        <header className="topBar glassCard">
          <div className="topBarBrand">
            <div className="topBarHeadingRow">
              <span className="pill">Visioro</span>
              <h1 className="topBarTitle">{modeTitle}</h1>
            </div>
          </div>
          <Link href="/settings" className="ghostButton topBarButton">
            Einstellungen
          </Link>
        </header>

        <div key={`${documentMode}-${modeAnimationKey}`} className="documentModeContent">
          <section className="hero glassCard compactHero">
            <div className="stepProgressCompact" role="status" aria-live="polite">
              <div className="stepProgressTrack" aria-hidden>
                <div
                  className={`stepProgressFill ${progressToneClass}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="stepRow">
                {progressSteps.map((step, index) => {
                  const stepStateClass = step.done
                    ? "stepTileDone"
                    : index === activeProgressIndex
                      ? "stepTileActive"
                      : "stepTilePending";

                  return (
                    <article key={step.id} className={`stepTile ${stepStateClass}`}>
                      <span>{step.done ? "✓" : String(index + 1)}</span>
                      <strong>{step.label}</strong>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="workspaceGrid workspaceGridSingle">
          <article className="glassCard formCard">
            <header className="sectionHeader">
              <h2>{`Daten für ${singularDocumentLabel === "Angebot" ? "das Angebot" : "die Rechnung"}`}</h2>
              <p>
                {`Hier triffst du alle Angaben, die dein Kunde in ${singularDocumentLabel === "Angebot" ? "deinem Angebot" : "deiner Rechnung"} sehen soll.`}
              </p>
            </header>

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
                          <button
                            key={customer.customerNumber}
                            type="button"
                            className="customerPickerItem"
                            onClick={() => applyStoredCustomer(customer)}
                            role="listitem"
                          >
                            <div className="customerPickerItemHeader">
                              <strong>{customer.customerName}</strong>
                              <span>{customer.customerNumber}</span>
                            </div>
                            <p>{customer.customerAddress}</p>
                            <p>{customer.customerEmail}</p>
                          </button>
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
                    Sprich frei alle Daten ein, danach werden die Felder
                    automatisch befüllt.
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

                <label className="field">
                  <span>Gesprochener Text</span>
                  <textarea
                    rows={4}
                    value={voiceTranscript}
                    onChange={(e) => {
                      setVoiceTranscript(e.target.value);
                      setVoiceMissingFields([]);
                    }}
                    placeholder="Beispiel: Firma Schmidt GmbH, Ansprechpartner Herr Müller, Musterstraße 5, 10115 Berlin, ..."
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
                  <label className="field">
                    <span>Rechnungsdatum</span>
                    <input
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
                  </label>

                  <label className="field">
                    <span>Leistungszeitraum</span>
                    <input
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

                  <label className="field">
                    <span>Zahlungsziel (Tage)</span>
                    <input
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
                  rows={4}
                  placeholder="z. B. inkl. Verlegung von 60x60 Feinsteinzeugfliesen"
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

              <p className="formHint span2">
                Tipp: Die Spalten der PDF-Tabelle kannst du in den{" "}
                <Link href="/settings" className="formHintLink">
                  Einstellungen
                </Link>{" "}
                unter „PDF-Tabellenspalten“ anpassen.
              </p>
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
