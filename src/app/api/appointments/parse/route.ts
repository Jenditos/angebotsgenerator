import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  parseAppointmentInput,
  toAppointmentDocumentContext,
} from "@/lib/appointment-parser";
import { listStoredCustomers } from "@/server/services/customer-store-service";
import { listStoredOfferRecords } from "@/server/services/offer-store-service";
import { listStoredProjects } from "@/server/services/project-store-service";
import { MAX_VOICE_TRANSCRIPT_LENGTH } from "@/lib/user-input";

type AppointmentParseRequestBody = {
  inputText?: unknown;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const body = (await request.json()) as AppointmentParseRequestBody;
    const inputText = asTrimmedString(body.inputText);
    if (inputText.length < 3) {
      return NextResponse.json(
        { error: "Bitte gib einen Termintext ein." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (inputText.length > MAX_VOICE_TRANSCRIPT_LENGTH) {
      return NextResponse.json(
        {
          error: `Bitte auf maximal ${MAX_VOICE_TRANSCRIPT_LENGTH.toLocaleString(
            "de-DE",
          )} Zeichen kürzen.`,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const [customers, projects, documents] = await Promise.all([
      listStoredCustomers(accessResult.user.id),
      listStoredProjects(accessResult.user.id),
      listStoredOfferRecords(accessResult.user.id),
    ]);

    const suggestion = parseAppointmentInput(inputText, {
      customers,
      projects,
      documents: documents.map(toAppointmentDocumentContext),
      now: new Date(),
    });

    return NextResponse.json(
      { suggestion },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Termintext konnte nicht analysiert werden." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
