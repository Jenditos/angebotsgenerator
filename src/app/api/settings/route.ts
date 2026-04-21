import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  normalizeBicInput,
  validateIbanInput,
} from "@/lib/iban";
import { readSettings, writeSettings } from "@/lib/settings-store";
import { CompanySettings } from "@/types/offer";

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
    const settings = await readSettings({
      supabase: accessResult.supabase,
      userId: accessResult.user.id,
    });
    return NextResponse.json(
      { settings },
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
        ? (rawBody as Partial<CompanySettings>)
        : {};

    const sanitized: Partial<CompanySettings> = {};

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
      } else {
        const ibanValidation = validateIbanInput(trimmedIban);
        if (!ibanValidation.isValid) {
          return NextResponse.json({ error: ibanValidation.message }, { status: 400 });
        }
        sanitized.companyIban = ibanValidation.formatted;
        sanitized.ibanVerificationStatus = "valid";
      }
    }

    if (typeof body.companyBic === "string") {
      sanitized.companyBic = normalizeBicInput(body.companyBic);
    }

    if (
      typeof body.companyIban !== "string" &&
      (body.ibanVerificationStatus === "not_checked" ||
        body.ibanVerificationStatus === "valid")
    ) {
      sanitized.ibanVerificationStatus = body.ibanVerificationStatus;
    }

    if (typeof body.vatRate !== "undefined") {
      const vatRate = Number(body.vatRate);
      if (Number.isFinite(vatRate)) {
        sanitized.vatRate = vatRate;
      }
    }

    if (typeof body.offerValidityDays !== "undefined") {
      const offerValidityDays = Number(body.offerValidityDays);
      if (Number.isFinite(offerValidityDays)) {
        sanitized.offerValidityDays = offerValidityDays;
      }
    }

    if (typeof body.invoicePaymentDueDays !== "undefined") {
      const invoicePaymentDueDays = Number(body.invoicePaymentDueDays);
      if (Number.isFinite(invoicePaymentDueDays)) {
        sanitized.invoicePaymentDueDays = invoicePaymentDueDays;
      }
    }

    if (Array.isArray(body.customServiceTypes)) {
      sanitized.customServiceTypes = body.customServiceTypes
        .map((item) => String(item).trim())
        .filter(Boolean);
    }

    if (Array.isArray(body.pdfTableColumns)) {
      sanitized.pdfTableColumns = body.pdfTableColumns;
    }

    if (Array.isArray(body.customServices)) {
      sanitized.customServices = body.customServices;
    }

    if (typeof body.includeCustomerVatId === "boolean") {
      sanitized.includeCustomerVatId = body.includeCustomerVatId;
    }

    const settings = await writeSettings(sanitized, {
      supabase: accessResult.supabase,
      userId: accessResult.user.id,
    });
    return NextResponse.json(
      { settings },
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
