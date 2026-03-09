import OpenAI from "openai";
import { OfferPromptInput, OfferText } from "@/types/offer";

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (!client) {
    client = new OpenAI({ apiKey });
  }

  return client;
}

function fallbackOffer(input: OfferPromptInput): OfferText {
  const laborCost = input.hours * input.hourlyRate;
  const total = laborCost + input.materialCost;

  return {
    subject: `Angebot für ${input.customerName}`,
    intro: `Sehr geehrte/r ${input.customerName},\n\nvielen Dank für Ihre Anfrage. Gern unterbreiten wir Ihnen folgendes Angebot.`,
    details:
      `Leistung: ${input.serviceDescription}\n` +
      `Arbeitszeit: ${input.hours} x ${input.hourlyRate.toFixed(2)} EUR = ${laborCost.toFixed(2)} EUR\n` +
      `Materialkosten: ${input.materialCost.toFixed(2)} EUR\n` +
      `Gesamtpreis: ${total.toFixed(2)} EUR (zzgl. MwSt.)`,
    closing: "Dieses Angebot ist 14 Tage gültig."
  };
}

function isValidOfferText(value: Partial<OfferText>): value is OfferText {
  return Boolean(value.subject && value.intro && value.details && value.closing);
}

export type ParsedIntakeFields = {
  customerType?: "person" | "company";
  companyName?: string;
  salutation?: "herr" | "frau";
  firstName?: string;
  lastName?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  customerEmail?: string;
  serviceDescription?: string;
  hours?: number;
  hourlyRate?: number;
  materialCost?: number;
};

export type IntakeParseResult = {
  fields: ParsedIntakeFields;
  usedFallback: boolean;
  fallbackReason?: "no_api_key" | "model_error";
};

function normalizeNumberValue(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input !== "string") {
    return undefined;
  }

  const cleaned = input.replace(",", ".").replace(/[^\d.-]/g, "").trim();
  if (!cleaned) {
    return undefined;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTextValue(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = input.trim();
  return value ? value : undefined;
}

function toParsedFields(input: Record<string, unknown>): ParsedIntakeFields {
  const customerTypeRaw = normalizeTextValue(input.customerType)?.toLowerCase();
  const salutationRaw = normalizeTextValue(input.salutation)?.toLowerCase();

  return {
    customerType: customerTypeRaw === "company" || customerTypeRaw === "firma" ? "company" : customerTypeRaw === "person" ? "person" : undefined,
    companyName: normalizeTextValue(input.companyName),
    salutation: salutationRaw === "frau" ? "frau" : salutationRaw === "herr" ? "herr" : undefined,
    firstName: normalizeTextValue(input.firstName),
    lastName: normalizeTextValue(input.lastName),
    street: normalizeTextValue(input.street),
    postalCode: normalizeTextValue(input.postalCode),
    city: normalizeTextValue(input.city),
    customerEmail: normalizeTextValue(input.customerEmail),
    serviceDescription: normalizeTextValue(input.serviceDescription),
    hours: normalizeNumberValue(input.hours),
    hourlyRate: normalizeNumberValue(input.hourlyRate),
    materialCost: normalizeNumberValue(input.materialCost)
  };
}

function fallbackParseIntake(transcript: string): ParsedIntakeFields {
  const text = transcript.trim();
  const lower = text.toLowerCase();
  const parsed: ParsedIntakeFields = {};

  if (/\b(gmbh|ug|ag|kg|ohg|e\.k\.?|firma|unternehmen)\b/i.test(text)) {
    parsed.customerType = "company";
  } else if (/\b(herr|frau)\b/i.test(text)) {
    parsed.customerType = "person";
  }

  if (/\bfrau\b/i.test(text)) {
    parsed.salutation = "frau";
  } else if (/\bherr\b/i.test(text)) {
    parsed.salutation = "herr";
  }

  const companyMatch =
    text.match(/(?:firma|unternehmen)\s+([^\n,.;]+)/i) ||
    text.match(/\b([A-ZÄÖÜ][\w&\-. ]{2,}\s(?:GmbH|UG|AG|KG|OHG|e\.K\.?))\b/);
  if (companyMatch?.[1]) {
    parsed.companyName = companyMatch[1].trim();
  }

  const nameMatch = text.match(/\b(herr|frau)\s+([A-ZÄÖÜ][a-zäöüß-]+)(?:\s+([A-ZÄÖÜ][a-zäöüß-]+))?/i);
  if (nameMatch) {
    parsed.firstName = nameMatch[2];
    if (nameMatch[3]) {
      parsed.lastName = nameMatch[3];
    }
  }

  const emailMatch = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (emailMatch) {
    parsed.customerEmail = emailMatch[0];
  }

  const postalCityMatch = text.match(/\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{2,})/);
  if (postalCityMatch) {
    parsed.postalCode = postalCityMatch[1];
    parsed.city = postalCityMatch[2].trim();
  }

  const streetMatch = text.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{2,}(?:straße|strasse|weg|allee|platz|gasse|ring|ufer|damm|chaussee)\s+\d+[a-zA-Z]?)\b/i);
  if (streetMatch) {
    parsed.street = streetMatch[1].trim();
  }

  const hoursMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:stunden|stunde|std\b)/i);
  if (hoursMatch) {
    parsed.hours = normalizeNumberValue(hoursMatch[1]);
  }

  const hourlyRateMatch = text.match(/(?:stundensatz|pro\s+stunde|je\s+stunde)[^\d]*(\d+(?:[.,]\d+)?)/i);
  if (hourlyRateMatch) {
    parsed.hourlyRate = normalizeNumberValue(hourlyRateMatch[1]);
  } else {
    const eurPerHourMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:€|eur|euro)\s*(?:pro|\/)\s*(?:stunde|std)/i);
    if (eurPerHourMatch) {
      parsed.hourlyRate = normalizeNumberValue(eurPerHourMatch[1]);
    }
  }

  const materialMatch = text.match(/(?:material(?:kosten)?|material)\D*(\d+(?:[.,]\d+)?)/i);
  if (materialMatch) {
    parsed.materialCost = normalizeNumberValue(materialMatch[1]);
  }

  const serviceStart = lower.indexOf("leistung");
  if (serviceStart >= 0) {
    const segment = text.slice(serviceStart).split("\n")[0];
    const cleaned = segment.replace(/leistung\s*:?\s*/i, "").trim();
    if (cleaned) {
      parsed.serviceDescription = cleaned;
    }
  }

  return parsed;
}

