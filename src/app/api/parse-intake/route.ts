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

type SupportedConversationLanguage = "de" | "en" | "tr" | "pl" | "ar";

const followUpPriority: string[] = [
  "companyName",
  "salutation",
  "firstName",
  "lastName",
  "street",
  "postalCode",
  "city",
  "customerEmail",
  "hours",
  "hourlyRate",
  "serviceDescription",
];

const followUpSpeechLocales: Record<SupportedConversationLanguage, string> = {
  de: "de-DE",
  en: "en-US",
  tr: "tr-TR",
  pl: "pl-PL",
  ar: "ar-SA",
};

const followUpPrompts: Record<
  SupportedConversationLanguage,
  Record<string, string>
> = {
  de: {
    companyName: "Wie lautet der Firmenname?",
    salutation: "Ist die Anrede Herr oder Frau?",
    firstName: "Wie lautet der Vorname?",
    lastName: "Wie lautet der Nachname?",
    street: "Wie lautet Straße und Hausnummer?",
    postalCode: "Wie lautet die Postleitzahl?",
    city: "Wie lautet der Ort?",
    customerEmail: "Wie lautet die E-Mail-Adresse?",
    hours: "Wie viele Stunden sollen berechnet werden?",
    hourlyRate: "Wie hoch ist der Stundensatz in Euro?",
    serviceDescription:
      "Möchtest du noch eine kurze Projektbeschreibung ergänzen?",
  },
  en: {
    companyName: "What is the company name?",
    salutation: "Should I use Mr. or Ms.?",
    firstName: "What is the first name?",
    lastName: "What is the last name?",
    street: "What is the street and house number?",
    postalCode: "What is the postal code?",
    city: "What is the city?",
    customerEmail: "What is the email address?",
    hours: "How many hours should I use?",
    hourlyRate: "What is the hourly rate in euro?",
    serviceDescription: "Do you want to add a short project description?",
  },
  tr: {
    companyName: "Firma adi nedir?",
    salutation: "Hitap sekli Bey mi Hanim mi?",
    firstName: "Ad nedir?",
    lastName: "Soyad nedir?",
    street: "Sokak ve kapi numarasi nedir?",
    postalCode: "Posta kodu nedir?",
    city: "Sehir nedir?",
    customerEmail: "E-posta adresi nedir?",
    hours: "Kac saat hesaplanacak?",
    hourlyRate: "Saatlik ucret kac euro?",
    serviceDescription: "Kisa bir proje aciklamasi eklemek ister misin?",
  },
  pl: {
    companyName: "Jaka jest nazwa firmy?",
    salutation: "Czy forma grzecznosciowa to Pan czy Pani?",
    firstName: "Jakie jest imie?",
    lastName: "Jakie jest nazwisko?",
    street: "Jaka jest ulica i numer domu?",
    postalCode: "Jaki jest kod pocztowy?",
    city: "Jakie jest miasto?",
    customerEmail: "Jaki jest adres e-mail?",
    hours: "Ile godzin mam przyjac?",
    hourlyRate: "Jaka jest stawka godzinowa w euro?",
    serviceDescription: "Czy chcesz dodac krotki opis projektu?",
  },
  ar: {
    companyName: "ما اسم الشركة؟",
    salutation: "هل صيغة المخاطبة السيد أم السيدة؟",
    firstName: "ما هو الاسم الأول؟",
    lastName: "ما هو اسم العائلة؟",
    street: "ما هو اسم الشارع ورقم المبنى؟",
    postalCode: "ما هو الرمز البريدي؟",
    city: "ما هي المدينة؟",
    customerEmail: "ما هو عنوان البريد الإلكتروني؟",
    hours: "كم عدد الساعات المطلوبة؟",
    hourlyRate: "ما هو سعر الساعة باليورو؟",
    serviceDescription: "هل تريد إضافة وصف قصير للمشروع؟",
  },
};

