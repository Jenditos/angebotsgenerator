import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  normalizeBicInput,
  validateIbanInput,
} from "@/lib/iban";
import {
  OnboardingStatusUpdate,
  readOnboardingStatus,
  readSettings,
  writeOnboardingStatus,
  writeSettings,
} from "@/lib/settings-store";
import {
  getMissingOnboardingRequiredFields,
  hasCompletedOnboardingRequiredFields,
} from "@/lib/onboarding";
import { CompanySettings } from "@/types/offer";

type SettingsPostBody = Partial<CompanySettings> & {
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string | null;
  onboardingStep?: number | string;
};

function classifySettingsStoreError(error: unknown): {
  status: number;
  publicMessage: string;
} {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "");
  const normalized = rawMessage.toLowerCase();
  const isSetupProblem =
    normalized.includes("42p01") ||
    normalized.includes("user_settings") ||
    normalized.includes("permission denied");

  if (isSetupProblem) {
    return {
      status: 503,
      publicMessage:
        "Einstellungen-Speicher ist aktuell nicht vollständig eingerichtet.",
    };
  }

  return {
    status: 500,
    publicMessage: "Einstellungen konnten nicht geladen werden.",
  };
}

export async function GET() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const [settings, onboarding] = await Promise.all([
      readSettings({
        supabase: accessResult.supabase,
        userId: accessResult.user.id,
      }),
      readOnboardingStatus({
        supabase: accessResult.supabase,
        userId: accessResult.user.id,
      }),
    ]);
    return NextResponse.json(
      { settings, onboarding },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const classified = classifySettingsStoreError(error);
    console.error("[api/settings][GET] Einstellungen konnten nicht geladen werden.", {
      userId: accessResult.user.id,
      error,
    });
    return NextResponse.json(
      { error: classified.publicMessage },
      { status: classified.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const rawBody = (await request.json()) as unknown;
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as SettingsPostBody)
        : {};

    const sanitized: Partial<CompanySettings> = {};
    let hasSettingsChanges = false;
    const onboardingUpdate: OnboardingStatusUpdate = {};

    const maybeAssignString = (
      key: keyof Pick<
        CompanySettings,
        | "companyName"
        | "ownerName"
        | "companyStreet"
        | "companyPostalCode"
        | "companyCity"
        | "companyEmail"
        | "companyPhone"
        | "companyWebsite"
        | "companyBankName"
        | "defaultBankAccountId"
        | "taxNumber"
        | "vatId"
        | "companyCountry"
        | "euVatNoticeText"
        | "senderCopyEmail"
        | "logoDataUrl"
        | "offerTermsText"
        | "lastOfferNumber"
        | "lastInvoiceNumber"
      >,
    ) => {
      const value = body[key];
      if (typeof value === "string") {
        sanitized[key] = value.trim();
        hasSettingsChanges = true;
      }
    };

    maybeAssignString("companyName");
    maybeAssignString("ownerName");
    maybeAssignString("companyStreet");
    maybeAssignString("companyPostalCode");
    maybeAssignString("companyCity");
    maybeAssignString("companyEmail");
    maybeAssignString("companyPhone");
    maybeAssignString("companyWebsite");
    maybeAssignString("companyBankName");
    maybeAssignString("defaultBankAccountId");
    maybeAssignString("taxNumber");
    maybeAssignString("vatId");
    maybeAssignString("companyCountry");
    maybeAssignString("euVatNoticeText");
    maybeAssignString("senderCopyEmail");
    maybeAssignString("logoDataUrl");
    maybeAssignString("offerTermsText");
    maybeAssignString("lastOfferNumber");
    maybeAssignString("lastInvoiceNumber");

    if (typeof body.companyIban === "string") {
      const trimmedIban = body.companyIban.trim();
      if (!trimmedIban) {
        sanitized.companyIban = "";
        sanitized.ibanVerificationStatus = "not_checked";
        hasSettingsChanges = true;
      } else {
        const ibanValidation = validateIbanInput(trimmedIban);
        if (!ibanValidation.isValid) {
          return NextResponse.json({ error: ibanValidation.message }, { status: 400 });
        }
        sanitized.companyIban = ibanValidation.formatted;
        sanitized.ibanVerificationStatus = "valid";
        hasSettingsChanges = true;
      }
    }

    if (typeof body.companyBic === "string") {
      sanitized.companyBic = normalizeBicInput(body.companyBic);
      hasSettingsChanges = true;
    }

    if (
      typeof body.companyIban !== "string" &&
      (body.ibanVerificationStatus === "not_checked" ||
        body.ibanVerificationStatus === "valid")
    ) {
      sanitized.ibanVerificationStatus = body.ibanVerificationStatus;
      hasSettingsChanges = true;
    }

    if (typeof body.vatRate !== "undefined") {
      const vatRate = Number(body.vatRate);
      if (Number.isFinite(vatRate)) {
        sanitized.vatRate = vatRate;
        hasSettingsChanges = true;
      }
    }

    if (typeof body.offerValidityDays !== "undefined") {
      const offerValidityDays = Number(body.offerValidityDays);
      if (Number.isFinite(offerValidityDays)) {
        sanitized.offerValidityDays = offerValidityDays;
        hasSettingsChanges = true;
      }
    }

    if (typeof body.invoicePaymentDueDays !== "undefined") {
      const invoicePaymentDueDays = Number(body.invoicePaymentDueDays);
      if (Number.isFinite(invoicePaymentDueDays)) {
        sanitized.invoicePaymentDueDays = invoicePaymentDueDays;
        hasSettingsChanges = true;
      }
    }

    if (Array.isArray(body.customServiceTypes)) {
      sanitized.customServiceTypes = body.customServiceTypes
        .map((item) => String(item).trim())
        .filter(Boolean);
      hasSettingsChanges = true;
    }

    if (Array.isArray(body.pdfTableColumns)) {
      sanitized.pdfTableColumns = body.pdfTableColumns;
      hasSettingsChanges = true;
    }

    if (Array.isArray(body.customServices)) {
      sanitized.customServices = body.customServices;
      hasSettingsChanges = true;
    }

    if (Array.isArray(body.additionalBankAccounts)) {
      sanitized.additionalBankAccounts = body.additionalBankAccounts;
      hasSettingsChanges = true;
    }

    if (typeof body.includeCustomerVatId === "boolean") {
      sanitized.includeCustomerVatId = body.includeCustomerVatId;
      hasSettingsChanges = true;
    }

    if (typeof body.onboardingCompleted === "boolean") {
      onboardingUpdate.onboardingCompleted = body.onboardingCompleted;
    }

    if (Object.prototype.hasOwnProperty.call(body, "onboardingCompletedAt")) {
      const onboardingCompletedAt = body.onboardingCompletedAt;
      if (typeof onboardingCompletedAt === "string" || onboardingCompletedAt === null) {
        onboardingUpdate.onboardingCompletedAt = onboardingCompletedAt;
      }
    }

    if (typeof body.onboardingStep !== "undefined") {
      const parsedStep = Number(body.onboardingStep);
      if (Number.isFinite(parsedStep)) {
        onboardingUpdate.onboardingStep = parsedStep;
      }
    }

    const shouldUpdateOnboarding = Object.keys(onboardingUpdate).length > 0;

    const settings = hasSettingsChanges
      ? await writeSettings(sanitized, {
          supabase: accessResult.supabase,
          userId: accessResult.user.id,
        })
      : await readSettings({
          supabase: accessResult.supabase,
          userId: accessResult.user.id,
        });

    if (
      onboardingUpdate.onboardingCompleted === true &&
      !hasCompletedOnboardingRequiredFields(settings)
    ) {
      const missingFields = getMissingOnboardingRequiredFields(settings);
      return NextResponse.json(
        {
          error:
            "Onboarding kann erst abgeschlossen werden, wenn alle Pflichtfelder ausgefüllt sind.",
          missingFields,
        },
        { status: 400 },
      );
    }

    const onboarding = shouldUpdateOnboarding
      ? await writeOnboardingStatus(onboardingUpdate, {
          supabase: accessResult.supabase,
          userId: accessResult.user.id,
        })
      : await readOnboardingStatus({
          supabase: accessResult.supabase,
          userId: accessResult.user.id,
        });

    return NextResponse.json(
      { settings, onboarding },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const classified = classifySettingsStoreError(error);
    console.error("[api/settings][POST] Einstellungen konnten nicht gespeichert werden.", {
      userId: accessResult.user.id,
      error,
    });
    return NextResponse.json(
      {
        error:
          classified.status === 503
            ? "Einstellungen-Speicher ist aktuell nicht vollständig eingerichtet."
            : "Einstellungen konnten nicht gespeichert werden.",
      },
      { status: classified.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