export async function generateOfferText(input: OfferPromptInput): Promise<OfferText> {
  const openai = getClient();
  if (!openai) {
    return fallbackOffer(input);
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Du erstellst professionelle deutsche Angebote für Handwerksbetriebe. Antworte nur mit valide JSON."
      },
      {
        role: "user",
        content: `
Erstelle ein professionelles Angebot auf Deutsch mit diesen Daten:
Kunde: ${input.customerName}
Adresse: ${input.customerAddress}
Leistung: ${input.serviceDescription}
Stunden: ${input.hours}
Stundensatz: ${input.hourlyRate}
Materialkosten: ${input.materialCost}

Antworte im JSON-Schema:
{
  "subject": "Betreff",
  "intro": "Einleitung",
  "details": "Details inkl. Kostenaufschlüsselung",
  "closing": "Abschluss"
}
`
      }
    ]
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return fallbackOffer(input);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OfferText>;
    if (isValidOfferText(parsed)) {
      return parsed;
    }
    return fallbackOffer(input);
  } catch {
    return fallbackOffer(input);
  }
}

export async function parseOfferIntake(transcript: string): Promise<IntakeParseResult> {
  const openai = getClient();
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) {
    return { fields: {}, usedFallback: true, fallbackReason: "model_error" };
  }

  if (!openai) {
    return {
      fields: fallbackParseIntake(cleanTranscript),
      usedFallback: true,
      fallbackReason: "no_api_key"
    };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extrahiere aus deutschem Spracheingabe-Text strukturierte Angebotsdaten. Antworte ausschließlich als JSON. Gib serviceDescription nur als kurze Leistungsbeschreibung aus (maximal 80 Zeichen), niemals als kompletten Original-Transkripttext."
        },
        {
          role: "user",
          content: `Extrahiere aus diesem Text so viele Felder wie möglich:
${cleanTranscript}

Antwort-JSON-Schema:
{
  "customerType": "person|company|null",
  "companyName": "string|null",
  "salutation": "herr|frau|null",
  "firstName": "string|null",
  "lastName": "string|null",
  "street": "string|null",
  "postalCode": "string|null",
  "city": "string|null",
  "customerEmail": "string|null",
  "serviceDescription": "string|null",
  "hours": "number|null",
  "hourlyRate": "number|null",
  "materialCost": "number|null"
}`
        }
      ]
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return {
        fields: fallbackParseIntake(cleanTranscript),
        usedFallback: true,
        fallbackReason: "model_error"
      };
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fields = toParsedFields(parsed);

    return {
      fields,
      usedFallback: false
    };
  } catch {
    return {
      fields: fallbackParseIntake(cleanTranscript),
      usedFallback: true,
      fallbackReason: "model_error"
    };
  }
}
