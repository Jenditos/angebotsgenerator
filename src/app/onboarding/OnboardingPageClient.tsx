"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatIbanForDisplay,
  normalizeBicInput,
  validateIbanInput,
} from "@/lib/iban";
import { MAIN_BANK_ACCOUNT_ID } from "@/lib/bank-accounts";
import {
  LOGO_ALLOWED_FORMATS_LABEL,
  LOGO_UPLOAD_ACCEPT_ATTRIBUTE,
  MAX_LOGO_DATA_URL_LENGTH,
  MAX_LOGO_RENDER_EDGE_PX,
  MAX_LOGO_UPLOAD_FILE_BYTES,
  MAX_LOGO_UPLOAD_FILE_MB,
  hasSupportedLogoExtension,
  isSupportedLogoMimeType,
  sanitizeCompanyLogoDataUrl,
} from "@/lib/logo-config";
import {
  ONBOARDING_SNOOZE_COOKIE_NAME,
  ONBOARDING_TOTAL_STEPS,
  clampOnboardingStep,
  hasCompletedOnboardingRequiredFields,
} from "@/lib/onboarding";
import { getDefaultPdfTableColumns } from "@/lib/pdf-table-config";
import { isValidEmailAddress } from "@/lib/user-input";
import { TradeMultiSelect } from "@/components/TradeMultiSelect";
import { CompanySettings } from "@/types/offer";

const KLEINUNTERNEHMER_NOTICE_DEFAULT =
  "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";
const LOGO_DOWNSCALE_FACTOR = 0.82;
const LOGO_MAX_DOWNSCALE_ATTEMPTS = 6;
const LOGO_JPEG_QUALITIES = [0.92, 0.86, 0.8, 0.74, 0.68];

const emptySettings: CompanySettings = {
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
  additionalBankAccounts: [],
  defaultBankAccountId: MAIN_BANK_ACCOUNT_ID,
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
  latePaymentInterestEnabled: false,
  latePaymentConsumerAnnualInterestPercent: 6.27,
  latePaymentBusinessAnnualInterestPercent: 10.27,
  latePaymentGraceDays: 0,
  offerTermsText:
    "Dieses Angebot basiert auf den aktuell gültigen Materialpreisen. Änderungen durch unvorhergesehene Baustellenbedingungen bleiben vorbehalten.",
  lastOfferNumber: "",
  lastInvoiceNumber: "",
  customServiceTypes: [],
};

const CREW_PREVIEW_CARDS = [
  {
    title: "Office-Assistenz",
    text: "sortiert Kunden, Termine und Entwürfe.",
    tone: "blue",
  },
  {
    title: "Nachfasser",
    text: "denkt an Angebote, bevor sie liegen bleiben.",
    tone: "amber",
  },
  {
    title: "Reputation",
    text: "bereitet Bewertungen nach Abschluss vor.",
    tone: "green",
  },
];

const LIFECYCLE_PREVIEW_ITEMS = [
  {
    label: "Tag 0",
    title: "Angebot geht raus",
    text: "Kunde, Leistungen und Nummer sind sauber vorbereitet.",
    tone: "blue",
  },
  {
    label: "Tag 3",
    title: "Nachfassen",
    text: "Wenn keine Antwort kommt, liegt die Erinnerung bereit.",
    tone: "amber",
  },
  {
    label: "Nach Abschluss",
    title: "Rechnung & Bewertung",
    text: "Aus dem Angebot wird eine Rechnung, danach folgt die Rezension.",
    tone: "green",
  },
];

const FINAL_CHECKLIST_ITEMS = [
  "Firmendaten sind hinterlegt",
  "Adresse und Kontaktwege passen",
  "Steuern und Zahlung sind bereit",
  "Dein erstes Angebot kann starten",
];

type OnboardingApiState = {
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
  onboardingStep: number;
};

type SettingsApiResponse = {
  settings?: CompanySettings;
  onboarding?: OnboardingApiState;
  error?: string;
  missingFields?: string[];
};

type PersistOptions = {
  showSuccess?: boolean;
  keepalive?: boolean;
};

type OnboardingPatch = {
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string | null;
  onboardingStep?: number;
};

export type OnboardingFlowEventType =
  | "onboarding_ready"
  | "onboarding_progress"
  | "onboarding_completed"
  | "onboarding_postponed";

export type OnboardingFlowEvent = {
  type: OnboardingFlowEventType;
  onboardingCompleted: boolean;
  onboardingStep: number;
};

type EmbeddedOnboardingMessage = OnboardingFlowEvent & {
  source: "visioro-onboarding-embed";
};

type OnboardingPageClientProps = {
  embedded?: boolean;
  initialSettings?: CompanySettings | null;
  onEmbeddedEvent?: (event: OnboardingFlowEvent) => void;
  preferredStartStep?: number;
};

