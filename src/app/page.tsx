"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getSeedServices, hasServiceLabel, normalizeSearchValue, searchServices } from "@/lib/service-catalog";
import { OfferPositionInput, ServiceCatalogItem } from "@/types/offer";

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
};

type ServicesApiResponse = {
  services?: ServiceCatalogItem[];
  error?: string;
};

type ParsedVoiceFields = {
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

type VoiceParseResponse = {
  fields: ParsedVoiceFields;
  missingFields: string[];
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
};

const initialForm: OfferForm = {
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
  materialCost: ""
};

type StepProgress = {
  customerDataStarted: boolean;
  pdfGenerationStarted: boolean;
  mailDraftStarted: boolean;
};

const initialStepProgress: StepProgress = {
  customerDataStarted: false,
  pdfGenerationStarted: false,
  mailDraftStarted: false
};

const UNIT_OPTIONS = [
  "Stück",
  "m",
  "m²",
  "m³",
  "kg",
  "t",
  "l",
  "Stunde",
  "Tag",
  "Pauschal"
];

const MAIN_SERVICE_SUBITEM_SUGGESTIONS: Array<{ match: string; suggestions: string[] }> = [
  { match: "betonarbeiten", suggestions: ["Beton liefern", "Schalung herstellen", "Bewehrung einbauen", "Abdichtung", "Entsorgung"] },
  { match: "fliesen", suggestions: ["Untergrund vorbereiten", "Fliesen verlegen", "Fugen ausführen", "Sockelleisten setzen", "Material entsorgen"] },
  { match: "elektro", suggestions: ["Kabel verlegen", "Steckdosen montieren", "Schalter montieren", "Leuchten anschließen", "Prüfung / Messung"] },
  { match: "sanitär", suggestions: ["Leitungen verlegen", "Armaturen montieren", "Waschbecken montieren", "Dichtheitsprüfung", "Funktionsprüfung"] },
  { match: "trockenbau", suggestions: ["Unterkonstruktion montieren", "Beplankung anbringen", "Dämmung einbringen", "Spachteln", "Schleifen"] },
  { match: "maler", suggestions: ["Untergrund abdecken", "Spachtelarbeiten", "Grundierung", "Anstrich", "Nachreinigung"] }
];

function createSubitemEntry(description = ""): ServiceSubitemEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description,
    quantity: "",
    unit: UNIT_OPTIONS[0],
    price: ""
  };
}

function createSelectedServiceEntry(label: string): SelectedServiceEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    subitems: [createSubitemEntry()]
  };
}

