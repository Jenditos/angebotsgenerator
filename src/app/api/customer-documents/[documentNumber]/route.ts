import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { requireAppAccess } from "@/lib/access/guards";
import { MAX_LOGO_DATA_URL_LENGTH } from "@/lib/logo-config";
import { OfferPdfDocument } from "@/lib/pdf";
import { readSettings } from "@/lib/settings-store";
import { findStoredOfferRecordByNumber } from "@/server/services/offer-store-service";

function toSafeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function GET(
  _request: Request,
  context: { params: { documentNumber: string } },
) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const rawDocumentNumber = decodeURIComponent(
      context.params.documentNumber ?? "",
    ).trim();
    if (!rawDocumentNumber) {
      return NextResponse.json(
        { error: "Dokumentnummer fehlt." },
        { status: 400 },
      );
    }

    const record = await findStoredOfferRecordByNumber(rawDocumentNumber);
    if (!record) {
      return NextResponse.json(
        { error: "Dokument wurde nicht gefunden." },
        { status: 404 },
      );
    }

    const settings = await readSettings();
    const safeSettings = {
      ...settings,
      logoDataUrl:
        typeof settings.logoDataUrl === "string" &&
        settings.logoDataUrl.length <= MAX_LOGO_DATA_URL_LENGTH
          ? settings.logoDataUrl
          : "",
    };
    const resolvedDocumentType =
      record.documentType === "invoice" ? "invoice" : "offer";
    const documentNumber = record.offerNumber.trim() || rawDocumentNumber;

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderToBuffer(
        OfferPdfDocument({
          offer: record.offer,
          offerNumber: documentNumber,
          documentType: resolvedDocumentType,
          customerNumber: record.customerNumber?.trim() || undefined,
          createdAt: record.createdAt,
          paymentDueDays:
            resolvedDocumentType === "invoice"
              ? settings.invoicePaymentDueDays
              : undefined,
          customerName: record.customerName,
          customerAddress: record.customerAddress,
          customerEmail: record.customerEmail,
          serviceDescription: record.serviceDescription,
          projectDetails: record.serviceDescription,
          lineItems: record.lineItems,
          settings: safeSettings,
        }),
      );
    } catch {
      pdfBuffer = await renderToBuffer(
        OfferPdfDocument({
          offer: record.offer,
          offerNumber: documentNumber,
          documentType: resolvedDocumentType,
          customerNumber: record.customerNumber?.trim() || undefined,
          createdAt: record.createdAt,
          paymentDueDays:
            resolvedDocumentType === "invoice"
              ? settings.invoicePaymentDueDays
              : undefined,
          customerName: record.customerName,
          customerAddress: record.customerAddress,
          customerEmail: record.customerEmail,
          serviceDescription: record.serviceDescription,
          projectDetails: record.serviceDescription,
          lineItems: record.lineItems,
          settings: {
            ...safeSettings,
            logoDataUrl: "",
          },
        }),
      );
    }

    const filename = `${toSafeFilename(documentNumber)}.pdf`;
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Dokument konnte nicht geöffnet werden." },
      { status: 500 },
    );
  }
}
