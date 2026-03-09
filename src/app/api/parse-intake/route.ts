import { NextResponse } from "next/server";
import { parseOfferIntake } from "@/lib/openai";

const fieldLabels: Record<string, string> = {
  companyName: "Firma",
  salutation: "Anrede",
  firstName: "Vorname",
  lastName: "Nachname",
  street: "Straße",
  postalCode: "PLZ",
  city: "Ort",
  customerEmail: "Kunden-E-Mail",
  serviceDescription: "Leistung",
  hours: "Stunden",
  hourlyRate: "Stundensatz",
  materialCost: "Materialkosten"
};

function sanitizeServiceDescription(value: string | undefined, transcript: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = value.trim();
  if (cleaned.length < 3 || cleaned.length > 140) {
    return undefined;
  }

  const normalizedValue = cleaned.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedTranscript = transcript.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalizedTranscript) {
    return cleaned;
  }

  if (normalizedValue === normalizedTranscript) {
    return undefined;
  }

  const wordCount = normalizedValue.split(" ").filter(Boolean).length;
  if (normalizedTranscript.includes(normalizedValue) && wordCount > 16) {
    return undefined;
  }

  return cleaned;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { transcript?: string };
    const transcript = body.transcript?.trim() ?? "";

    if (transcript.length < 8) {
      return NextResponse.json({ error: "Bitte sprich etwas länger, damit ich die Angaben erkennen kann." }, { status: 400 });
    }

    const parsed = await parseOfferIntake(transcript);
    const customerType = parsed.fields.customerType ?? "person";
    const normalizedFields = {
      ...parsed.fields,
      serviceDescription: sanitizeServiceDescription(parsed.fields.serviceDescription, transcript)
    };

    const baseRequired = [
      "street",
      "postalCode",
      "city",
      "customerEmail",
      "serviceDescription",
      "hours",
      "hourlyRate",
      "materialCost"
    ];

    const recipientRequired = customerType === "company" ? ["companyName"] : ["salutation", "firstName", "lastName"];
    const requiredKeys = [...recipientRequired, ...baseRequired];

    const missingFieldKeys = requiredKeys.filter(
      (key) => !hasValue(normalizedFields[key as keyof typeof normalizedFields])
    );
    const missingFields = missingFieldKeys.map((key) => fieldLabels[key] || key);

    return NextResponse.json({
      fields: {
        ...normalizedFields,
        customerType
      },
      missingFields,
      missingFieldKeys,
      usedFallback: parsed.usedFallback,
      fallbackReason: parsed.fallbackReason ?? null
    });
  } catch {
    return NextResponse.json({ error: "Sprachdaten konnten nicht verarbeitet werden." }, { status: 500 });
  }
}