function setOnboardingSnoozeCookie(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${ONBOARDING_SNOOZE_COOKIE_NAME}=1; path=/; samesite=lax`;
}

function clearOnboardingSnoozeCookie(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${ONBOARDING_SNOOZE_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax`;
}

function emitEmbeddedOnboardingEvent(
  payload: OnboardingFlowEvent,
  onEmbeddedEvent?: (event: OnboardingFlowEvent) => void,
): void {
  onEmbeddedEvent?.(payload);

  if (typeof window === "undefined") {
    return;
  }

  if (window.parent === window) {
    return;
  }

  window.parent.postMessage(
    {
      source: "visioro-onboarding-embed",
      ...payload,
    } satisfies EmbeddedOnboardingMessage,
    window.location.origin,
  );
}

function scaleToMaxEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const largestEdge = Math.max(width, height);
  if (largestEdge <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / largestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function serializeCanvasWithinLimit(
  canvas: HTMLCanvasElement,
  maxDataUrlLength: number,
): string | null {
  try {
    const pngDataUrl = canvas.toDataURL("image/png");
    if (pngDataUrl.length <= maxDataUrlLength) {
      return pngDataUrl;
    }
  } catch {
    // Continue with JPEG fallback.
  }

  for (const quality of LOGO_JPEG_QUALITIES) {
    try {
      const jpegDataUrl = canvas.toDataURL("image/jpeg", quality);
      if (jpegDataUrl.length <= maxDataUrlLength) {
        return jpegDataUrl;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function isSupportedLogoFile(file: File): boolean {
  if (isSupportedLogoMimeType(file.type)) {
    return true;
  }
  return hasSupportedLogoExtension(file.name);
}

async function loadImageElementFromFile(file: File): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("logo-image-load-failed"));
    };

    image.src = objectUrl;
  });
}

