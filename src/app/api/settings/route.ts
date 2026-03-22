import { NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/settings-store";
import { CompanySettings } from "@/types/offer";

export async function GET() {
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
  try {
    const body = (await request.json()) as Partial<CompanySettings>;

    const sanitized: Partial<CompanySettings> = {
      companyName: body.companyName?.trim() ?? "",
      ownerName: body.ownerName?.trim() ?? "",
      companyStreet: body.companyStreet?.trim() ?? "",
      companyPostalCode: body.companyPostalCode?.trim() ?? "",
      companyCity: body.companyCity?.trim() ?? "",
      companyEmail: body.companyEmail?.trim() ?? "",
      companyPhone: body.companyPhone?.trim() ?? "",
      companyWebsite: body.companyWebsite?.trim() ?? "",
      senderCopyEmail: body.senderCopyEmail?.trim() ?? "",
      logoDataUrl: body.logoDataUrl?.trim() ?? "",
      vatRate: Number(body.vatRate),
      offerValidityDays: Number(body.offerValidityDays),
      invoicePaymentDueDays: Number(body.invoicePaymentDueDays),
      offerTermsText: body.offerTermsText?.trim() ?? "",
      lastOfferNumber: body.lastOfferNumber?.trim() ?? "",
      lastInvoiceNumber: body.lastInvoiceNumber?.trim() ?? "",
      customServiceTypes: Array.isArray(body.customServiceTypes)
        ? body.customServiceTypes
            .map((item) => String(item).trim())
            .filter(Boolean)
        : [],
    };

    if (Array.isArray(body.pdfTableColumns)) {
      sanitized.pdfTableColumns = body.pdfTableColumns;
    }

    if (Array.isArray(body.customServices)) {
      sanitized.customServices = body.customServices;
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
