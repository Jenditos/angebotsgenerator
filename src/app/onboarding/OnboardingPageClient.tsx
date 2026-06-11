"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatIbanForDisplay,
  normalizeBicInput,
  validateIbanInput,
} from "@/lib/iban";
import { MAIN_BANK_ACCOUNT_ID } from "@/lib/bank-accounts";
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
  companyCountry: "Deutschland",
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
  allowCompletedRestart?: boolean;
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

function buildStepPayload(
  step: number,
  settings: CompanySettings,
): Partial<CompanySettings> {
  if (step === 2) {
    return {
      customServiceTypes: settings.customServiceTypes,
    };
  }

  if (step === 3) {
    return {
      companyName: settings.companyName,
      ownerName: settings.ownerName,
      companyStreet: settings.companyStreet,
      companyPostalCode: settings.companyPostalCode,
      companyCity: settings.companyCity,
      companyCountry: settings.companyCountry || "Deutschland",
      companyPhone: settings.companyPhone,
      companyEmail: settings.companyEmail,
    };
  }

  if (step === 4) {
    return {
      taxNumber: settings.taxNumber,
      vatId: settings.vatId,
      companyIban: settings.companyIban,
      companyBic: settings.companyBic,
      invoicePaymentDueDays: settings.invoicePaymentDueDays,
    };
  }

  return {};
}

function splitOwnerName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