async function convertLogoFileToDataUrl(file: File): Promise<string> {
  const image = await loadImageElementFromFile(file);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;

  if (naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error("logo-image-invalid");
  }

  const initialSize = scaleToMaxEdge(
    naturalWidth,
    naturalHeight,
    MAX_LOGO_RENDER_EDGE_PX,
  );
  let canvas = document.createElement("canvas");
  canvas.width = initialSize.width;
  canvas.height = initialSize.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("logo-canvas-unavailable");
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const firstAttempt = serializeCanvasWithinLimit(canvas, MAX_LOGO_DATA_URL_LENGTH);
  if (firstAttempt) {
    return firstAttempt;
  }

  for (let attempt = 0; attempt < LOGO_MAX_DOWNSCALE_ATTEMPTS; attempt += 1) {
    const resizedCanvas = document.createElement("canvas");
    resizedCanvas.width = Math.max(
      1,
      Math.round(canvas.width * LOGO_DOWNSCALE_FACTOR),
    );
    resizedCanvas.height = Math.max(
      1,
      Math.round(canvas.height * LOGO_DOWNSCALE_FACTOR),
    );

    const resizedCtx = resizedCanvas.getContext("2d");
    if (!resizedCtx) {
      throw new Error("logo-canvas-unavailable");
    }

    resizedCtx.clearRect(0, 0, resizedCanvas.width, resizedCanvas.height);
    resizedCtx.drawImage(canvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
    canvas = resizedCanvas;

    const candidate = serializeCanvasWithinLimit(
      canvas,
      MAX_LOGO_DATA_URL_LENGTH,
    );
    if (candidate) {
      return candidate;
    }
  }

  throw new Error("logo-too-large-after-optimization");
}

function buildStepPayload(
  step: number,
  settings: CompanySettings,
): Partial<CompanySettings> {
  if (step === 1) {
    return {
      companyName: settings.companyName,
      ownerName: settings.ownerName,
      companyPhone: settings.companyPhone,
      companyEmail: settings.companyEmail,
    };
  }

  if (step === 2) {
    return {
      companyStreet: settings.companyStreet,
      companyPostalCode: settings.companyPostalCode,
      companyCity: settings.companyCity,
    };
  }

  if (step === 3) {
    return {
      taxNumber: settings.taxNumber,
      vatId: settings.vatId,
      euVatNoticeText: settings.euVatNoticeText,
      customServiceTypes: settings.customServiceTypes,
    };
  }

  if (step === 4) {
    return {
      companyIban: settings.companyIban,
      companyBic: settings.companyBic,
      companyBankName: settings.companyBankName,
      invoicePaymentDueDays: settings.invoicePaymentDueDays,
    };
  }

  return {
    logoDataUrl: settings.logoDataUrl,
  };
}

function renderOnboardingIcon(step: number) {
  if (step === 1) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4.5 19.5h15M6 19.5V7.8c0-.9.7-1.6 1.6-1.6h8.8c.9 0 1.6.7 1.6 1.6v11.7M9 10h1.5M13.5 10H15M9 13.5h1.5M13.5 13.5H15"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (step === 2) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 21s6-5 6-10a6 6 0 0 0-12 0c0 5 6 10 6 10Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M12 13.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (step === 3) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M5 13.4 10.6 19 20 6.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    );
  }

  if (step === 4) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M4 8.5h16M6.5 16h3M5.8 5.5h12.4c1 0 1.8.8 1.8 1.8v9.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V7.3c0-1 .8-1.8 1.8-1.8Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M7 12.4 10.3 16 17.5 8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function OnboardingPageClient({
  embedded = false,
  initialSettings = null,
  onEmbeddedEvent,
  preferredStartStep,
}: OnboardingPageClientProps) {
  const router = useRouter();
  const isEmbeddedMode = embedded;
  const [settings, setSettings] = useState<CompanySettings>(
    () => initialSettings ?? emptySettings,
  );
  const [currentStep, setCurrentStep] = useState(() =>
    clampOnboardingStep(preferredStartStep ?? 1),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [confirmCompletion, setConfirmCompletion] = useState(false);
  const [logoPreviewRevision, setLogoPreviewRevision] = useState(0);
  const [smallBusinessRule, setSmallBusinessRule] = useState(false);
  const [onboardingState, setOnboardingState] = useState<OnboardingApiState>({
    onboardingCompleted: false,
    onboardingCompletedAt: null,
    onboardingStep: 1,
  });
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const lastStepSaveAtRef = useRef(0);

  const progressPercent = useMemo(
    () => (currentStep / ONBOARDING_TOTAL_STEPS) * 100,
    [currentStep],
  );
  const ibanValidation = useMemo(
    () => validateIbanInput(settings.companyIban),
    [settings.companyIban],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      setError("");
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        const payload = (await response.json()) as SettingsApiResponse;
        if (!response.ok) {
          if (!cancelled) {
            setError(payload.error ?? "Onboarding konnte nicht geladen werden.");
          }
          return;
        }

        const nextSettings = payload.settings ?? emptySettings;
        const nextOnboarding = payload.onboarding ?? {
          onboardingCompleted: false,
          onboardingCompletedAt: null,
          onboardingStep: 1,
        };

        if (nextOnboarding.onboardingCompleted) {
          if (isEmbeddedMode) {
            emitEmbeddedOnboardingEvent(
              {
                type: "onboarding_completed",
                onboardingCompleted: true,
                onboardingStep: ONBOARDING_TOTAL_STEPS,
              },
              onEmbeddedEvent,
            );
            return;
          }
          router.replace("/");
          return;
        }

        if (!cancelled) {
          setSettings(nextSettings);
          setOnboardingState(nextOnboarding);
          const resumedStep = clampOnboardingStep(
            preferredStartStep ?? nextOnboarding.onboardingStep,
          );
          setCurrentStep(resumedStep);
          setSmallBusinessRule(
            /§\s*19\s*ustg/i.test(nextSettings.euVatNoticeText.trim()),
          );
          if (isEmbeddedMode) {
            emitEmbeddedOnboardingEvent(
              {
                type: "onboarding_ready",
                onboardingCompleted: false,
                onboardingStep: resumedStep,
              },
              onEmbeddedEvent,
            );
          }
        }
      } catch {
        if (!cancelled) {
          setError("Onboarding konnte nicht geladen werden.");
        }
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [isEmbeddedMode, onEmbeddedEvent, preferredStartStep, router]);

  useEffect(() => {
    const handlePageHide = () => {
      const stepPatch = buildStepPayload(currentStep, settings);
      void queuePersist(
        stepPatch,
        { onboardingStep: currentStep },
        { keepalive: true },
      );
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [currentStep, settings]);

  function queuePersist(
    settingsPatch: Partial<CompanySettings>,
    onboardingPatch?: OnboardingPatch,
    options?: PersistOptions,
  ): Promise<boolean> {
    const saveTask = async (): Promise<boolean> => {
      const body: Record<string, unknown> = { ...settingsPatch };
      if (onboardingPatch) {
        if (typeof onboardingPatch.onboardingCompleted === "boolean") {
          body.onboardingCompleted = onboardingPatch.onboardingCompleted;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            onboardingPatch,
            "onboardingCompletedAt",
          )
        ) {
          body.onboardingCompletedAt = onboardingPatch.onboardingCompletedAt ?? null;
        }
        if (typeof onboardingPatch.onboardingStep === "number") {
          body.onboardingStep = onboardingPatch.onboardingStep;
        }
      }

      if (Object.keys(body).length === 0) {
        return true;
      }

      setIsSaving(true);
      if (options?.showSuccess) {
        setInfo("");
      }

      try {
        const response = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          keepalive: Boolean(options?.keepalive),
        });
        const payload = (await response.json().catch(() => ({}))) as SettingsApiResponse;

        if (!response.ok) {
          setError(payload.error ?? "Speichern fehlgeschlagen.");
          return false;
        }

        if (payload.settings) {
          setSettings(payload.settings);
        }
        if (payload.onboarding) {
          setOnboardingState(payload.onboarding);
        }

        setError("");
        if (options?.showSuccess) {
          setInfo("Änderungen gespeichert.");
        }
        return true;
      } catch {
        setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
        return false;
      } finally {
        setIsSaving(false);
      }
    };

    const queued = saveQueueRef.current.then(saveTask, saveTask);
    saveQueueRef.current = queued.then(
      () => true,
      () => true,
    );
    return queued;
  }

  function updateSetting<K extends keyof CompanySettings>(
    key: K,
    value: CompanySettings[K],
  ) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function validateStep(step: number): string | null {
    if (step === 1) {
      if (!settings.companyName.trim()) {
        return "Bitte Firmenname eingeben.";
      }
      if (!settings.ownerName.trim()) {
        return "Bitte Inhaber / Ansprechpartner eingeben.";
      }
      if (!settings.companyEmail.trim()) {
        return "Bitte Firmen-E-Mail eingeben.";
      }
      if (!isValidEmailAddress(settings.companyEmail.trim())) {
        return "Bitte eine gültige Firmen-E-Mail eingeben.";
      }
      return null;
    }

    if (step === 2) {
      if (!settings.companyStreet.trim()) {
        return "Bitte Straße und Hausnummer eingeben.";
      }
      if (!settings.companyPostalCode.trim()) {
        return "Bitte PLZ eingeben.";
      }
      if (!settings.companyCity.trim()) {
        return "Bitte Ort eingeben.";
      }
      return null;
    }

    if (step === 3) {
      if (!Array.isArray(settings.customServiceTypes) || settings.customServiceTypes.length === 0) {
        return "Bitte wähle mindestens ein Gewerk aus.";
      }
      if (!settings.taxNumber.trim() && !settings.vatId.trim()) {
        return "Bitte mindestens Steuernummer oder USt-IdNr. eingeben.";
      }
      return null;
    }

    if (step === 4) {
      const iban = settings.companyIban.trim();
      if (!iban) {
        return "Bitte eine IBAN eingeben.";
      }
      if (!ibanValidation.isValid) {
        return ibanValidation.message;
      }
      if (
        !Number.isFinite(settings.invoicePaymentDueDays) ||
        settings.invoicePaymentDueDays < 0 ||
        settings.invoicePaymentDueDays > 365
      ) {
        return "Bitte ein gültiges Zahlungsziel zwischen 0 und 365 Tagen eingeben.";
      }
      return null;
    }

    if (step === 5 && !confirmCompletion) {
      return "Bitte bestätige den Abschluss der Ersteinrichtung.";
    }

    return null;
  }

  async function persistCurrentStepDraft() {
    const now = Date.now();
    if (now - lastStepSaveAtRef.current < 600) {
      return;
    }
    lastStepSaveAtRef.current = now;

    const stepPatch = buildStepPayload(currentStep, settings);
    await queuePersist(stepPatch, { onboardingStep: currentStep });
  }

  async function goToNextStep() {
    setInfo("");
    const validationError = validateStep(currentStep);
    if (validationError) {
      setError(validationError);
      return;
    }

    const nextStep = Math.min(ONBOARDING_TOTAL_STEPS, currentStep + 1);
    const stepPatch = buildStepPayload(currentStep, settings);
    const success = await queuePersist(stepPatch, { onboardingStep: nextStep });
    if (!success) {
      return;
    }

    setOnboardingState((prev) => ({
      ...prev,
      onboardingStep: nextStep,
    }));
    setCurrentStep(nextStep);
    if (isEmbeddedMode) {
      emitEmbeddedOnboardingEvent(
        {
          type: "onboarding_progress",
          onboardingCompleted: false,
          onboardingStep: nextStep,
        },
        onEmbeddedEvent,
      );
    }
    setError("");
  }

  async function goToPreviousStep() {
    if (currentStep <= 1) {
      return;
    }

    const previousStep = Math.max(1, currentStep - 1);
    const stepPatch = buildStepPayload(currentStep, settings);
    const success = await queuePersist(stepPatch, {
      onboardingStep: previousStep,
    });
    if (!success) {
      return;
    }

    setCurrentStep(previousStep);
    setOnboardingState((prev) => ({
      ...prev,
      onboardingStep: previousStep,
    }));
    if (isEmbeddedMode) {
      emitEmbeddedOnboardingEvent(
        {
          type: "onboarding_progress",
          onboardingCompleted: false,
          onboardingStep: previousStep,
        },
        onEmbeddedEvent,
      );
    }
    setError("");
  }

  async function completeOnboarding() {
    setInfo("");
    const validationError = validateStep(5);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!hasCompletedOnboardingRequiredFields(settings)) {
      setError(
        "Bitte prüfe die Pflichtfelder. Firmenname, Adresse, E-Mail, IBAN und Steuernummer/USt-IdNr. sind erforderlich.",
      );
      return;
    }

    const completionSettingsPatch: Partial<CompanySettings> = {
      companyName: settings.companyName,
      ownerName: settings.ownerName,
      companyPhone: settings.companyPhone,
      companyEmail: settings.companyEmail,
      companyStreet: settings.companyStreet,
      companyPostalCode: settings.companyPostalCode,
      companyCity: settings.companyCity,
      taxNumber: settings.taxNumber,
      vatId: settings.vatId,
      euVatNoticeText: settings.euVatNoticeText,
      companyIban: settings.companyIban,
      companyBic: settings.companyBic,
      companyBankName: settings.companyBankName,
      invoicePaymentDueDays: settings.invoicePaymentDueDays,
      logoDataUrl: settings.logoDataUrl,
    };

    const success = await queuePersist(
      completionSettingsPatch,
      {
        onboardingCompleted: true,
        onboardingCompletedAt: new Date().toISOString(),
        onboardingStep: ONBOARDING_TOTAL_STEPS,
      },
      { showSuccess: true },
    );
    if (!success) {
      return;
    }

    clearOnboardingSnoozeCookie();
    if (isEmbeddedMode) {
      emitEmbeddedOnboardingEvent(
        {
          type: "onboarding_completed",
          onboardingCompleted: true,
          onboardingStep: ONBOARDING_TOTAL_STEPS,
        },
        onEmbeddedEvent,
      );
      return;
    }
    router.replace("/");
  }

  async function postponeOnboarding() {
    setError("");
    setInfo("");

    // Modal sofort schließen — Speichern läuft im Hintergrund
    setOnboardingSnoozeCookie();
    if (isEmbeddedMode) {
      emitEmbeddedOnboardingEvent(
        {
          type: "onboarding_postponed",
          onboardingCompleted: false,
          onboardingStep: currentStep,
        },
        onEmbeddedEvent,
      );
    } else {
      router.replace("/");
    }

    // Fortschritt im Hintergrund speichern (non-blocking)
    const stepPatch = buildStepPayload(currentStep, settings);
    void queuePersist(stepPatch, {
      onboardingStep: currentStep,
      onboardingCompleted: false,
      onboardingCompletedAt: null,
    });
  }

  async function onLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (!file) {
      return;
    }

    setError("");
    setInfo("");

    if (!isSupportedLogoFile(file)) {
      setError(
        `Dieses Format wird nicht unterstützt. Erlaubt sind ${LOGO_ALLOWED_FORMATS_LABEL}.`,
      );
      inputElement.value = "";
      return;
    }

    if (file.size > MAX_LOGO_UPLOAD_FILE_BYTES) {
      setError(
        `Die Datei ist zu groß. Maximal ${MAX_LOGO_UPLOAD_FILE_MB} MB sind erlaubt.`,
      );
      inputElement.value = "";
      return;
    }

    setIsUploadingLogo(true);
    try {
      const dataUrl = await convertLogoFileToDataUrl(file);
      const sanitizedLogo = sanitizeCompanyLogoDataUrl(dataUrl);
      const nextSettings: CompanySettings = {
        ...settings,
        logoDataUrl: sanitizedLogo,
      };
      setSettings(nextSettings);
      setLogoPreviewRevision((prev) => prev + 1);

      const success = await queuePersist(
        { logoDataUrl: sanitizedLogo },
        { onboardingStep: currentStep },
      );
      if (!success) {
        return;
      }
      setInfo("Logo gespeichert.");
    } catch (uploadError) {
      if (
        uploadError instanceof Error &&
        uploadError.message === "logo-too-large-after-optimization"
      ) {
        setError(
          "Das Logo ist trotz Optimierung zu groß. Bitte eine kleinere Datei wählen.",
        );
      } else {
        setError(
          "Das Logo konnte nicht verarbeitet werden. Bitte PNG, JPG, JPEG, WEBP oder SVG verwenden.",
        );
      }
    } finally {
      setIsUploadingLogo(false);
      inputElement.value = "";
    }
  }

  async function deleteLogo() {
    if (!settings.logoDataUrl) {
      return;
    }
    setError("");
    setInfo("");

    const success = await queuePersist(
      { logoDataUrl: "" },
      { onboardingStep: currentStep },
    );
    if (!success) {
      return;
    }

    setSettings((prev) => ({ ...prev, logoDataUrl: "" }));
    setLogoPreviewRevision((prev) => prev + 1);
    setInfo("Logo entfernt.");
  }

  function toggleSmallBusinessRule(checked: boolean) {
    setSmallBusinessRule(checked);
    setSettings((prev) => {
      if (checked) {
        if (prev.euVatNoticeText.trim()) {
          return prev;
        }
        return {
          ...prev,
          euVatNoticeText: KLEINUNTERNEHMER_NOTICE_DEFAULT,
        };
      }

      if (prev.euVatNoticeText.trim() === KLEINUNTERNEHMER_NOTICE_DEFAULT) {
        return {
          ...prev,
          euVatNoticeText: "",
        };
      }

      return prev;
    });
  }

  const stepTitle =
    currentStep === 1
      ? "Deine Firma"
      : currentStep === 2
        ? "Wo findet man dich?"
        : currentStep === 3
          ? "Gewerk & Steuern"
          : currentStep === 4
            ? "Zahlung ohne Suchen"
            : "Alles startklar";

  const stepDescription =
    currentStep === 1
      ? "Damit deine digitale Crew weiß, wer du bist und wie Kunden dich erreichen."
      : currentStep === 2
        ? "Diese Angaben erscheinen sauber auf Angeboten, Rechnungen und Kundenmails."
        : currentStep === 3
          ? "Sag kurz, in welcher Sprache deine Angebote klingen sollen, und hinterlege die Steuerbasis."
          : currentStep === 4
            ? "Einmal eintragen, danach stehen Zahlungsziel und Bankdaten automatisch im Dokument."
            : "Prüfe den Überblick und starte danach direkt mit deinem ersten echten Angebot.";

  const primaryButtonLabel =
    currentStep === 1
      ? "Crew vorbereiten"
      : currentStep === 4
        ? "Zum Abschluss"
        : "Weiter";

  return (
    <main
      className={`page onboardingPage ${isEmbeddedMode ? "onboardingPageEmbedded" : ""}`}
    >
      {!isEmbeddedMode ? <div className="ambient ambientA" aria-hidden /> : null}
      {!isEmbeddedMode ? <div className="ambient ambientB" aria-hidden /> : null}

      <div className="container onboardingContainer">
        <section className="glassCard onboardingCard">
          <header className="onboardingHeader">
            <div className="onboardingProgressTrackTop" aria-hidden>
              <div
                className="onboardingProgressValueTop"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="onboardingTopNav" aria-label="Onboarding Navigation">
              {currentStep > 1 ? (
                <button
                  type="button"
                  className="onboardingBackButton"
                  onClick={() => void goToPreviousStep()}
                  disabled={isSaving || isUploadingLogo}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                    className="onboardingBackIcon"
                  >
                    <path
                      d="m15 5-7 7 7 7"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  <span>Zurück</span>
                </button>
              ) : (
                <span aria-hidden="true" />
              )}
              {currentStep < ONBOARDING_TOTAL_STEPS ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="onboardingSkipButton onboardingTopSkipButton"
                  onClick={() =>
                    !(isSaving || isUploadingLogo) && void postponeOnboarding()
                  }
                  onKeyDown={(event) => {
                    if (
                      (event.key === "Enter" || event.key === " ") &&
                      !(isSaving || isUploadingLogo)
                    ) {
                      event.preventDefault();
                      void postponeOnboarding();
                    }
                  }}
                  aria-disabled={isSaving || isUploadingLogo}
                >
                  Später
                </span>
              ) : null}
            </div>
            <div className="onboardingHeaderMain">
              <div
                className={`onboardingHeroIcon onboardingHeroIconStep${currentStep}`}
                aria-hidden="true"
              >
                {renderOnboardingIcon(currentStep)}
              </div>
              <div className="onboardingHeaderText">
                <p className="heroEyebrow">
                  Schritt {currentStep} von {ONBOARDING_TOTAL_STEPS}
                </p>
                <span className="onboardingStepBadge">
                  {currentStep === ONBOARDING_TOTAL_STEPS
                    ? "Bereit"
                    : "2 Minuten"}
                </span>
              </div>
              <h1>{stepTitle}</h1>
              <p className="heroText">{stepDescription}</p>
            </div>
          </header>

          <div
            className="onboardingStepCard"
            onBlurCapture={() => {
              void persistCurrentStepDraft();
            }}
          >
            {currentStep === 1 ? (
              <>
                <div
                  className="onboardingCrewPreview"
                  aria-label="Digitale Crew im Überblick"
                >
                  {CREW_PREVIEW_CARDS.map((card) => (
                    <article
                      key={card.title}
                      className={`onboardingCrewCard onboardingCrewCard-${card.tone}`}
                    >
                      <span className="onboardingCrewIcon" aria-hidden="true">
                        {card.title.charAt(0)}
                      </span>
                      <div>
                        <strong>{card.title}</strong>
                        <p>{card.text}</p>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="onboardingGrid">
                  <label className="field">
                    <span>Firmenname *</span>
                    <input
                      required
                      value={settings.companyName}
                      autoCapitalize="words"
                      placeholder="z. B. Bauwerk Müller GmbH"
                      onChange={(event) =>
                        updateSetting("companyName", event.target.value)
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Ansprechpartner *</span>
                    <input
                      required
                      value={settings.ownerName}
                      autoCapitalize="words"
                      placeholder="z. B. Max Müller"
                      onChange={(event) =>
                        updateSetting("ownerName", event.target.value)
                      }
                    />
                  </label>

                  <label className="field">
                    <span>Telefon</span>
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={settings.companyPhone}
                      placeholder="0176 123 456"
                      onChange={(event) =>
                        updateSetting("companyPhone", event.target.value)
                      }
                    />
                  </label>

                  <label className="field">
                    <span>E-Mail *</span>
                    <input
                      required
                      type="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={settings.companyEmail}
                      placeholder="info@deine-firma.de"
                      onChange={(event) =>
                        updateSetting("companyEmail", event.target.value)
                      }
                    />
                  </label>
                </div>
              </>
            ) : null}

            {currentStep === 2 ? (
              <div className="onboardingGrid">
                <label className="field span2">
                  <span>Straße + Hausnummer *</span>
                  <input
                    required
                    value={settings.companyStreet}
                    autoCapitalize="words"
                    placeholder="Musterstraße 12"
                    onChange={(event) =>
                      updateSetting("companyStreet", event.target.value)
                    }
                  />
                </label>

                <label className="field">
                  <span>PLZ *</span>
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={settings.companyPostalCode}
                    placeholder="80331"
                    onChange={(event) =>
                      updateSetting("companyPostalCode", event.target.value)
                    }
                  />
                </label>

                <label className="field">
                  <span>Ort *</span>
                  <input
                    required
                    value={settings.companyCity}
                    autoCapitalize="words"
                    placeholder="München"
                    onChange={(event) =>
                      updateSetting("companyCity", event.target.value)
                    }
                  />
                </label>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div className="onboardingStepBody onboardingStepBodyTax">
                <section className="onboardingFormSection onboardingFormSectionAccent">
                  <div className="onboardingFormSectionHeader">
                    <p className="onboardingFormSectionEyebrow">Dein Ton</p>
                    <h3 className="onboardingFormSectionTitle">
                      Welche Baustellen-Sprache soll die KI kennen?
                    </h3>
                    <p className="onboardingFormSectionText">
                      Wähle alle Gewerke aus, die dein Betrieb anbietet. Das
                      steuert später Fachbegriffe, Leistungen und KI-Vorschläge.
                    </p>
                  </div>

                  <TradeMultiSelect
                    idPrefix="onboarding-trade"
                    selectedTrades={settings.customServiceTypes}
                    onChange={(nextTrades) =>
                      updateSetting("customServiceTypes", nextTrades)
                    }
                    helperText="Die Liste basiert auf den aktuell aktiven Gewerken der HwO-Anlagen A, B1 und B2."
                  />
                </section>

                <section className="onboardingFormSection onboardingFormSectionRequired">
                  <div className="onboardingFormSectionHeader">
                    <p className="onboardingFormSectionEyebrow">Pflichtbereich</p>
                    <h3 className="onboardingFormSectionTitle">
                      Steuerangaben für saubere Rechnungen
                    </h3>
                    <p className="onboardingFormSectionText">
                      Trage entweder deine Steuernummer oder deine USt-IdNr. ein.
                      Eine der beiden Angaben reicht aus.
                    </p>
                  </div>

                  <div className="onboardingGrid onboardingGridCompact">
                    <label className="field">
                      <span>Steuernummer</span>
                      <input
                        value={settings.taxNumber}
                        autoCapitalize="characters"
                        onChange={(event) =>
                          updateSetting("taxNumber", event.target.value)
                        }
                        placeholder="z. B. 12/345/67890"
                      />
                    </label>

                    <label className="field">
                      <span>USt-IdNr.</span>
                      <input
                        value={settings.vatId}
                        autoCapitalize="characters"
                        onChange={(event) =>
                          updateSetting("vatId", event.target.value)
                        }
                        placeholder="z. B. DE123456789"
                      />
                    </label>
                  </div>
                </section>

                <section className="onboardingFormSection onboardingFormSectionOptional">
                  <div className="onboardingFormSectionHeader">
                    <p className="onboardingFormSectionEyebrow">Optional</p>
                    <h3 className="onboardingFormSectionTitle">
                      Kleinunternehmerregelung und Hinweistext
                    </h3>
                    <p className="onboardingFormSectionText">
                      Aktiviere die Regelung nur, wenn sie auf dein Unternehmen
                      zutrifft. Den Hinweistext brauchst du nur für Sonderfälle.
                    </p>
                  </div>

                  <label className="onboardingToggle onboardingToggleCard">
                    <input
                      type="checkbox"
                      checked={smallBusinessRule}
                      onChange={(event) =>
                        toggleSmallBusinessRule(event.target.checked)
                      }
                    />
                    <span>Kleinunternehmerregelung (§ 19 UStG) anwenden</span>
                  </label>

                  <label className="field">
                    <span>Steuerhinweis (optional)</span>
                    <textarea
                      rows={3}
                      value={settings.euVatNoticeText}
                      onChange={(event) =>
                        updateSetting("euVatNoticeText", event.target.value)
                      }
                      placeholder="z. B. Reverse-Charge-Hinweis oder Hinweis zur Steuerbefreiung"
                    />
                  </label>
                </section>
              </div>
            ) : null}

            {currentStep === 4 ? (
              <div className="onboardingGrid">
                <label className="field span2">
                  <span>IBAN *</span>
                  <input
                    required
                    value={settings.companyIban}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    placeholder="z. B. DE89 3704 0044 0532 0130 00"
                    onChange={(event) =>
                      updateSetting(
                        "companyIban",
                        formatIbanForDisplay(event.target.value),
                      )
                    }
                  />
                  <small
                    className={`settingsIbanHint ${ibanValidation.isValid ? "isValid" : "isInvalid"} isVisible`}
                  >
                    {settings.companyIban.trim()
                      ? ibanValidation.message
                      : "Die IBAN wird lokal auf Format, Länge und Prüfziffer geprüft."}
                  </small>
                </label>

                <label className="field">
                  <span>BIC (optional)</span>
                  <input
                    value={settings.companyBic}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    onChange={(event) =>
                      updateSetting("companyBic", normalizeBicInput(event.target.value))
                    }
                    placeholder="z. B. COBADEFFXXX"
                  />
                </label>

                <label className="field">
                  <span>Bankname (optional)</span>
                  <input
                    value={settings.companyBankName}
                    autoCapitalize="words"
                    onChange={(event) =>
                      updateSetting("companyBankName", event.target.value)
                    }
                    placeholder="z. B. Musterbank AG"
                  />
                </label>

                <label className="field">
                  <span>Zahlungsziel (Tage)</span>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={settings.invoicePaymentDueDays}
                    onChange={(event) =>
                      updateSetting(
                        "invoicePaymentDueDays",
                        Number(event.target.value || "14"),
                      )
                    }
                  />
                </label>

                <div className="onboardingLifecyclePreview span2">
                  {LIFECYCLE_PREVIEW_ITEMS.map((item) => (
                    <article
                      key={item.title}
                      className={`onboardingLifecycleItem onboardingLifecycleItem-${item.tone}`}
                    >
                      <span className="onboardingLifecycleDot" aria-hidden="true" />
                      <div>
                        <p>{item.label}</p>
                        <strong>{item.title}</strong>
                        <span>{item.text}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {currentStep === 5 ? (
              <div className="onboardingFinalWrap">
                <div className="onboardingFinalChecklist">
                  {FINAL_CHECKLIST_ITEMS.map((item) => (
                    <div key={item} className="onboardingChecklistItem">
                      <span aria-hidden="true">✓</span>
                      <strong>{item}</strong>
                    </div>
                  ))}
                </div>

                <section className="onboardingLogoPanel">
                  <div>
                    <p className="onboardingLogoTitle">Logo optional ergänzen</p>
                    <p className="onboardingHint">
                      {LOGO_ALLOWED_FORMATS_LABEL}, maximal{" "}
                      {MAX_LOGO_UPLOAD_FILE_MB} MB. Du kannst das später ändern.
                    </p>
                  </div>

                  <label className="onboardingLogoUpload">
                    <span>{settings.logoDataUrl ? "Logo ersetzen" : "Logo hochladen"}</span>
                    <input
                      type="file"
                      accept={LOGO_UPLOAD_ACCEPT_ATTRIBUTE}
                      onChange={onLogoUpload}
                      disabled={isUploadingLogo}
                    />
                  </label>

                  {settings.logoDataUrl ? (
                    <div className="logoFrame">
                      <img
                        key={logoPreviewRevision}
                        src={settings.logoDataUrl}
                        alt="Logo Vorschau"
                        className="logoPreview"
                      />
                      <button
                        type="button"
                        className="ghostButton onboardingLogoRemoveButton"
                        disabled={isUploadingLogo}
                        onClick={() => void deleteLogo()}
                      >
                        Entfernen
                      </button>
                    </div>
                  ) : null}
                </section>

                <label className="onboardingToggle onboardingConfirmToggle">
                  <input
                    type="checkbox"
                    checked={confirmCompletion}
                    onChange={(event) => setConfirmCompletion(event.target.checked)}
                  />
                  <span>
                    Alles geprüft. Ich möchte die Ersteinrichtung abschließen.
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          <footer className="onboardingActions">
            {currentStep < ONBOARDING_TOTAL_STEPS ? (
              <button
                type="button"
                className="primaryButton"
                onClick={() => void goToNextStep()}
                disabled={isSaving || isUploadingLogo}
              >
                {primaryButtonLabel}
              </button>
            ) : (
              <button
                type="button"
                className="primaryButton"
                onClick={() => void completeOnboarding()}
                disabled={isSaving || isUploadingLogo}
              >
                Ersteinrichtung abschließen
              </button>
            )}
          </footer>

          {isSaving ? <p className="voiceInfo">Speichern ...</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {!error && info ? <p className="success">{info}</p> : null}
        </section>
      </div>
    </main>
  );
}