const EXPLICIT_SERVICE_DESCRIPTION_PATTERN =
  /\b(projektbeschreibung|leistungsbeschreibung|zusatzdetails?|zusatzinfo(?:s)?|beschreibung|details?|hinweise?|bemerkung(?:en)?|notiz(?:en)?)\b/i;

function normalizeCraftCompounds(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed
    .replace(/\bbeton\s+stahl\b/gi, "Betonstahl")
    .replace(/\bbeton\s+arbeit(en)?\b/gi, (_match, plural: string | undefined) => `Betonarbeit${plural ?? ""}`)
    .replace(/\btrocken\s+bau(?:\s+arbeiten)?\b/gi, (match) =>
      /arbeiten$/i.test(match) ? "Trockenbauarbeiten" : "Trockenbau"
    )
    .replace(/\belektro\s+installation\b/gi, "Elektroinstallation")
    .replace(/\bkabel\s+verlegung\b/gi, "Kabelverlegung")
    .replace(/\bfliesen\s+arbeit(en)?\b/gi, (_match, plural: string | undefined) => `Fliesenarbeit${plural ?? ""}`)
    .replace(/\b(?:waerme|wärme)\s+(?:daemmung|dämmung)\b/gi, "Wärmedämmung")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeServiceDescription(value: string | undefined, transcript: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const cleaned = normalizeCraftCompounds(value) ?? value.trim();
  if (cleaned.length < 3 || cleaned.length > 280) {
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

function normalizeGermanUmlauts(value: string): string {
  return value
    .replace(/ä/gi, "ae")
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ß/gi, "ss");
}

function normalizeSpokenDomain(value: string): string {
  return normalizeGermanUmlauts(value.toLowerCase())
    .replace(/\b(?:punkt|dot)\b/g, ".")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/\.+/g, ".")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function normalizeSpokenEmailCandidate(candidate: string): string | undefined {
  const normalizedCandidate = normalizeGermanUmlauts(candidate.toLowerCase())
    .replace(/\((?:at|@)\)/g, "@")
    .replace(/\[at\]/g, "@")
    .replace(/\b(?:at|ät|klammeraffe)\b/g, "@")
    .replace(/\b(?:punkt|dot)\b/g, ".")
    .replace(/\s+/g, "");

  const atIndex = normalizedCandidate.indexOf("@");
  if (atIndex <= 0) {
    return undefined;
  }

  const localPart = normalizedCandidate
    .slice(0, atIndex)
    .replace(/[^a-z0-9._%+-]/g, "")
    .replace(/\.+/g, ".");
  const domainPart = normalizeSpokenDomain(normalizedCandidate.slice(atIndex + 1));

  if (!localPart || !domainPart || !domainPart.includes(".")) {
    return undefined;
  }

  const tld = domainPart.slice(domainPart.lastIndexOf(".") + 1);
  if (tld.length < 2) {
    return undefined;
  }

  return `${localPart}@${domainPart}`;
}

function extractSpokenEmailFromTranscript(transcript: string): string | undefined {
  const directMatch = transcript.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  );
  if (directMatch?.[0]) {
    return directMatch[0];
  }

  const spokenMatch = transcript.match(
    /(?:e-?mail(?:adresse)?|mail(?:adresse)?|kunden-?mail)?\s*[:\-]?\s*([A-Za-zÄÖÜäöüß0-9._%+\- ]{1,60})\s+(?:at|ät|klammeraffe)\s+([A-Za-z0-9.-]+(?:\s*(?:punkt|dot|\.)\s*[A-Za-z0-9.-]+){1,4})/i,
  );
  if (!spokenMatch) {
    return undefined;
  }

  const localRaw = spokenMatch[1]
    .replace(/\b(?:meine|meiner|ist|lautet|und)\b/gi, " ")
    .trim()
    .split(/\s+/)
    .slice(-3)
    .join(" ");
  const domainRaw = spokenMatch[2].trim();

  if (!localRaw || !domainRaw) {
    return undefined;
  }

  return `${localRaw}@${domainRaw}`;
}

function buildEmailFromNameAndTranscriptDomain(input: {
  transcript: string;
  firstName?: string;
  lastName?: string;
}): string | undefined {
  const spokenDomainMatch = input.transcript.match(
    /(?:at|@|ät|klammeraffe)\s+([A-Za-z0-9.-]+(?:\s*(?:punkt|dot|\.)\s*[A-Za-z0-9.-]+){1,4})/i,
  );
  if (!spokenDomainMatch?.[1]) {
    return undefined;
  }

  const domain = normalizeSpokenDomain(spokenDomainMatch[1]);
  if (!domain || !domain.includes(".")) {
    return undefined;
  }

  const localRaw = `${input.firstName ?? ""}${input.lastName ?? ""}`;
  const local = normalizeGermanUmlauts(localRaw.toLowerCase()).replace(/[^a-z0-9._%+-]/g, "");
  if (!local) {
    return undefined;
  }

  return `${local}@${domain}`;
}

function normalizeCustomerEmail(input: {
  transcript: string;
  parsedEmail?: string;
  firstName?: string;
  lastName?: string;
}): string | undefined {
  const candidates = [
    input.parsedEmail,
    extractSpokenEmailFromTranscript(input.transcript),
    buildEmailFromNameAndTranscriptDomain(input),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalized = normalizeSpokenEmailCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function shouldAutofillServiceDescription(transcript: string): boolean {
  return EXPLICIT_SERVICE_DESCRIPTION_PATTERN.test(transcript);
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

function normalizeLanguageHint(
  hint: string | undefined,
): SupportedConversationLanguage | undefined {
  const normalized = hint?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith("de")) {
    return "de";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  if (normalized.startsWith("tr")) {
    return "tr";
  }
  if (normalized.startsWith("pl")) {
    return "pl";
  }
  if (normalized.startsWith("ar")) {
    return "ar";
  }
  return undefined;
}

function detectConversationLanguage(
  transcript: string,
  languageHint: string | undefined,
): SupportedConversationLanguage {
  if (/[\u0600-\u06FF]/.test(transcript)) {
    return "ar";
  }

  const lower = transcript.toLowerCase();
  const scoreByLanguage: Record<SupportedConversationLanguage, number> = {
    de: 0,
    en: 0,
    tr: 0,
    pl: 0,
    ar: 0,
  };

  const languagePatterns: Record<SupportedConversationLanguage, RegExp[]> = {
    de: [
      /\b(herr|frau|straße|strasse|angebot|rechnung|stunden|stundensatz|bitte)\b/gi,
      /\b(und|oder|mit|für)\b/gi,
    ],
    en: [
      /\b(offer|invoice|street|email|hours|price|please|mr|mrs)\b/gi,
      /\b(and|with|for|the)\b/gi,
    ],
    tr: [
      /\b(fiyat|saat|adres|teklif|fatura|e-?posta|lütfen)\b/gi,
      /\b(ve|icin|ile)\b/gi,
    ],
    pl: [
      /\b(oferta|faktura|adres|godzin|stawka|prosz[ęe]|mail)\b/gi,
      /\b(i|oraz|dla|z)\b/gi,
    ],
    ar: [],
  };

  (Object.keys(languagePatterns) as SupportedConversationLanguage[]).forEach(
    (language) => {
      const patterns = languagePatterns[language];
      for (const pattern of patterns) {
        const matches = lower.match(pattern);
        if (matches?.length) {
          scoreByLanguage[language] += matches.length;
        }
      }
    },
  );

  const bestMatch = (Object.entries(scoreByLanguage) as [
    SupportedConversationLanguage,
    number,
  ][]).sort((left, right) => right[1] - left[1])[0];

  if (bestMatch && bestMatch[1] > 0) {
    return bestMatch[0];
  }

  return normalizeLanguageHint(languageHint) ?? "de";
}

function buildFollowUpQuestion(
  missingFieldKeys: string[],
  language: SupportedConversationLanguage,
): string | undefined {
  if (!Array.isArray(missingFieldKeys) || missingFieldKeys.length === 0) {
    return undefined;
  }

  const prioritizedKey =
    followUpPriority.find((key) => missingFieldKeys.includes(key)) ??
    missingFieldKeys[0];
  if (!prioritizedKey) {
    return undefined;
  }

  return (
    followUpPrompts[language][prioritizedKey] ??
    followUpPrompts.de[prioritizedKey] ??
    undefined
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      transcript?: string;
      speechLanguageHint?: string;
    };
    const transcript = body.transcript?.trim() ?? "";

    if (transcript.length < 8) {
      return NextResponse.json({ error: "Bitte sprich etwas länger, damit ich die Angaben erkennen kann." }, { status: 400 });
    }

    const parsed = await parseOfferIntake(transcript);
    const customerType = parsed.fields.customerType ?? "person";
    const serviceDescriptionExplicitlyMentioned =
      shouldAutofillServiceDescription(transcript);
    const normalizedPositions = parsed.fields.positions?.map((position) => ({
      ...position,
      group: normalizeCraftCompounds(position.group) ?? position.group,
      description:
        normalizeCraftCompounds(position.description) ?? position.description,
    }));
    const normalizedEmail = normalizeCustomerEmail({
      transcript,
      parsedEmail: parsed.fields.customerEmail,
      firstName: parsed.fields.firstName,
      lastName: parsed.fields.lastName,
    });
    const normalizedFields = {
      ...parsed.fields,
      positions: normalizedPositions,
      customerEmail: normalizedEmail ?? parsed.fields.customerEmail,
      serviceDescription: serviceDescriptionExplicitlyMentioned
        ? sanitizeServiceDescription(
            normalizeCraftCompounds(parsed.fields.serviceDescription),
            transcript,
          )
        : undefined,
    };
    const hasPositions = Array.isArray(normalizedFields.positions) && normalizedFields.positions.length > 0;

    const baseRequired = [
      "street",
      "postalCode",
      "city",
      "customerEmail",
      "hours",
      "hourlyRate",
      ...(serviceDescriptionExplicitlyMentioned && !hasPositions
        ? ["serviceDescription"]
        : []),
    ];

    const recipientRequired = customerType === "company" ? ["companyName"] : ["salutation", "firstName", "lastName"];
    const requiredKeys = [...recipientRequired, ...baseRequired];

    const missingFieldKeys = requiredKeys.filter(
      (key) => !hasValue(normalizedFields[key as keyof typeof normalizedFields])
    );
    const missingFields = missingFieldKeys.map((key) => fieldLabels[key] || key);
    const detectedInputLanguage = detectConversationLanguage(
      transcript,
      body.speechLanguageHint,
    );
    const followUpQuestion = buildFollowUpQuestion(
      missingFieldKeys,
      detectedInputLanguage,
    );
    const shouldAskFollowUp = Boolean(followUpQuestion);

    return NextResponse.json({
      fields: {
        ...normalizedFields,
        customerType
      },
      missingFields,
      missingFieldKeys,
      detectedInputLanguage,
      shouldAskFollowUp,
      followUpQuestion: followUpQuestion ?? null,
      followUpSpeechLocale: followUpSpeechLocales[detectedInputLanguage],
      shouldAutofillServiceDescription: serviceDescriptionExplicitlyMentioned,
      usedFallback: parsed.usedFallback,
      fallbackReason: parsed.fallbackReason ?? null
    });
  } catch {
    return NextResponse.json({ error: "Sprachdaten konnten nicht verarbeitet werden." }, { status: 500 });
  }
}
