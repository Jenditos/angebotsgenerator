import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { createActivityLogEntry } from "@/server/services/activity-log-service";
import {
  findStoredOfferRecordByNumber,
  updateStoredOfferRecordPaymentReference,
} from "@/server/services/offer-store-service";
import {
  DOCUMENT_PAYMENT_STATUS_VALUES,
  DocumentPaymentStatus,
} from "@/types/offer";

type UpdatePaymentBody = {
  paymentStatus?: unknown;
  paymentProvider?: unknown;
  paymentReference?: unknown;
  paidAt?: unknown;
};

function isPaymentStatus(value: unknown): value is DocumentPaymentStatus {
  return DOCUMENT_PAYMENT_STATUS_VALUES.includes(value as DocumentPaymentStatus);
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePaidAt(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value.trim());
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString();
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentNumber: string }> },
) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const params = await context.params;
    const documentNumber = decodeURIComponent(
      params.documentNumber ?? "",
    ).trim();
    if (!documentNumber) {
      return NextResponse.json(
        { error: "Dokumentnummer fehlt." },
        { status: 400 },
      );
    }

    const existingRecord = await findStoredOfferRecordByNumber(
      accessResult.user.id,
      documentNumber,
    );
    if (!existingRecord) {
      return NextResponse.json(
        { error: "Dokument wurde nicht gefunden." },
        { status: 404 },
      );
    }
    if ((existingRecord.documentType ?? "offer") !== "invoice") {
      return NextResponse.json(
        { error: "Zahlungsstatus kann nur für Rechnungen gesetzt werden." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as UpdatePaymentBody;
    if (!isPaymentStatus(body.paymentStatus)) {
      return NextResponse.json(
        { error: "Ungültiger Zahlungsstatus." },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();
    const paidAt =
      body.paymentStatus === "paid"
        ? normalizePaidAt(body.paidAt) ?? nowIso
        : undefined;

    const updatedRecord = await updateStoredOfferRecordPaymentReference(
      documentNumber,
      accessResult.user.id,
      {
        status: body.paymentStatus,
        provider: normalizeOptionalText(body.paymentProvider) ?? "manual",
        reference: normalizeOptionalText(body.paymentReference),
        paidAt,
        updatedAt: nowIso,
      },
    );
    if (!updatedRecord) {
      return NextResponse.json(
        { error: "Zahlungsstatus konnte nicht aktualisiert werden." },
        { status: 404 },
      );
    }

    try {
      await createActivityLogEntry({
        userId: accessResult.user.id,
        entityType: "document",
        entityId: documentNumber,
        action: "payment_recorded",
        metadata: {
          paymentStatus: body.paymentStatus,
          paymentProvider: normalizeOptionalText(body.paymentProvider) ?? "manual",
          paymentReference: normalizeOptionalText(body.paymentReference),
          paidAt: paidAt ?? null,
        },
      });
    } catch (error) {
      console.warn("[payment] activity could not be written", {
        documentNumber,
        error,
      });
    }

    return NextResponse.json({
      ok: true,
      documentNumber: updatedRecord.offerNumber,
      paymentStatus: updatedRecord.payment?.status ?? null,
      paidAt: updatedRecord.payment?.paidAt ?? null,
      updatedAt: updatedRecord.payment?.updatedAt ?? nowIso,
    });
  } catch {
    return NextResponse.json(
      { error: "Zahlungsstatus konnte nicht aktualisiert werden." },
      { status: 500 },
    );
  }
}