function selectedServiceToRequestValue(service: SelectedServiceEntry): string {
  return service.label.trim();
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

function formatEuroValue(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function calculateSubitemTotal(subitem: ServiceSubitemEntry): number {
  const quantity = parseLocaleNumber(subitem.quantity);
  const price = parseLocaleNumber(subitem.price);
  if (!Number.isFinite(quantity) || !Number.isFinite(price)) {
    return 0;
  }

  return quantity * price;
}

function subitemToPreviewText(subitem: ServiceSubitemEntry): string {
  const description = subitem.description.trim();
  if (!description) {
    return "";
  }

  const quantity = parseLocaleNumber(subitem.quantity);
  const unit = getSubitemUnit(subitem);
  const price = parseLocaleNumber(subitem.price);
  const total = Number.isFinite(quantity) && Number.isFinite(price) ? quantity * price : NaN;

  if (Number.isFinite(quantity) && Number.isFinite(price)) {
    return `${description} - ${quantity} ${unit} - ${formatEuroValue(price)} EUR - ${formatEuroValue(total)} EUR`;
  }

  if (Number.isFinite(quantity)) {
    return `${description} - ${quantity} ${unit}`;
  }

  return description;
}

function getSubitemSuggestionsForService(serviceLabel: string): string[] {
  const normalizedLabel = normalizeSearchValue(serviceLabel);
  if (!normalizedLabel) {
    return [];
  }

  const matched = MAIN_SERVICE_SUBITEM_SUGGESTIONS.find((entry) => normalizedLabel.includes(entry.match));
  return matched?.suggestions ?? [];
}

function normalizeAddressSuggestion(item: NominatimItem): AddressSuggestion | null {
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
  const secondary = [postalCode, city].filter(Boolean).join(" ").trim() || item.display_name?.trim() || "";

  return {
    street,
    postalCode,
    city,
    primary,
    secondary
  };
}

export default function HomePage() {
  const [form, setForm] = useState<OfferForm>(initialForm);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [postActionInfo, setPostActionInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [isAddressLoading, setIsAddressLoading] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isParsingVoice, setIsParsingVoice] = useState(false);
  const [voiceInfo, setVoiceInfo] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [isHeroExpanded, setIsHeroExpanded] = useState(false);
  const [stepProgress, setStepProgress] = useState<StepProgress>(initialStepProgress);
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>(getSeedServices());
  const [serviceSearch, setServiceSearch] = useState("");
  const [selectedServices, setSelectedServices] = useState<SelectedServiceEntry[]>([]);
  const [isServiceSearchOpen, setIsServiceSearchOpen] = useState(false);
  const [isServiceCatalogLoading, setIsServiceCatalogLoading] = useState(false);
  const [isAddingCustomService, setIsAddingCustomService] = useState(false);
  const [serviceInfo, setServiceInfo] = useState("");
  const [serviceError, setServiceError] = useState("");
  const recognitionRef = useRef<any>(null);
  const servicePickerRef = useRef<HTMLDivElement | null>(null);
  const finalTranscriptRef = useRef("");

  const personDisplayName = `${form.firstName} ${form.lastName}`.trim();
  const customerDisplayName =
    form.customerType === "company"
      ? form.companyName.trim() || "Firmenname"
      : personDisplayName || "Vorname Nachname";
  const attentionLine =
    form.customerType === "company" && personDisplayName
      ? `z. Hd. ${form.salutation === "frau" ? "Frau" : "Herr"} ${personDisplayName}`
      : "";
  const hoursNumber = Number(form.hours || 0);
  const hourlyRateNumber = Number(form.hourlyRate || 0);
  const subitemsTotal = useMemo(
    () =>
      selectedServices.reduce((serviceSum, service) => {
        const subitemsSum = service.subitems.reduce((sum, subitem) => sum + calculateSubitemTotal(subitem), 0);
        return serviceSum + subitemsSum;
      }, 0),
    [selectedServices]
  );
  const laborTotal = hoursNumber * hourlyRateNumber;
  const liveTotal = subitemsTotal > 0 ? subitemsTotal : laborTotal;
  const serviceSearchValue = serviceSearch.trim();
  const serviceSuggestions = useMemo(
    () => searchServices(serviceCatalog, serviceSearchValue, 14),
    [serviceCatalog, serviceSearchValue]
  );
  const canCreateCustomService =
    serviceSearchValue.length >= 2 && !hasServiceLabel(serviceCatalog, serviceSearchValue);
  const groupedServiceSuggestions = useMemo(() => {
    const grouped = new Map<string, ServiceCatalogItem[]>();

    for (const suggestion of serviceSuggestions) {
      const services = grouped.get(suggestion.category) ?? [];
      services.push(suggestion);
      grouped.set(suggestion.category, services);
    }

    return Array.from(grouped.entries());
  }, [serviceSuggestions]);
  const serviceSummaryText = useMemo(() => {
    const selectedText = selectedServices
      .map((service) => {
        const subitemsText = service.subitems
          .map(subitemToPreviewText)
          .filter(Boolean)
          .join(", ");

        if (subitemsText) {
          return `${service.label}: ${subitemsText}`;
        }

        return selectedServiceToRequestValue(service);
      })
      .filter(Boolean)
      .join(" • ");
    const detailText = form.serviceDescription.trim();

    if (selectedText && detailText) {
      return `${selectedText} - ${detailText}`;
    }

    return selectedText || detailText || "";
  }, [selectedServices, form.serviceDescription]);

  useEffect(() => {
    const speechCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(speechCtor));

    return () => {
      if (recognitionRef.current) {
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
            setServiceError(data.error ?? "Leistungen konnten nicht geladen werden.");
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
      form.hourlyRate
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

    const searchText = [street, form.postalCode.trim(), form.city.trim()].filter(Boolean).join(" ");
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsAddressLoading(true);

      try {
        const params = new URLSearchParams({
          format: "jsonv2",
          addressdetails: "1",
          limit: "5",
          countrycodes: "de,at,ch",
          q: searchText
        });

        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          signal: controller.signal,
          headers: {
            "Accept-Language": "de"
          }
        });

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
                  entry.primary === item.primary
              ) === index
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
      street: suggestion.street || prev.street,
      postalCode: suggestion.postalCode || prev.postalCode,
      city: suggestion.city || prev.city
    }));
    setAddressSuggestions([]);
  }

  function addSelectedService(serviceLabel: string) {
    const trimmed = serviceLabel.trim();
    if (!trimmed) {
      return;
    }

    setSelectedServices((prev) => {
      const key = normalizeSearchValue(trimmed);
      if (prev.some((service) => normalizeSearchValue(service.label) === key)) {
        return prev;
      }

      return [...prev, createSelectedServiceEntry(trimmed)];
    });
    setForm((prev) => ({
      ...prev,
      serviceDescription: prev.serviceDescription.trim() ? prev.serviceDescription : trimmed
    }));
    setServiceSearch("");
    setIsServiceSearchOpen(false);
    setServiceError("");
  }

  function removeSelectedService(serviceId: string) {
    setSelectedServices((prev) => prev.filter((service) => service.id !== serviceId));
  }

  function addServiceSubitem(serviceId: string, description = "") {
    setSelectedServices((prev) =>
      prev.map((service) =>
        service.id === serviceId ? { ...service, subitems: [...service.subitems, createSubitemEntry(description)] } : service
      )
    );
  }

  function updateServiceSubitem(
    serviceId: string,
    subitemId: string,
    field: "description" | "quantity" | "unit" | "price",
    value: string
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
                unit: value
              };
            }

            if (field === "description") {
              return {
                ...subitem,
                description: value
              };
            }

            if (field === "quantity") {
              return {
                ...subitem,
                quantity: value
              };
            }

            return {
              ...subitem,
              price: value
            };
          })
        };
      })
    );
  }

  function removeServiceSubitem(serviceId: string, subitemId: string) {
    setSelectedServices((prev) =>
      prev.map((service) => {
        if (service.id !== serviceId) {
          return service;
        }

        const nextSubitems = service.subitems.filter((subitem) => subitem.id !== subitemId);
        return {
          ...service,
          subitems: nextSubitems.length > 0 ? nextSubitems : [createSubitemEntry()]
        };
      })
    );
  }

  function addSuggestedSubitem(serviceId: string, suggestion: string) {
    const normalizedSuggestion = normalizeSearchValue(suggestion);

    setSelectedServices((prev) =>
      prev.map((service) => {
        if (service.id !== serviceId) {
          return service;
        }

        const hasSuggestion = service.subitems.some(
          (subitem) => normalizeSearchValue(subitem.description) === normalizedSuggestion
        );
        if (hasSuggestion) {
          return service;
        }

        if (service.subitems.length === 1) {
          const first = service.subitems[0];
          const firstIsEmpty = !first.description.trim() && !first.quantity.trim() && !first.price.trim();

          if (firstIsEmpty) {
            return {
              ...service,
              subitems: [{ ...first, description: suggestion }]
            };
          }
        }

        return {
          ...service,
          subitems: [...service.subitems, createSubitemEntry(suggestion)]
        };
      })
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
        body: JSON.stringify({ label })
      });
      const data = (await response.json()) as ServicesApiResponse & {
        customService?: { label?: string };
      };

      if (!response.ok) {
        setServiceError(data.error ?? "Eigene Leistung konnte nicht gespeichert werden.");
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

    const speechCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!speechCtor) {
      setVoiceError("Spracherkennung wird auf diesem Gerät/Browser nicht unterstützt.");
      return;
    }

    setVoiceError("");
    setVoiceInfo("Sprich jetzt. Du kannst frei alle Angebotsdaten diktieren.");
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
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
        } else {
          interimTranscript += text;
        }
      }
      setVoiceTranscript(`${finalTranscriptRef.current} ${interimTranscript}`.trim());
    };

    recognition.onerror = (event: any) => {
      const code = String(event.error ?? "");
      if (code === "not-allowed" || code === "service-not-allowed") {
        setVoiceError("Mikrofonzugriff wurde blockiert. Bitte Zugriff im Browser erlauben.");
      } else if (code === "no-speech") {
        setVoiceError("Keine Sprache erkannt. Bitte erneut sprechen.");
      } else {
        setVoiceError("Spracherkennung fehlgeschlagen. Bitte erneut versuchen.");
      }
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceInfo("Aufnahme beendet. Klicke auf 'In Felder übernehmen'.");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceError("Aufnahme konnte nicht gestartet werden. Bitte erneut versuchen.");
      setVoiceInfo("");
    }
  }

  function stopSpeechInput() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setVoiceInfo("Aufnahme wird beendet ...");
    }
  }

  function numberToInput(value: number | undefined): string | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }
    return String(value);
  }

  function sanitizeServiceDescription(value: string | undefined, transcript: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const cleaned = value.trim();
    if (cleaned.length < 3 || cleaned.length > 140) {
      return undefined;
    }

    const normalizedValue = cleaned.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedTranscript = transcript.toLowerCase().replace(/\s+/g, " ").trim();
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

  async function applyVoiceTranscript() {
    if (isListening) {
      stopSpeechInput();
    }

    const transcript = voiceTranscript.trim();
    if (transcript.length < 8) {
      setVoiceError("Bitte etwas länger sprechen, damit die KI genug Daten hat.");
      return;
    }

    setIsParsingVoice(true);
    setVoiceError("");

    try {
      const response = await fetch("/api/parse-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript })
      });
      const data = (await response.json()) as VoiceParseResponse & { error?: string };
      if (!response.ok) {
        setVoiceError(data.error ?? "Sprachdaten konnten nicht verarbeitet werden.");
        return;
      }

      const fields = data.fields;
      const safeServiceDescription = sanitizeServiceDescription(fields.serviceDescription, transcript);
      const applyConservativeFallback = data.usedFallback;
      setForm((prev) => ({
        ...prev,
        customerType: fields.customerType ?? prev.customerType,
        companyName: fields.companyName ?? prev.companyName,
        salutation: fields.salutation ?? prev.salutation,
        firstName: applyConservativeFallback ? prev.firstName : fields.firstName ?? prev.firstName,
        lastName: applyConservativeFallback ? prev.lastName : fields.lastName ?? prev.lastName,
        street: fields.street ?? prev.street,
        postalCode: fields.postalCode ?? prev.postalCode,
        city: fields.city ?? prev.city,
        customerEmail: fields.customerEmail ?? prev.customerEmail,
        serviceDescription: applyConservativeFallback ? prev.serviceDescription : safeServiceDescription ?? prev.serviceDescription,
        hours: numberToInput(fields.hours) ?? prev.hours,
        hourlyRate: numberToInput(fields.hourlyRate) ?? prev.hourlyRate,
        materialCost: numberToInput(fields.materialCost) ?? prev.materialCost
      }));

      const missingText =
        data.missingFields.length > 0
          ? ` Bitte noch ergänzen: ${data.missingFields.join(", ")}.`
          : " Alle Kernfelder wurden erkannt.";
      const modeText = data.usedFallback ? "Sprachdaten übernommen." : "Sprachtext per KI übernommen.";
      setVoiceInfo(`${modeText}${missingText}`);
      setVoiceError("");
      setAddressSuggestions([]);
    } catch {
      setVoiceError("Netzwerkfehler bei der Sprachverarbeitung.");
    } finally {
      setIsParsingVoice(false);
    }
  }

  function createPdfFile(pdfBase64: string) {
    const binary = atob(pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], "angebot.pdf", { type: "application/pdf" });
  }

  function downloadPdfFile(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function openMailDraftWithOffer(payload: ApiResponse) {
    const mailText = payload.mailText;
    const file = createPdfFile(payload.pdfBase64);
    setStepProgress((prev) => (prev.mailDraftStarted ? prev : { ...prev, mailDraftStarted: true }));

    if (typeof navigator !== "undefined" && "canShare" in navigator && "share" in navigator) {
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            title: payload.offer.subject,
            text: mailText,
            files: [file]
          });
          return "Mail-Entwurf über den Teilen-Dialog geöffnet.";
        } catch {
          // Ignore and fallback to mailto + download.
        }
      }
    }

    const mailtoUrl =
      `mailto:${encodeURIComponent(form.customerEmail)}` +
      `?subject=${encodeURIComponent(payload.offer.subject)}` +
      `&body=${encodeURIComponent(mailText)}`;

    window.location.href = mailtoUrl;
    downloadPdfFile(file);
    return "Mailfenster geöffnet. PDF wurde heruntergeladen und kann direkt angehängt werden.";
  }

  function buildValidatedPositions(services: SelectedServiceEntry[]): { positions: OfferPositionInput[]; errorMessage: string } {
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
            errorMessage: `Bitte Unterpunkt-Bezeichnung für "${service.label}" ausfüllen.`
          };
        }

        const quantity = parseLocaleNumber(quantityRaw);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return {
            positions: [],
            errorMessage: `Bitte eine gültige Menge für "${description}" eingeben.`
          };
        }

        if (!priceRaw) {
          return {
            positions: [],
            errorMessage: `EP / Preis EUR ist für "${description}" verpflichtend.`
          };
        }

        const price = parseLocaleNumber(priceRaw);
        if (!Number.isFinite(price) || price < 0) {
          return {
            positions: [],
            errorMessage: `Bitte einen gültigen EP / Preis EUR für "${description}" eingeben.`
          };
        }

        positions.push({
          group: service.label.trim(),
          description: `- ${description}`,
          quantity: String(quantity),
          unit: getSubitemUnit(subitem),
          unitPrice: String(price)
        });
      }
    }

    if (services.length > 0 && positions.length === 0) {
      return {
        positions: [],
        errorMessage: "Bitte mindestens einen Unterpunkt mit Menge und EP / Preis EUR erfassen."
      };
    }

    return {
      positions,
      errorMessage: ""
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setPostActionInfo("");

    const selectedServicesPayload = selectedServices
      .map(selectedServiceToRequestValue)
      .filter((value) => value.length > 0);
    const { positions: positionsPayload, errorMessage } = buildValidatedPositions(selectedServices);

    if (errorMessage) {
      setError(errorMessage);
      return;
    }

    if (!form.serviceDescription.trim() && selectedServicesPayload.length === 0 && positionsPayload.length === 0) {
      setError("Bitte mindestens eine Leistung auswählen oder eine Projektbeschreibung eingeben.");
      return;
    }

    setStepProgress((prev) =>
      prev.pdfGenerationStarted ? prev : { ...prev, pdfGenerationStarted: true }
    );
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/generate-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          selectedServices: selectedServicesPayload,
          positions: positionsPayload,
          sendEmail: false
        })
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Unbekannter Fehler");
        return;
      }

      const payload = data as ApiResponse;
      setResult(payload);
      const info = await openMailDraftWithOffer(payload);
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
        <header className="topBar glassCard">
          <div className="topBarBrand">
            <span className="pill">Visioro</span>
            <strong>Angebote für Handwerker</strong>
          </div>
          <Link href="/settings" className="ghostButton topBarButton">
            Einstellungen
          </Link>
        </header>

        <div className="heroDisclosure">
          <button
            type="button"
            className="heroQuestionButton"
            aria-expanded={isHeroExpanded}
            aria-controls="hero-info-panel"
            onClick={() => setIsHeroExpanded((prev) => !prev)}
            title="Info zur Angebots-Erstellung anzeigen"
          >
            ?
          </button>

          <section
            id="hero-info-panel"
            className={`hero glassCard heroExpandable ${isHeroExpanded ? "heroExpandableOpen" : ""}`}
            aria-hidden={!isHeroExpanded}
          >
            <p className="heroEyebrow">Visioro</p>
            <h1>Angebote in Sekunden statt in Stunden</h1>
            <p className="heroText">
              Du gibst Kundendaten und Leistung ein, Visioro erstellt den Text, baut ein sauberes PDF und öffnet
              direkt deinen Mail-Entwurf.
            </p>
            <div className="stepRow">
              <article className={`stepTile ${stepProgress.customerDataStarted ? "stepTileDone" : ""}`}>
                <span>{stepProgress.customerDataStarted ? "✓" : "1"}</span>
                <strong>Kundendaten erfassen</strong>
              </article>
              <article className={`stepTile ${stepProgress.pdfGenerationStarted ? "stepTileDone" : ""}`}>
                <span>{stepProgress.pdfGenerationStarted ? "✓" : "2"}</span>
                <strong>Text + PDF generieren</strong>
              </article>
              <article className={`stepTile ${stepProgress.mailDraftStarted ? "stepTileDone" : ""}`}>
                <span>{stepProgress.mailDraftStarted ? "✓" : "3"}</span>
                <strong>Mail-Entwurf absenden</strong>
              </article>
            </div>
          </section>
        </div>

        <section className="workspaceGrid">
          <article className="glassCard formCard">
            <header className="sectionHeader">
              <h2>Daten für das Angebot</h2>
              <p>Hier triffst du alle Angaben, die dein Kunde im Angebot sehen soll.</p>
            </header>

            <form onSubmit={onSubmit} className="formGrid">
              <div className="voicePanel span2">
                <div className="voicePanelHeader">
                  <strong>Per Sprache ausfüllen</strong>
                  <p>Sprich frei alle Daten ein, danach werden die Felder automatisch befüllt.</p>
                </div>

                <div className="voiceActions">
                  <button
                    type="button"
                    className={`ghostButton voiceActionButton ${isListening ? "voiceActionButtonStop" : "voiceActionButtonStart"}`}
                    onClick={isListening ? stopSpeechInput : startSpeechInput}
                    disabled={!speechSupported || isParsingVoice}
                  >
                    {isListening ? "Aufnahme stoppen" : "Aufnahme starten"}
                  </button>
                  <button
                    type="button"
                    className="ghostButton voiceActionButton"
                    onClick={applyVoiceTranscript}
                    disabled={isParsingVoice || !voiceTranscript.trim()}
                  >
                    {isParsingVoice ? "Übernehme Felder ..." : "In Felder übernehmen"}
                  </button>
                </div>

                <label className="field">
                  <span>Gesprochener Text</span>
                  <textarea
                    rows={4}
                    value={voiceTranscript}
                    onChange={(e) => setVoiceTranscript(e.target.value)}
                    placeholder="Beispiel: Firma Schmidt GmbH, Ansprechpartner Herr Müller, Musterstraße 5, 10115 Berlin, ..."
                  />
                </label>

                {!speechSupported ? <p className="voiceWarning">Spracherkennung wird auf diesem Browser nicht unterstützt.</p> : null}
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
              </div>

              <div className="recipientType span2" role="group" aria-label="Kundenart">
                <span>Kundenart</span>
                <div className="recipientTypeButtons">
                  <button
                    type="button"
                    className={`recipientTypeButton ${form.customerType === "person" ? "active" : ""}`}
                    onClick={() => setForm((prev) => ({ ...prev, customerType: "person" }))}
                  >
                    Privatperson
                  </button>
                  <button
                    type="button"
                    className={`recipientTypeButton ${form.customerType === "company" ? "active" : ""}`}
                    onClick={() => setForm((prev) => ({ ...prev, customerType: "company" }))}
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
                    value={form.companyName}
                    onChange={(e) => setForm((prev) => ({ ...prev, companyName: e.target.value }))}
                  />
                </label>
              ) : null}

              <label className="field span2">
                <span>{form.customerType === "company" ? "Anrede Ansprechpartner (optional)" : "Anrede"}</span>
                <select
                  required={form.customerType === "person"}
                  value={form.salutation}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      salutation: e.target.value === "frau" ? "frau" : "herr"
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
                  value={form.firstName}
                  onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Nachname</span>
                <input
                  required={form.customerType === "person"}
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                />
              </label>

              <label className="field span2">
                <span>Straße und Hausnummer</span>
                <div className="addressAutocomplete">
                  <input
                    required
                    autoComplete="address-line1"
                    value={form.street}
                    onChange={(e) => setForm((prev) => ({ ...prev, street: e.target.value }))}
                  />
                  {(isAddressLoading || addressSuggestions.length > 0) && (
                    <div className="addressSuggestions" role="listbox" aria-label="Adressvorschläge">
                      {isAddressLoading ? <p className="addressHint">Suche Adressen ...</p> : null}
                      {addressSuggestions.map((suggestion, index) => (
                        <button
                          key={`${suggestion.primary}-${suggestion.secondary}-${index}`}
                          type="button"
                          className="addressSuggestionButton"
                          onClick={() => applyAddressSuggestion(suggestion)}
                        >
                          <strong>{suggestion.primary}</strong>
                          {suggestion.secondary ? <span>{suggestion.secondary}</span> : null}
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
                  value={form.postalCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, postalCode: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Ort</span>
                <input
                  required
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                />
              </label>

              <label className="field">
                <span>Kunden-E-Mail</span>
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={form.customerEmail}
                  onChange={(e) => setForm((prev) => ({ ...prev, customerEmail: e.target.value }))}
                />
              </label>

              <div className="field span2">
                <span>Leistungen auswählen</span>
                <div className="servicePicker" ref={servicePickerRef}>
                  <input
                    value={serviceSearch}
                    placeholder="Leistung suchen (z. B. Fliesenarbeiten, Erdarbeiten, Wartung)"
                    onFocus={() => setIsServiceSearchOpen(true)}
                    onChange={(event) => {
                      setServiceSearch(event.target.value);
                      setIsServiceSearchOpen(true);
                      setServiceInfo("");
                      setServiceError("");
                    }}
                  />

                  {isServiceSearchOpen ? (
                    <div className="serviceSuggestionList" role="listbox" aria-label="Leistungsvorschläge">
                      {isServiceCatalogLoading ? <p className="serviceSuggestionHint">Leistungen werden geladen ...</p> : null}

                      {groupedServiceSuggestions.map(([category, suggestions]) => (
                        <div key={category} className="serviceSuggestionGroup">
                          <p className="serviceSuggestionGroupLabel">{category}</p>
                          {suggestions.map((service) => (
                            <button
                              key={service.id}
                              type="button"
                              className="serviceSuggestionButton"
                              onClick={() => addSelectedService(service.label)}
                            >
                              <strong>{service.label}</strong>
                              {service.source === "custom" ? <span>Eigene Leistung</span> : <span>Standard</span>}
                            </button>
                          ))}
                        </div>
                      ))}

                      {!isServiceCatalogLoading && groupedServiceSuggestions.length === 0 ? (
                        <p className="serviceSuggestionHint">Keine passenden Leistungen gefunden.</p>
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

                <div className="selectedServiceList">
                  {selectedServices.length === 0 ? (
                    <p className="selectedServiceHint">Noch keine Leistung ausgewählt.</p>
                  ) : (
                    selectedServices.map((service) => {
                      const subitemSuggestions = getSubitemSuggestionsForService(service.label);

                      return (
                        <div key={service.id} className="selectedServiceCard">
                          <div className="selectedServiceHeader">
                            <strong className="selectedServiceLabel">{service.label}</strong>
                            <button
                              type="button"
                              className="selectedServiceRemoveButton"
                              onClick={() => removeSelectedService(service.id)}
                              aria-label={`${service.label} entfernen`}
                            >
                              ×
                            </button>
                          </div>

                          {subitemSuggestions.length > 0 ? (
                            <div className="selectedServiceSuggestionRow">
                              {subitemSuggestions.map((suggestion) => (
                                <button
                                  key={`${service.id}-${suggestion}`}
                                  type="button"
                                  className="selectedServiceSuggestionButton"
                                  onClick={() => addSuggestedSubitem(service.id, suggestion)}
                                >
                                  + {suggestion}
                                </button>
                              ))}
                            </div>
                          ) : null}

                          <div className="selectedSubitemTable">
                            <div className="selectedSubitemTableHead" aria-hidden>
                              <span>Unterpunkt</span>
                              <span>Menge</span>
                              <span>Einheit</span>
                              <span>EP / Preis EUR*</span>
                              <span>Gesamtpreis EUR</span>
                              <span />
                            </div>

                            <div className="selectedSubitemList">
                              {service.subitems.map((subitem, index) => {
                                const subitemTotal = calculateSubitemTotal(subitem);

                                return (
                                  <div key={subitem.id} className="selectedSubitemRow">
                                    <div className="selectedSubitemCell">
                                      <input
                                        className="selectedSubitemDescriptionInput"
                                        value={subitem.description}
                                        onChange={(event) =>
                                          updateServiceSubitem(service.id, subitem.id, "description", event.target.value)
                                        }
                                        placeholder={index === 0 ? "Unterpunkt (z. B. Beton liefern)" : "Weiterer Unterpunkt"}
                                        aria-label={`Unterpunkt für ${service.label}`}
                                      />
                                    </div>
                                    <div className="selectedSubitemCell">
                                      <input
                                        className="selectedSubitemQuantityInput"
                                        value={subitem.quantity}
                                        onChange={(event) =>
                                          updateServiceSubitem(service.id, subitem.id, "quantity", event.target.value)
                                        }
                                        placeholder="0"
                                        inputMode="decimal"
                                        aria-label={`Menge für ${service.label}`}
                                      />
                                    </div>
                                    <div className="selectedSubitemCell">
                                      <select
                                        className="selectedSubitemUnitSelect"
                                        value={subitem.unit}
                                        onChange={(event) =>
                                          updateServiceSubitem(service.id, subitem.id, "unit", event.target.value)
                                        }
                                        aria-label={`Einheit für ${service.label}`}
                                      >
                                        {UNIT_OPTIONS.map((unitOption) => (
                                          <option key={unitOption} value={unitOption}>
                                            {unitOption}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="selectedSubitemCell">
                                      <input
                                        className="selectedSubitemPriceInput"
                                        value={subitem.price}
                                        onChange={(event) =>
                                          updateServiceSubitem(service.id, subitem.id, "price", event.target.value)
                                        }
                                        placeholder="0,00"
                                        inputMode="decimal"
                                        aria-label={`EP / Preis EUR für ${service.label}`}
                                      />
                                    </div>
                                    <div className="selectedSubitemCell">
                                      <input
                                        className="selectedSubitemTotalInput"
                                        value={formatEuroValue(subitemTotal)}
                                        readOnly
                                        aria-label={`Gesamtpreis EUR für ${service.label}`}
                                      />
                                    </div>
                                    <div className="selectedSubitemCell selectedSubitemCellAction">
                                      <button
                                        type="button"
                                        className="selectedSubitemRemoveButton"
                                        onClick={() => removeServiceSubitem(service.id, subitem.id)}
                                        aria-label={`Unterpunkt ${index + 1} für ${service.label} löschen`}
                                      >
                                        Löschen
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <button
                            type="button"
                            className="selectedServiceAddSubitemButton"
                            onClick={() => addServiceSubitem(service.id)}
                          >
                            + Unterpunkt hinzufügen
                          </button>
                        </div>
                      );
                    })
                  )}
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
                  rows={4}
                  placeholder="z. B. inkl. Verlegung von 60x60 Feinsteinzeugfliesen"
                  value={form.serviceDescription}
                  onChange={(e) => setForm((prev) => ({ ...prev, serviceDescription: e.target.value }))}
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
                  onChange={(e) => setForm((prev) => ({ ...prev, hours: e.target.value }))}
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
                  onChange={(e) => setForm((prev) => ({ ...prev, hourlyRate: e.target.value }))}
                />
              </label>

              <button className="primaryButton submitButton" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Angebot wird erstellt..." : "Angebot erstellen"}
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
          </article>

          <aside className="glassCard previewPanel">
            <header className="sectionHeader">
              <h2>Vorschau für deinen Kunden</h2>
              <p>So sieht die Angebots-E-Mail in etwa aus.</p>
            </header>

            <div className="previewAddress">
              <strong>{customerDisplayName}</strong>
              {attentionLine ? <span>{attentionLine}</span> : null}
              <span>{form.street || "Straße 1"}</span>
              <span>{`${form.postalCode || "12345"} ${form.city || "Stadt"}`}</span>
            </div>

            <div className="previewContact">
              <span>E-Mail</span>
              <strong>{form.customerEmail || "kunde@example.com"}</strong>
            </div>

            <div className="quoteSheet">
              <div className="quoteHeader">
                <span>Leistungsübersicht</span>
                <strong>{serviceSummaryText || "Leistung noch nicht angegeben"}</strong>
              </div>

              <div className="quoteRow">
                <span>Unterpunkte gesamt</span>
                <span>{formatEuroValue(subitemsTotal)} EUR</span>
              </div>
              {subitemsTotal <= 0 ? (
                <div className="quoteRow">
                  <span>Arbeitszeit (Fallback)</span>
                  <span>
                    {hoursNumber || 0} Std. x {hourlyRateNumber || 0} EUR
                  </span>
                </div>
              ) : null}
              <div className="quoteTotal">
                <span>Gesamtsumme</span>
                <strong>{`${formatEuroValue(Number.isFinite(liveTotal) ? liveTotal : 0)} EUR`}</strong>
              </div>

              <p className="quoteHint">Bei Klick auf den Button öffnet sich dein Mail-Entwurf zum finalen Senden.</p>
            </div>
          </aside>
        </section>

        {result ? (
          <section className="glassCard resultCard">
            <header className="sectionHeader">
              <h2>Ergebnis</h2>
              <p>Angebot wurde erstellt und als PDF bereitgestellt.</p>
            </header>

            <p>{postActionInfo || result.emailInfo}</p>

            <a
              className="primaryButton"
              href={`data:application/pdf;base64,${result.pdfBase64}`}
              download="angebot.pdf"
            >
              PDF herunterladen
            </a>

            <div className="offerText">
              <h3>Generierter Angebotstext</h3>
              <p>{result.offer.intro}</p>
              <p>{result.offer.details}</p>
              <p>{result.offer.closing}</p>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
