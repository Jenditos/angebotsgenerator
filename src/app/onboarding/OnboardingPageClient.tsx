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
  offerTermsText:
    "Dieses Angebot basiert auf den aktuell gültigen Materialpreisen. Änderungen durch unvorhergesehene Baustellenbedingungen bleiben vorbehalten.",
  lastOfferNumber: "",
  lastInvoiceNumber: "",
  customServiceTypes: [],
};

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
  onEmbeddedEvent?: (event: OnboardingFlowEvent) => void;
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

export default function OnboardingPageClient({
  embedded = false,
  onEmbeddedEvent,
}: OnboardingPageClientProps) {
  const router = useRouter();
  const isEmbeddedMode = embedded;
  const [settings, setSettings] = useState<CompanySettings>(emptySettings);
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
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
      setIsLoading(true);
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
          const resumedStep = clampOnboardingStep(nextOnboarding.onboardingStep);
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
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [isEmbeddedMode, onEmbeddedEvent, router]);

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

    const stepPatch = buildStepPayload(currentStep, settings);
    const success = await queuePersist(stepPatch, {
      onboardingStep: currentStep,
      onboardingCompleted: false,
      onboardingCompletedAt: null,
    });
    if (!success) {
      return;
    }

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
      return;
    }
    router.replace("/");
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

  if (isLoading) {
    return (
      <main
        className={`page onboardingPage ${isEmbeddedMode ? "onboardingPageEmbedded" : ""}`}
      >
        {!isEmbeddedMode ? <div className="ambient ambientA" aria-hidden /> : null}
        {!isEmbeddedMode ? <div className="ambient ambientB" aria-hidden /> : null}
        <div className="container onboardingContainer">
          <section className="glassCard onboardingCard onboardingLoadingCard">
            <p className="voiceInfo">Onboarding wird geladen ...</p>
          </section>
        </div>
      </main>
    );
  }

  const stepTitle =
    currentStep === 1
      ? "Firmendaten"
      : currentStep === 2
        ? "Firmenadresse"
        : currentStep === 3
          ? "Steuerliche Angaben"
          : currentStep === 4
            ? "Zahlungsdaten"
            : "Logo & Abschluss";

  const stepDescription =
    currentStep === 1
      ? "Wir starten mit den wichtigsten Kontaktdaten."
      : currentStep === 2
        ? "Diese Adresse wird als Absender auf Dokumenten genutzt."
        : currentStep === 3
          ? "Für Rechnungen benötigen wir steuerliche Basisdaten."
          : currentStep === 4
            ? "Diese Daten werden auf Rechnungen als Zahlungshinweis gezeigt."
            : "Optional Logo hochladen und Ersteinrichtung abschließen.";

  return (
    <main
      className={`page onboardingPage ${isEmbeddedMode ? "onboardingPageEmbedded" : ""}`}
    >
      {!isEmbeddedMode ? <div className="ambient ambientA" aria-hidden /> : null}
      {!isEmbeddedMode ? <div className="ambient ambientB" aria-hidden /> : null}

      <div className="container onboardingContainer">
        <section className="glassCard onboardingCard">
          <header className="onboardingHeader">
            <p className="heroEyebrow">Ersteinrichtung</p>
            <h1>Schritt {currentStep} von 5</h1>
            <p className="heroText">
              Bitte richte dein Konto einmalig ein. Danach kommst du direkt zur App.
            </p>
            <div className="onboardingProgressRow" aria-hidden>
              <div className="onboardingProgressTrack">
                <span
                  className="onboardingProgressValue"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <strong>{Math.round(progressPercent)}%</strong>
            </div>
          </header>

          <div
            className="onboardingStepCard"
            onBlurCapture={() => {
              void persistCurrentStepDraft();
            }}
          >
            <p className="onboardingStepTag">{stepTitle}</p>
            <h2>{stepTitle}</h2>
            <p className="onboardingStepDescription">{stepDescription}</p>

            {currentStep === 1 ? (
              <div className="onboardingGrid">
                <label className="field">
                  <span>Firmenname *</span>
                  <input
                    required
                    value={settings.companyName}
                    autoCapitalize="words"
                    onChange={(event) =>
                      updateSetting("companyName", event.target.value)
                    }
                  />
                </label>

                <label className="field">
                  <span>Inhaber / Ansprechpartner *</span>
                  <input
                    required
                    value={settings.ownerName}
                    autoCapitalize="words"
                    onChange={(event) =>
                      updateSetting("ownerName", event.target.value)
                    }
                  />
                </label>

                <label className="field">
                  <span>Telefonnummer</span>
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={settings.companyPhone}
                    onChange={(event) =>
                      updateSetting("companyPhone", event.target.value)
                    }
                  />
                </label>

                <label className="field">
                  <span>Firmen-E-Mail *</span>
                  <input
                    required
                    type="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={settings.companyEmail}
                    onChange={(event) =>
                      updateSetting("companyEmail", event.target.value)
                    }
                  />
                </label>
              </div>
            ) : null}

            {currentStep === 2 ? (
              <div className="onboardingGrid">
                <label className="field span2">
                  <span>Straße + Hausnummer *</span>
                  <input
                    required
                    value={settings.companyStreet}
                    autoCapitalize="words"
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
                    onChange={(event) =>
                      updateSetting("companyCity", event.target.value)
                    }
                  />
                </label>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div className="onboardingGrid">
                <label className="field">
                  <span>Steuernummer</span>
                  <input
                    value={settings.taxNumber}
                    autoCapitalize="characters"
                    onChange={(event) => updateSetting("taxNumber", event.target.value)}
                    placeholder="z. B. 12/345/67890"
                  />
                </label>

                <label className="field">
                  <span>USt-IdNr.</span>
                  <input
                    value={settings.vatId}
                    autoCapitalize="characters"
                    onChange={(event) => updateSetting("vatId", event.target.value)}
                    placeholder="z. B. DE123456789"
                  />
                </label>

                <p className="onboardingHint span2">
                  Pflicht: Mindestens eines der beiden Felder muss ausgefüllt sein.
                </p>

                <label className="onboardingToggle span2">
                  <input
                    type="checkbox"
                    checked={smallBusinessRule}
                    onChange={(event) =>
                      toggleSmallBusinessRule(event.target.checked)
                    }
                  />
                  <span>Kleinunternehmerregelung (§ 19 UStG) anwenden</span>
                </label>

                <label className="field span2">
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
              </div>
            ) : null}

            {currentStep === 5 ? (
              <div className="onboardingGrid">
                <label className="field span2">
                  <span>Firmenlogo (optional)</span>
                  <input
                    type="file"
                    accept={LOGO_UPLOAD_ACCEPT_ATTRIBUTE}
                    onChange={onLogoUpload}
                    disabled={isUploadingLogo}
                  />
                </label>

                <p className="onboardingHint span2">
                  Erlaubte Formate: {LOGO_ALLOWED_FORMATS_LABEL}. Maximal{" "}
                  {MAX_LOGO_UPLOAD_FILE_MB} MB pro Datei.
                </p>

                <div className="onboardingLogoActions span2">
                  <button
                    type="button"
                    className="ghostButton"
                    disabled={!settings.logoDataUrl || isUploadingLogo}
                    onClick={() => void deleteLogo()}
                  >
                    Logo entfernen
                  </button>
                </div>

                {settings.logoDataUrl ? (
                  <div className="logoFrame span2">
                    <img
                      key={logoPreviewRevision}
                      src={settings.logoDataUrl}
                      alt="Logo Vorschau"
                      className="logoPreview"
                    />
                  </div>
                ) : null}

                <label className="onboardingToggle span2">
                  <input
                    type="checkbox"
                    checked={confirmCompletion}
                    onChange={(event) => setConfirmCompletion(event.target.checked)}
                  />
                  <span>
                    Ich bestätige, dass die Pflichtdaten korrekt sind und möchte
                    die Ersteinrichtung abschließen.
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          <footer className="onboardingActions">
            <button
              type="button"
              className="ghostButton"
              onClick={() => void goToPreviousStep()}
              disabled={currentStep === 1 || isSaving || isUploadingLogo}
            >
              Zurück
            </button>

            {currentStep < ONBOARDING_TOTAL_STEPS ? (
              <button
                type="button"
                className="primaryButton"
                onClick={() => void goToNextStep()}
                disabled={isSaving || isUploadingLogo}
              >
                Weiter
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
          <div className="onboardingSkipRow">
            <span
              role="button"
              tabIndex={0}
              className="onboardingSkipButton"
              onClick={() => !(isSaving || isUploadingLogo) && void postponeOnboarding()}
              onKeyDown={(e) => e.key === "Enter" && !(isSaving || isUploadingLogo) && void postponeOnboarding()}
              aria-disabled={isSaving || isUploadingLogo}
            >
              Später einrichten / App erstmal ansehen
            </span>
          </div>

          {isSaving ? <p className="voiceInfo">Speichern ...</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {!error && info ? <p className="success">{info}</p> : null}
        </section>
      </div>
    </main>
  );
}
