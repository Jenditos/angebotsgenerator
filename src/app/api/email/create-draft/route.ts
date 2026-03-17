import { NextResponse } from "next/server";
import { createDraftViaConnectedMailbox } from "@/lib/email-sender";
import { EmailDraftPayload } from "@/types/email";

function isValidPayload(payload: Partial<EmailDraftPayload>): payload is EmailDraftPayload {
  return Boolean(
    payload.to?.trim() &&
      payload.subject?.trim() &&
      payload.text?.trim() &&
      payload.pdfBase64?.trim(),
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<EmailDraftPayload>;
    if (!isValidPayload(body)) {
      return NextResponse.json(
        { ok: false, reason: "failed", info: "Ungültige Entwurfsdaten." },
        { status: 400 },
      );
    }

    const result = await createDraftViaConnectedMailbox({
      to: body.to.trim(),
      subject: body.subject.trim(),
      text: body.text,
      pdfBase64: body.pdfBase64.trim(),
      filename: body.filename?.trim() || "angebot.pdf",
    });

    if (!result.ok) {
      const status = result.reason === "not_connected" ? 409 : 502;
      return NextResponse.json(result, { status });
    }

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