export default function OnboardingPageClient({
  embedded = false,
  initialSettings = null,
  allowCompletedRestart = false,
  onEmbeddedEvent,
  preferredStartStep,
}: OnboardingPageClientProps) {
  const router = useRouter();
  const isEmbeddedMode = embedded;
  const headingId = isEmbeddedMode ? "onboarding-flow-title" : "onboarding-title";
  const [settings, setSettings] = useState<CompanySettings>(
    () => initialSettings ?? emptySettings,
  );
  const [currentStep, setCurrentStep] = useState(() =>
    clampOnboardingStep(preferredStartStep ?? 1),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
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
  const ownerNameParts = useMemo(
    () => splitOwnerName(settings.ownerName),
    [settings.ownerName],
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

        if (
          nextOnboarding.onboardingCompleted &&
          isEmbeddedMode &&
          !allowCompletedRestart
        ) {
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

        if (!cancelled) {
          setSettings(nextSettings);
          setOnboardingState(nextOnboarding);
          const resumedStep = clampOnboardingStep(
            preferredStartStep ??
              (nextOnboarding.onboardingCompleted ? 1 : nextOnboarding.onboardingStep),
          );
          setCurrentStep(resumedStep);
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
  }, [
    allowCompletedRestart,
    isEmbeddedMode,
    onEmbeddedEvent,
    preferredStartStep,
    router,
  ]);

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

  function updateOwnerNamePart(part: "firstName" | "lastName", value: string) {
    const firstName = part === "firstName" ? value : ownerNameParts.firstName;
    const lastName = part === "lastName" ? value : ownerNameParts.lastName;
    updateSetting(
      "ownerName",
      [firstName.trim(), lastName.trim()].filter(Boolean).join(" "),
    );
  }

  function validateStep(step: number): string | null {
    if (step === 1) {
      return null;
    }

    if (step === 2) {
      if (
        !Array.isArray(settings.customServiceTypes) ||
        settings.customServiceTypes.length === 0
      ) {
        return "Bitte wähle mindestens ein Gewerk aus.";
      }
      return null;
    }

    if (step === 3) {
      if (!settings.companyName.trim()) {
        return "Bitte Firmenname eingeben.";
      }
      if (!ownerNameParts.firstName.trim()) {
        return "Bitte Vorname eingeben.";
      }
      if (!ownerNameParts.lastName.trim()) {
        return "Bitte Nachname eingeben.";
      }
      if (!settings.companyStreet.trim()) {
        return "Bitte Straße und Hausnummer eingeben.";
      }
      if (!settings.companyPostalCode.trim()) {
        return "Bitte PLZ eingeben.";
      }
      if (!settings.companyCity.trim()) {
        return "Bitte Ort eingeben.";
      }
      if (!settings.companyEmail.trim()) {
        return "Bitte E-Mail eingeben.";
      }
      if (!isValidEmailAddress(settings.companyEmail.trim())) {
        return "Bitte eine gültige E-Mail eingeben.";
      }
      return null;
    }

    if (step === 4) {
      if (!settings.taxNumber.trim()) {
        return "Bitte Steuernummer eingeben.";
      }
      const iban = settings.companyIban.trim();
      if (iban && !ibanValidation.isValid) {
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
    const validationError = validateStep(ONBOARDING_TOTAL_STEPS);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!hasCompletedOnboardingRequiredFields(settings)) {
      setError(
        "Bitte prüfe die Pflichtfelder. Gewerk, Firmendaten, Adresse, E-Mail und Steuernummer sind erforderlich.",
      );
      return;
    }

    const completionSettingsPatch: Partial<CompanySettings> = {
      customServiceTypes: settings.customServiceTypes,
      companyName: settings.companyName,
      ownerName: settings.ownerName,
      companyPhone: settings.companyPhone,
      companyEmail: settings.companyEmail,
      companyStreet: settings.companyStreet,
      companyPostalCode: settings.companyPostalCode,
      companyCity: settings.companyCity,
      companyCountry: settings.companyCountry || "Deutschland",
      taxNumber: settings.taxNumber,
      vatId: settings.vatId,
      companyIban: settings.companyIban,
      companyBic: settings.companyBic,
      invoicePaymentDueDays: settings.invoicePaymentDueDays,
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

    // Modal sofort schließen; Speichern läuft im Hintergrund.
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

    // Fortschritt im Hintergrund speichern.
    const stepPatch = buildStepPayload(currentStep, settings);
    void queuePersist(stepPatch, {
      onboardingStep: currentStep,
      onboardingCompleted: false,
      onboardingCompletedAt: null,
    });
  }

  const stepTitle =
    currentStep === 1
      ? "Willkommen bei VISIORO"
      : currentStep === 2
        ? "Was bietet dein Betrieb an?"
        : currentStep === 3
          ? "Deine Firmendaten"
          : "Rechnungsdaten";

  const stepDescription =
    currentStep === 1
      ? "Richte deine App in wenigen Minuten ein. Danach kannst du Angebote und Rechnungen schneller erstellen."
      : currentStep === 2
        ? "Wähle ein oder mehrere Gewerke. Die KI nutzt diese Auswahl, um passende Fachbegriffe und Leistungspositionen vorzuschlagen."
        : currentStep === 3
          ? "Diese Daten erscheinen später automatisch auf deinen Angeboten und Rechnungen."
          : "Diese Angaben kannst du später jederzeit ändern.";

  const primaryButtonLabel =
    currentStep === 1
      ? "Einrichtung starten"
      : currentStep === ONBOARDING_TOTAL_STEPS
        ? "Einrichtung abschließen"
        : "Weiter";

  return (
    <main
      className={`page onboardingPage onboardingSetup onboardingPageStep${currentStep} ${
        isEmbeddedMode ? "onboardingPageEmbedded" : ""
      }`}
    >
      {!isEmbeddedMode ? <div className="ambient ambientA" aria-hidden /> : null}
      {!isEmbeddedMode ? <div className="ambient ambientB" aria-hidden /> : null}

      <div className="onboardingSetupShell">
        <section className="onboardingSetupPanel" aria-labelledby={headingId}>
          <header className="onboardingSetupTop">
            <div className="onboardingSetupTopRow">
              <p className="onboardingSetupStepText">
                Schritt {currentStep} von {ONBOARDING_TOTAL_STEPS}
              </p>
            </div>
            <div className="onboardingSetupProgressTrack" aria-hidden>
              <div
                className="onboardingSetupProgressValue"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </header>

          <div
            className="onboardingSetupScroll"
            onBlurCapture={() => {
              void persistCurrentStepDraft();
            }}
          >
            <div className="onboardingSetupContent">
              <div className="onboardingSetupIntro">
                {currentStep === 1 ? (
                  <div className="onboardingSetupBrandMark" aria-hidden="true">
                    <span>V</span>
                  </div>
                ) : null}
                <h1 id={headingId}>{stepTitle}</h1>
                <p>{stepDescription}</p>
                {currentStep === 1 ? (
                  <div className="onboardingSetupBenefit">
                    Deine Angaben werden später automatisch in Angeboten,
                    Rechnungen und PDF-Dokumenten verwendet.
                  </div>
                ) : null}
              </div>

              {currentStep === 2 ? (
                <section className="onboardingSetupSection">
                  <TradeMultiSelect
                    idPrefix="onboarding-trade"
                    selectedTrades={settings.customServiceTypes}
                    onChange={(nextTrades) =>
                      updateSetting("customServiceTypes", nextTrades)
                    }
                    variant="onboarding"
                  />
                </section>
              ) : null}

              {currentStep === 3 ? (
                <div className="onboardingSetupForm">
                  <label className="onboardingSetupField onboardingSetupFieldFull">
                    <span>Firmenname</span>
                    <input
                      value={settings.companyName}
                      autoCapitalize="words"
                      placeholder="z. B. Malerbetrieb Müller GmbH"
                      onChange={(event) =>
                        updateSetting("companyName", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField">
                    <span>Vorname</span>
                    <input
                      value={ownerNameParts.firstName}
                      autoCapitalize="words"
                      placeholder="Max"
                      onChange={(event) =>
                        updateOwnerNamePart("firstName", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField">
                    <span>Nachname</span>
                    <input
                      value={ownerNameParts.lastName}
                      autoCapitalize="words"
                      placeholder="Müller"
                      onChange={(event) =>
                        updateOwnerNamePart("lastName", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField onboardingSetupFieldFull">
                    <span>Straße und Hausnummer</span>
                    <input
                      value={settings.companyStreet}
                      autoCapitalize="words"
                      placeholder="Musterstraße 12"
                      onChange={(event) =>
                        updateSetting("companyStreet", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField onboardingSetupFieldShort">
                    <span>PLZ</span>
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={settings.companyPostalCode}
                      placeholder="80331"
                      onChange={(event) =>
                        updateSetting("companyPostalCode", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField">
                    <span>Ort</span>
                    <input
                      value={settings.companyCity}
                      autoCapitalize="words"
                      placeholder="München"
                      onChange={(event) =>
                        updateSetting("companyCity", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField onboardingSetupFieldFull">
                    <span>Land</span>
                    <input
                      value={settings.companyCountry || "Deutschland"}
                      autoCapitalize="words"
                      placeholder="Deutschland"
                      onChange={(event) =>
                        updateSetting("companyCountry", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField">
                    <span>Telefonnummer</span>
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

                  <label className="onboardingSetupField">
                    <span>E-Mail</span>
                    <input
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
              ) : null}

              {currentStep === 4 ? (
                <div className="onboardingSetupForm">
                  <label className="onboardingSetupField">
                    <span>Steuernummer</span>
                    <input
                      value={settings.taxNumber}
                      autoCapitalize="characters"
                      placeholder="z. B. 12/345/67890"
                      onChange={(event) =>
                        updateSetting("taxNumber", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField">
                    <span>
                      USt-IdNr. <small>optional</small>
                    </span>
                    <input
                      value={settings.vatId}
                      autoCapitalize="characters"
                      placeholder="z. B. DE123456789"
                      onChange={(event) =>
                        updateSetting("vatId", event.target.value)
                      }
                    />
                  </label>

                  <label className="onboardingSetupField onboardingSetupFieldFull">
                    <span>
                      IBAN <small>optional</small>
                    </span>
                    <input
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
                    {settings.companyIban.trim() ? (
                      <small
                        className={`onboardingSetupHint ${
                          ibanValidation.isValid ? "isValid" : "isInvalid"
                        }`}
                      >
                        {ibanValidation.message}
                      </small>
                    ) : null}
                  </label>

                  <label className="onboardingSetupField">
                    <span>
                      BIC <small>optional</small>
                    </span>
                    <input
                      value={settings.companyBic}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      placeholder="z. B. COBADEFFXXX"
                      onChange={(event) =>
                        updateSetting(
                          "companyBic",
                          normalizeBicInput(event.target.value),
                        )
                      }
                    />
                  </label>

                  <label className="onboardingSetupField">
                    <span>Standard-Zahlungsziel</span>
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

              {error ? (
                <p className="onboardingSetupMessage isError">{error}</p>
              ) : null}
              {!error && info ? (
                <p className="onboardingSetupMessage isSuccess">{info}</p>
              ) : null}
              {isSaving ? (
                <p className="onboardingSetupMessage">Speichern ...</p>
              ) : null}
            </div>
          </div>

          <footer className="onboardingSetupFooter">
            {currentStep > 1 ? (
              <button
                type="button"
                className="onboardingSetupBack"
                onClick={() => void goToPreviousStep()}
                disabled={isSaving}
              >
                Zurück
              </button>
            ) : (
              <button
                type="button"
                className="onboardingSetupBack onboardingSetupBackPlaceholder"
                tabIndex={-1}
                aria-hidden="true"
              >
                Zurück
              </button>
            )}
            <div className="onboardingSetupFooterActions">
              <button
                type="button"
                className="onboardingSetupSecondary"
                onClick={() => void postponeOnboarding()}
                disabled={isSaving}
              >
                Speichern und zur App
              </button>
              <button
                type="button"
                className="onboardingSetupPrimary"
                onClick={() =>
                  currentStep < ONBOARDING_TOTAL_STEPS
                    ? void goToNextStep()
                    : void completeOnboarding()
                }
                disabled={isSaving}
              >
                {isSaving ? "Speichern ..." : primaryButtonLabel}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
