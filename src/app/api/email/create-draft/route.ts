import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { createDraftViaConnectedMailbox } from "@/lib/email-sender";
import { isValidEmailAddress } from "@/lib/user-input";
import { createActivityLogEntry } from "@/server/services/activity-log-service";
import {
  findStoredOfferRecordByNumber,
  updateStoredOfferRecordEmailReference,
  updateStoredOfferRecordStatus,
} from "@/server/services/offer-store-service";
import { scheduleOfferFollowUpReminder } from "@/server/services/document-reminder-service";
import { EmailDraftPayload, EmailDraftResult } from "@/types/email";

function isValidPayload(payload: Partial<EmailDraftPayload>): payload is EmailDraftPayload {
  return Boolean(
    payload.to?.trim() &&
      isValidEmailAddress(payload.to) &&
      payload.subject?.trim() &&
      payload.text?.trim() &&
      payload.pdfBase64?.trim(),
  );
}

function normalizeIdempotencyKey(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function normalizeDocumentNumber(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function markEmailPreparedSafely(input: {
  userId: string;
  documentNumber: string;
  documentType: "offer" | "invoice";
  idempotencyKey: string;
  result: Extract<EmailDraftResult, { ok: true }>;
}): Promise<void> {
  if (!input.documentNumber) {
    return;
  }

  const now = new Date().toISOString();
  try {
    await updateStoredOfferRecordEmailReference(input.documentNumber, {
      status: "prepared",
      provider: input.result.provider,
      idempotencyKey: input.idempotencyKey || undefined,
      draftId: input.result.draftId,
      composeUrl: input.result.composeUrl,
      preparedAt: now,
      updatedAt: now,
    });
  } catch (error) {
    console.warn("[email/create-draft] email reference could not be updated", {
      documentNumber: input.documentNumber,
      error,
    });
  }

  try {
    await updateStoredOfferRecordStatus(input.documentNumber, "email_prepared");
  } catch (error) {
    console.warn("[email/create-draft] document status could not be updated", {
      documentNumber: input.documentNumber,
      error,
    });
  }

  try {
    await createActivityLogEntry({
      userId: input.userId,
      entityType: "email",
      entityId: input.documentNumber,
      action: "email_prepared",
      eventKey: input.idempotencyKey
        ? `${input.idempotencyKey}:email_prepared`
        : undefined,
      metadata: {
        documentType: input.documentType,
        provider: input.result.provider,
      },
    });
  } catch (error) {
    console.warn("[email/create-draft] activity could not be written", {
      documentNumber: input.documentNumber,
      error,
    });
  }

  try {
    await scheduleOfferFollowUpReminder({
      userId: input.userId,
      documentNumber: input.documentNumber,
      documentType: input.documentType,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    console.warn("[email/create-draft] reminder could not be scheduled", {
      documentNumber: input.documentNumber,
      error,
    });
  }
}

function buildReusableDraftResult(input: {
  documentNumber: string;
  idempotencyKey: string;
}): Promise<EmailDraftResult | null> {
  if (!input.documentNumber || !input.idempotencyKey) {
    return Promise.resolve(null);
  }

  return findStoredOfferRecordByNumber(input.documentNumber).then((record) => {
    const email = record?.email;
    if (
      email?.status !== "prepared" ||
      email.idempotencyKey !== input.idempotencyKey ||
      !email.composeUrl
    ) {
      return null;
    }

    return {
      ok: true,
      info: "E-Mail-Entwurf wurde bereits vorbereitet.",
      composeUrl: email.composeUrl,
      draftId: email.draftId,
      provider: email.provider,
    };
  });
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const body = (await request.json()) as Partial<EmailDraftPayload>;
    if (!isValidPayload(body)) {
      return NextResponse.json(
        {
          ok: false,
          reason: "failed",
          info: "Ungültige Entwurfsdaten oder E-Mail-Adresse.",
        },
        { status: 400 },
      );
    }

    const documentNumber = normalizeDocumentNumber(body.documentNumber);
    const documentType = body.documentType === "invoice" ? "invoice" : "offer";
    const idempotencyKey = normalizeIdempotencyKey(body.idempotencyKey);
    const reusableDraft = await buildReusableDraftResult({
      documentNumber,
      idempotencyKey,
    });
    if (reusableDraft) {
      return NextResponse.json(reusableDraft);
    }

    const result = await createDraftViaConnectedMailbox({
      to: body.to.trim(),
      subject: body.subject.trim(),
      text: body.text,
      pdfBase64: body.pdfBase64.trim(),
      filename: body.filename?.trim() || "angebot.pdf",
      documentNumber,
      documentType,
      idempotencyKey,
    });

    if (!result.ok) {
      const status = result.reason === "not_connected" ? 409 : 502;
      return NextResponse.json(result, { status });
    }

    await markEmailPreparedSafely({
      userId: accessResult.user.id,
      documentNumber,
      documentType,
      idempotencyKey,
      result,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        reason: "failed",
        info: "Entwurf konnte nicht erstellt werden.",
      },
      { status: 500 },
    );
  }
}
