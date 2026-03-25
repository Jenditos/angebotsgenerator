import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { readSettings, writeSettings } from "@/lib/settings-store";
import { CompanySettings } from "@/types/offer";

export async function GET() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const settings = await readSettings();
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json(
      { error: "Einstellungen konnten nicht geladen werden." },
      { status: 500 },
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
    maybeAssignString("taxNumber");
    maybeAssignString("vatId");
    maybeAssignString("companyCountry");
    maybeAssignString("euVatNoticeText");
    maybeAssignString("senderCopyEmail");
    maybeAssignString("logoDataUrl");
    maybeAssignString("offerTermsText");
    maybeAssignString("lastOfferNumber");
    maybeAssignString("lastInvoiceNumber");

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

    const settings = await writeSettings(sanitized);
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json(
      { error: "Einstellungen konnten nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
