import OpenAI from "openai";
import { normalizeDocumentTaxInfo } from "@/lib/document-tax";
import { getSeedServices, normalizeSearchValue } from "@/lib/service-catalog";
import { DocumentTaxInfo, OfferPromptInput, OfferText } from "@/types/offer";

let client: OpenAI | null = null;
const OFFER_DEBUG_LOGS_ENABLED = process.env.OFFER_DEBUG_LOGS === "1";
const KNOWN_SERVICE_LABELS = Array.from(
  new Set(getSeedServices().map((service) => service.label)),
).sort((left, right) => right.length - left.length);
const ADDRESS_JOINER_WORDS = new Set([
  "am",
  "an",
  "auf",
  "bei",
  "hinter",
  "im",
  "in",
  "neben",
  "ober",
  "unter",
  "vor",
  "vom",
  "zum",
  "zur",
]);
const CITY_STOPWORDS = new Set([
  "aber",
  "bitte",
  "ep",
  "euro",
  "eur",
  "für",
  "ja",
  "kilogramm",
  "material",
  "materialkosten",
  "mit",
  "oder",
  "ohne",
  "preis",
  "pro",
  "stunden",
  "stundensatz",
  "und",
]);
const POSITION_DESCRIPTION_BLOCKLIST = new Set([
  "anrede",
  "email",
  "kunden e mail",
  "kunden email",
  "material",
  "materialkosten",
  "ort",
  "plz",
  "stundensatz",
  "strasse",
]);
const MAX_PARSED_POSITIONS = 60;
const UNIT_TOKEN_PATTERN =
  "(?:stück|stueck|stk|m²|m2|qm|quadrat\\s*meter(?:n)?|quadratmeter(?:n)?|m³|m3|cbm|kubik\\s*meter(?:n)?|kubikmeter(?:n)?|meter(?:n)?|m|kilogramm|kg|tonnen?|t|liter|l|std|stunde|stunden|h|tage?|tag|pauschal(?:e)?|psch\\.?)";
const NUMBER_WORDS: Record<string, number> = {
  null: 0,
  zero: 0,
  eins: 1,
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fuenf: 5,
  funf: 5,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwoelf: 12,
  zwölf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fuenfzehn: 15,
  fünfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
  zwanzig: 20,
  dreissig: 30,
  dreißig: 30,
  vierzig: 40,
  fuenfzig: 50,
  fünfzig: 50,
  sechzig: 60,
  siebzig: 70,
  achtzig: 80,
  neunzig: 90,
};
const DIGIT_WORDS: Record<string, string> = {
  null: "0",
  zero: "0",
  eins: "1",
  ein: "1",
  eine: "1",
  zwei: "2",
  drei: "3",
  vier: "4",
  fuenf: "5",
  funf: "5",
  fünf: "5",
  sechs: "6",
  sieben: "7",
  acht: "8",
  neun: "9",
};

function normalizeGermanUmlauts(value: string): string {
  return value
    .replace(/ä/gi, "ae")
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ß/gi, "ss");
}

function parseGermanNumberToken(token: string): number | undefined {
  const normalized = normalizeGermanUmlauts(token.toLowerCase()).trim();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+(?:[.,]\d+)?$/.test(normalized)) {
    const direct = Number(normalized.replace(",", "."));
    return Number.isFinite(direct) ? direct : undefined;
  }

  if (normalized in NUMBER_WORDS) {
    return NUMBER_WORDS[normalized];
  }

  const undMatch = normalized.match(
    /^(ein|eins|zwei|drei|vier|fuenf|funf|sechs|sieben|acht|neun)und(zwanzig|dreissig|vierzig|fuenfzig|sechzig|siebzig|achtzig|neunzig)$/,
  );
  if (undMatch) {
    const ones = NUMBER_WORDS[undMatch[1]];
    const tens = NUMBER_WORDS[undMatch[2]];
    if (ones !== undefined && tens !== undefined) {
      return ones + tens;
    }
  }

  if (normalized.endsWith("hundert")) {
    const prefix = normalized.replace(/hundert$/, "");
    const prefixValue = prefix ? parseGermanNumberToken(prefix) : 1;
    if (prefixValue !== undefined) {
      return prefixValue * 100;
    }
  }

  if (normalized.endsWith("tausend")) {
    const prefix = normalized.replace(/tausend$/, "");
    const prefixValue = prefix ? parseGermanNumberToken(prefix) : 1;
    if (prefixValue !== undefined) {
      return prefixValue * 1000;
    }
  }

  return undefined;
}

function parseSpokenNumberText(value: string): number | undefined {
  const normalized = normalizeGermanUmlauts(value.toLowerCase())
    .replace(/[^\w\s.,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.includes("komma") || normalized.includes("punkt")) {
    const decimalMatch = normalized.match(/^(.*?)\s+(?:komma|punkt)\s+(.*)$/);
    if (decimalMatch) {
      const leftValue = parseSpokenNumberText(decimalMatch[1].trim());
      if (leftValue === undefined) {
        return undefined;
      }

      const rightTokens = decimalMatch[2]
        .trim()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
      if (rightTokens.length === 0) {
        return leftValue;
      }

      const decimalDigits = rightTokens
        .map((token) => {
          const normalizedToken = normalizeGermanUmlauts(token.toLowerCase());
          if (normalizedToken in DIGIT_WORDS) {
            return DIGIT_WORDS[normalizedToken];
          }
          if (/^\d$/.test(normalizedToken)) {
            return normalizedToken;
          }
          return "";
        })
        .join("");

      if (!decimalDigits) {
        return leftValue;
      }

      const decimalValue = Number(`${leftValue}.${decimalDigits}`);
      return Number.isFinite(decimalValue) ? decimalValue : leftValue;
    }
  }

  if (/^\d+(?:[.,]\d+)?$/.test(normalized)) {
    const direct = Number(normalized.replace(",", "."));
    return Number.isFinite(direct) ? direct : undefined;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return undefined;
  }

  let total = 0;
  let current = 0;

  for (const token of tokens) {
    if (token === "und") {
      continue;
    }

    if (token === "hundert") {
      current = (current || 1) * 100;
      continue;
    }

    if (token === "tausend") {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }

    const tokenValue = parseGermanNumberToken(token);
    if (tokenValue === undefined) {
      return undefined;
    }

    current += tokenValue;
  }

  const result = total + current;
  if (result === 0 && !tokens.some((token) => token === "null" || token === "zero")) {
    return undefined;
  }

  return result;
}

function normalizeTranscriptForPositionExtraction(transcript: string): string {
  const withNormalizedNumbers = transcript.replace(
    /\b([A-Za-zÄÖÜäöüß]+)\b/g,
    (token) => {
      const numberValue = parseGermanNumberToken(token);
      if (numberValue === undefined) {
        return token;
      }
      return String(numberValue);
    },
  );

  return withNormalizedNumbers
    .replace(/(\d+)\s*(?:komma|punkt)\s*(\d+)/gi, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
}

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

function debugOfferTextLog(stage: string, payload?: Record<string, unknown>) {
  if (!OFFER_DEBUG_LOGS_ENABLED) {
    return;
  }

  if (payload) {
    console.info(`[generate-offer-text] ${stage}`, payload);
    return;
  }

  console.info(`[generate-offer-text] ${stage}`);
}

function isValidOfferText(value: Partial<OfferText>): value is OfferText {
  return Boolean(value.subject && value.intro && value.details && value.closing);
}

export type ParsedIntakeFields = {
  positions?: ParsedIntakePosition[];
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

export type ParsedIntakePosition = {
  group?: string;
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
};

export type ParsedIntakeTimeCalculation = {
  laborHours?: number;
  laborDescription?: string;
  workers?: number;
  hourlyRate?: number;
  notes?: string;
};

export type ParsedIntakeDocument = {
  type: "offer" | "invoice" | "unknown";
  title?: string;
  notes?: string;
};

export type ParsedIntakeAppointment = {
  date?: string;
  time?: string;
};

export type ParsedIntakeConfidence = {
  customer?: number;
  items?: number;
  document?: number;
};

export type IntakeParseResult = {
  fields: ParsedIntakeFields;
  timeCalculation?: ParsedIntakeTimeCalculation;
  tax?: DocumentTaxInfo;
  usedFallback: boolean;
  fallbackReason?: "no_api_key" | "model_error";
  sourceText?: string;
  ignoredText?: string[];
  confidence?: ParsedIntakeConfidence;
  needsReview?: boolean;
  document?: ParsedIntakeDocument;
  appointment?: ParsedIntakeAppointment;
};

function normalizeNumberValue(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input !== "string") {
    return undefined;
  }

  const normalizedInput = normalizeGermanUmlauts(input);
  const cleaned = normalizedInput.replace(",", ".").replace(/[^\d.-]/g, "").trim();
  if (!cleaned) {
    return parseSpokenNumberText(normalizedInput);
  }

  const parsed = Number(cleaned);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return parseSpokenNumberText(normalizedInput);
}

function normalizeTextValue(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = input.trim();
  return value ? value : undefined;
}

function normalizeUnitLabel(value: unknown): string | undefined {
  const raw = normalizeTextValue(value);
  if (!raw) {
    return undefined;
  }

  const compact = normalizeGermanUmlauts(raw.toLowerCase())
    .replace(/\s+/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\./g, "")
    .trim();
  if (!compact) {
    return undefined;
  }

  if (compact === "stuck" || compact === "stueck" || compact === "stk") {
    return "Stück";
  }
  if (
    compact === "m2" ||
    compact === "qm" ||
    compact === "quadratmeter" ||
    compact === "quadratmetern"
  ) {
    return "m²";
  }
  if (
    compact === "m3" ||
    compact === "cbm" ||
    compact === "kubikmeter" ||
    compact === "kubikmetern"
  ) {
    return "m³";
  }
  if (compact === "m" || compact === "meter" || compact === "metern") {
    return "m";
  }
  if (compact === "kg" || compact === "kilogramm") {
    return "kg";
  }
  if (compact === "t" || compact === "tonne" || compact === "tonnen") {
    return "t";
  }
  if (compact === "l" || compact === "liter") {
    return "l";
  }
  if (
    compact === "std" ||
    compact === "stunde" ||
    compact === "stunden" ||
    compact === "h"
  ) {
    return "Std";
  }
  if (compact === "tag" || compact === "tage") {
    return "Tag";
  }
  if (
    compact === "psch" ||
    compact === "pauschale" ||
    compact === "pauschal"
  ) {
    return "Pauschal";
  }

  return undefined;
}

function normalizeParsedPositions(input: unknown): ParsedIntakePosition[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const positions: ParsedIntakePosition[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const item = entry as {
      group?: unknown;
      description?: unknown;
      quantity?: unknown;
      unit?: unknown;
      unitPrice?: unknown;
    };
    const description = normalizeTextValue(item.description);
    const quantityCandidate = normalizeNumberValue(item.quantity);
    const unitPriceCandidate = normalizeNumberValue(item.unitPrice);

    if (!description) {
      continue;
    }

    const quantity =
      typeof quantityCandidate === "number" &&
      Number.isFinite(quantityCandidate) &&
      quantityCandidate > 0
        ? quantityCandidate
        : undefined;
    const unitPrice =
      typeof unitPriceCandidate === "number" &&
      Number.isFinite(unitPriceCandidate) &&
      unitPriceCandidate >= 0
        ? unitPriceCandidate
        : undefined;
    const unit = normalizeUnitLabel(item.unit);

    positions.push({
      group: normalizeTextValue(item.group)
        ? formatPositionText(String(item.group))
        : undefined,
      description: formatPositionText(description),
      quantity,
      unit,
      unitPrice,
    });
  }

  return positions.slice(0, MAX_PARSED_POSITIONS);
}


function stripWrappingPunctuation(value: string): string {
  return value.replace(/^[,.;:!?()[\]{}]+|[,.;:!?()[\]{}]+$/g, "").trim();
}

function capitalizeEntryStart(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    return "";
  }

  const matchIndex = cleaned.search(/[A-Za-zÄÖÜäöüß]/);
  if (matchIndex < 0) {
    return cleaned;
  }

  return (
    cleaned.slice(0, matchIndex) +
    cleaned.charAt(matchIndex).toUpperCase() +
    cleaned.slice(matchIndex + 1)
  );
}

function normalizeCraftCompounds(value: string): string {
  return value
    .replace(/\bbeton\s+stahl\b/gi, "Betonstahl")
    .replace(
      /\bbeton\s+arbeit(en)?\b/gi,
      (_match, plural: string | undefined) => `Betonarbeit${plural ?? ""}`,
    )
    .replace(/\btrocken\s+bau(?:\s+arbeiten)?\b/gi, (match) =>
      /arbeiten$/i.test(match) ? "Trockenbauarbeiten" : "Trockenbau",
    )
    .replace(/\belektro\s+installation\b/gi, "Elektroinstallation")
    .replace(/\bkabel\s+verlegung\b/gi, "Kabelverlegung")
    .replace(
      /\bfliesen\s+arbeit(en)?\b/gi,
      (_match, plural: string | undefined) => `Fliesenarbeit${plural ?? ""}`,
    )
    .replace(/\b(?:waerme|wärme)\s+(?:daemmung|dämmung)\b/gi, "Wärmedämmung")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPositionText(value: string): string {
  const cleaned = value
    .split(/\s+/)
    .map((part) => stripWrappingPunctuation(part))
    .filter(Boolean)
    .join(" ")
    .trim();

  return capitalizeEntryStart(normalizeCraftCompounds(cleaned));
}

function formatLooseText(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => stripWrappingPunctuation(part))
    .filter(Boolean)
    .map((part) => {
      if (/\d/.test(part) || part.includes("@")) {
        return part;
      }

      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractLeadingPersonName(prefix: string): {
  firstName?: string;
  lastName?: string;
} {
  const explicitMatch = prefix.match(
    /^([A-Za-zÄÖÜäöüß-]{2,})\s+([A-Za-zÄÖÜäöüß-]{2,})(?=\s+(?:am|an|auf|bei|hinter|im|in|neben|ober|unter|vor|vom|zum|zur)\b)/i,
  );
  if (explicitMatch) {
    return {
      firstName: formatLooseText(explicitMatch[1]),
      lastName: formatLooseText(explicitMatch[2]),
    };
  }

  const genericMatch = prefix.match(
    /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{1,})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{1,})(?=\s+[A-Za-zÄÖÜäöüß.\-]+\s+\d+[a-zA-Z]?\b)/,
  );
  if (genericMatch) {
    return {
      firstName: formatLooseText(genericMatch[1]),
      lastName: formatLooseText(genericMatch[2]),
    };
  }

  return {};
}

function stripLeadingName(prefix: string, parsed: ParsedIntakeFields): string {
  if (!parsed.firstName || !parsed.lastName) {
    return prefix.trim();
  }

  const namePattern = new RegExp(
    `^${escapeRegExp(parsed.firstName)}\\s+${escapeRegExp(parsed.lastName)}\\s+`,
    "i",
  );
  return prefix.replace(namePattern, "").trim();
}

function extractStreetFromPrefix(
  prefix: string,
  parsed: ParsedIntakeFields,
): string | undefined {
  const strippedPrefix = stripLeadingName(prefix, parsed);
  if (!strippedPrefix) {
    return undefined;
  }

  const conventionalMatch = strippedPrefix.match(
    /([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.\-]+(?:\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.\-]+){0,5}\s+\d+[a-zA-Z]?)$/i,
  );
  if (conventionalMatch?.[1]) {
    return formatLooseText(conventionalMatch[1]);
  }

  return undefined;
}

function extractCityFromSuffix(
  suffix: string,
  parsed: ParsedIntakeFields,
): string | undefined {
  const nameParts = new Set(
    [parsed.firstName, parsed.lastName]
      .filter(Boolean)
      .map((value) => normalizeSearchValue(String(value))),
  );
  const rawTokens = suffix
    .split(/\s+/)
    .map((token) => stripWrappingPunctuation(token))
    .filter(Boolean);
  const cityTokens: string[] = [];

  for (const rawToken of rawTokens) {
    const normalizedToken = normalizeSearchValue(rawToken);
    if (!normalizedToken || rawToken.includes("@") || /^\d/.test(rawToken)) {
      break;
    }
    if (CITY_STOPWORDS.has(normalizedToken)) {
      break;
    }
    if (cityTokens.length > 0 && nameParts.has(normalizedToken)) {
      break;
    }

    cityTokens.push(formatLooseText(rawToken));
    if (cityTokens.length >= 3) {
      break;
    }
  }

  return cityTokens.length > 0 ? cityTokens.join(" ") : undefined;
}

function extractServiceDescriptionFromTranscript(
  transcript: string,
): string | undefined {
  const normalizedTranscript = normalizeSearchValue(transcript);
  const knownService = KNOWN_SERVICE_LABELS.find((label) =>
    normalizedTranscript.includes(normalizeSearchValue(label)),
  );
  if (knownService) {
    return knownService;
  }

  const emailMatch = transcript.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  );
  const serviceScope = emailMatch
    ? transcript.slice((emailMatch.index ?? 0) + emailMatch[0].length)
    : transcript;
  const normalizedScope = serviceScope
    .replace(/\b(?:ja|okay|ok|bitte|äh|ähm|hm)\b/gi, " ")
    .trim();
  const freeMatch = normalizedScope.match(
    /\b([A-Za-zÄÖÜäöüß-]+(?:arbeiten|installation|sanierung|renovierung|reparatur|wartung|abdichtung|dämmung|bewehrung|beleuchtung|innenputz|estrich))\b/i,
  );
  if (freeMatch?.[1]) {
    return formatLooseText(freeMatch[1]);
  }

  return undefined;
}

function parseGroupAndDescription(rawValue: string): {
  group?: string;
  description?: string;
} {
  const cleanedBase = stripWrappingPunctuation(
    rawValue
      .replace(/\b(?:position|leistung)\s*\d*\b/gi, "")
      .replace(/\s+/g, " "),
  );
  if (!cleanedBase) {
    return {};
  }

  let group: string | undefined;
  let descriptionText = cleanedBase;
  const groupedMatch = cleanedBase.match(
    /^([A-Za-zÄÖÜäöüß0-9\- ]{2,40})\s*[:>-]\s*(.+)$/,
  );
  if (groupedMatch?.[2]) {
    group = formatPositionText(groupedMatch[1]);
    descriptionText = groupedMatch[2];
  }

  const description = formatPositionText(descriptionText);
  return {
    group,
    description: description || undefined,
  };
}

function extractPositionsFromTranscript(transcript: string): ParsedIntakePosition[] {
  const positions: ParsedIntakePosition[] = [];
  const seen = new Set<string>();
  const normalizedTranscript = normalizeTranscriptForPositionExtraction(transcript);
  const matchers = [
    {
      regex: new RegExp(
        `([A-Za-zÄÖÜäöüß][^,;\\n]{2,90}?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_TOKEN_PATTERN})?\\s*(?:zu|a|à|ep|einzelpreis|preis|je|pro)?\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:€|eur|euro)?`,
        "gi",
      ),
      map(match: RegExpExecArray) {
        return {
          rawDescription: match[1],
          quantityRaw: match[2],
          unitRaw: match[3],
          unitPriceRaw: match[4],
        };
      },
    },
    {
      regex: new RegExp(
        `(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_TOKEN_PATTERN})?\\s+([A-Za-zÄÖÜäöüß][^,;\\n]{2,90}?)\\s*(?:zu|a|à|ep|einzelpreis|preis|je|pro)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:€|eur|euro)?`,
        "gi",
      ),
      map(match: RegExpExecArray) {
        return {
          rawDescription: match[3],
          quantityRaw: match[1],
          unitRaw: match[2],
          unitPriceRaw: match[4],
        };
      },
    },
  ];

  for (const matcher of matchers) {
    let match: RegExpExecArray | null = matcher.regex.exec(normalizedTranscript);
    while (match) {
      const mapped = matcher.map(match);
      const quantity = normalizeNumberValue(mapped.quantityRaw);
      const unitPrice = normalizeNumberValue(mapped.unitPriceRaw);
      const parsedTexts = parseGroupAndDescription(mapped.rawDescription);

      if (
        !parsedTexts.description ||
        !quantity ||
        quantity <= 0 ||
        unitPrice === undefined ||
        unitPrice < 0
      ) {
        match = matcher.regex.exec(normalizedTranscript);
        continue;
      }

      const normalizedDescription = normalizeSearchValue(parsedTexts.description);
      if (POSITION_DESCRIPTION_BLOCKLIST.has(normalizedDescription)) {
        match = matcher.regex.exec(normalizedTranscript);
        continue;
      }

      const dedupeKey = `${normalizeSearchValue(parsedTexts.group ?? "")}|${normalizeSearchValue(parsedTexts.description)}|${quantity}|${unitPrice}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        positions.push({
          group: parsedTexts.group,
          description: parsedTexts.description,
          quantity,
          unit: normalizeUnitLabel(mapped.unitRaw),
          unitPrice,
        });
      }

      if (positions.length >= MAX_PARSED_POSITIONS) {
        return positions;
      }

      match = matcher.regex.exec(normalizedTranscript);
    }
  }

  return positions;
}

function toParsedFields(input: Record<string, unknown>): ParsedIntakeFields {
  const customerTypeRaw = normalizeTextValue(input.customerType)?.toLowerCase();
  const salutationRaw = normalizeTextValue(input.salutation)?.toLowerCase();

  return {
    positions: normalizeParsedPositions(input.positions),
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

function buildTimeCalculationFromFields(
  fields: ParsedIntakeFields,
): ParsedIntakeTimeCalculation | undefined {
  const laborHours =
    typeof fields.hours === "number" &&
    Number.isFinite(fields.hours) &&
    fields.hours > 0
      ? fields.hours
      : undefined;
  const hourlyRate =
    typeof fields.hourlyRate === "number" &&
    Number.isFinite(fields.hourlyRate) &&
    fields.hourlyRate >= 0
      ? fields.hourlyRate
      : undefined;

  if (laborHours === undefined && hourlyRate === undefined) {
    return undefined;
  }

  return {
    laborHours,
    hourlyRate,
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

  const addressScope = emailMatch
    ? text.slice(0, emailMatch.index).trim()
    : text;
  const postalCodeMatch = addressScope.match(/\b(\d{5})\b/);
  if (postalCodeMatch) {
    parsed.postalCode = postalCodeMatch[1];

    const beforePostal = addressScope
      .slice(0, postalCodeMatch.index)
      .trim();
    const afterPostal = addressScope
      .slice((postalCodeMatch.index ?? 0) + postalCodeMatch[0].length)
      .trim();

    const leadingName = extractLeadingPersonName(beforePostal);
    if (!parsed.firstName && leadingName.firstName) {
      parsed.firstName = leadingName.firstName;
    }
    if (!parsed.lastName && leadingName.lastName) {
      parsed.lastName = leadingName.lastName;
    }
    if (!parsed.customerType && parsed.firstName && parsed.lastName) {
      parsed.customerType = "person";
    }

    const detectedStreet = extractStreetFromPrefix(beforePostal, parsed);
    if (detectedStreet) {
      parsed.street = detectedStreet;
    }

    const detectedCity = extractCityFromSuffix(afterPostal, parsed);
    if (detectedCity) {
      parsed.city = detectedCity;
    }
  }

  const streetMatch = text.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{2,}(?:straße|strasse|weg|allee|platz|gasse|ring|ufer|damm|chaussee)\s+\d+[a-zA-Z]?)\b/i);
  if (!parsed.street && streetMatch) {
    parsed.street = formatLooseText(streetMatch[1]);
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

  if (!parsed.serviceDescription) {
    const detectedService = extractServiceDescriptionFromTranscript(text);
    if (detectedService) {
      parsed.serviceDescription = detectedService;
    }
  }

  if (
    !parsed.customerType &&
    parsed.firstName &&
    parsed.lastName &&
    !parsed.companyName
  ) {
    parsed.customerType = "person";
  }

  if (
    parsed.firstName &&
    parsed.lastName &&
    !parsed.street &&
    !parsed.postalCode
  ) {
    const words = text.split(/\s+/).map((part) => stripWrappingPunctuation(part));
    const numberIndex = words.findIndex((part) => /^\d+[a-zA-Z]?$/.test(part));
    if (numberIndex >= 2) {
      const streetWords = words.slice(2, numberIndex + 1).filter(Boolean);
      if (
        streetWords.length >= 2 &&
        ADDRESS_JOINER_WORDS.has(normalizeSearchValue(streetWords[0]))
      ) {
        parsed.street = formatLooseText(streetWords.join(" "));
      }
    }
  }

  parsed.positions = extractPositionsFromTranscript(text);

  return parsed;
}

export async function generateOfferText(input: OfferPromptInput): Promise<OfferText> {
  const openai = getClient();
  if (!openai) {
    debugOfferTextLog("fallback_no_api_key");
    return fallbackOffer(input);
  }

  try {
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
      debugOfferTextLog("fallback_empty_model_response");
      return fallbackOffer(input);
    }

    try {
      const parsed = JSON.parse(raw) as Partial<OfferText>;
      if (isValidOfferText(parsed)) {
        return parsed;
      }
      debugOfferTextLog("fallback_invalid_model_json_schema", {
        rawPreview: raw.slice(0, 400),
      });
      return fallbackOffer(input);
    } catch {
      debugOfferTextLog("fallback_invalid_model_json", {
        rawPreview: raw.slice(0, 400),
      });
      return fallbackOffer(input);
    }
  } catch (error) {
    console.error(
      "[generate-offer-text] model_call_failed",
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : { error },
    );
    return fallbackOffer(input);
  }
}

const INTAKE_JSON_SCHEMA = `{
  "customer": {
    "name": "string",
    "company": "string",
    "phone": "string",
    "email": "string",
    "address": {
      "street": "string",
      "zip": "string",
      "city": "string"
    }
  },
  "document": {
    "type": "angebot|rechnung|unknown",
    "title": "string",
    "notes": "string"
  },
  "items": [
    {
      "description": "string",
      "quantity": "number|null",
      "unit": "string",
      "unitPrice": "number|null"
    }
  ],
  "timeCalculation": {
    "laborHours": "number|null",
    "laborDescription": "string",
    "workers": "number|null",
    "hourlyRate": "number|null",
    "notes": "string"
  },
  "appointment": {
    "date": "string",
    "time": "string"
  },
  "tax": {
    "treatment": "standard|reverse_charge|vat_exempt|unknown",
    "notice": "string"
  },
  "ignored_text": ["string"],
  "confidence": {
    "customer": "number(0-1)",
    "items": "number(0-1)",
    "document": "number(0-1)"
  },
  "needs_review": "boolean",
  "sourceText": "string|null"
}`;

const INTAKE_FEW_SHOTS = `Beispiel 1
Input:
"Mach mir bitte ein Angebot für Max Müller, Wasserhahn austauschen, zwei Stunden Arbeit."
Output:
{
  "customer": {
    "name": "Max Müller",
    "company": "",
    "phone": "",
    "email": "",
    "address": {
      "street": "Musterstraße 12",
      "zip": "",
      "city": "Berlin"
    }
  },
  "document": {
    "type": "angebot",
    "title": "",
    "notes": ""
  },
  "items": [
    {
      "description": "Wasserhahn austauschen",
      "quantity": null,
      "unit": "",
      "unitPrice": null
    }
  ],
  "timeCalculation": {
    "laborHours": 2,
    "laborDescription": "Arbeit",
    "workers": null,
    "hourlyRate": null,
    "notes": ""
  },
  "appointment": {
    "date": "",
    "time": ""
  },
  "tax": {
    "treatment": "standard",
    "notice": ""
  },
  "ignored_text": ["Mach mir bitte"],
  "confidence": {
    "customer": 0.9,
    "items": 0.92,
    "document": 0.9
  },
  "needs_review": false
}

Beispiel 2
Input:
"Rechnung für Schneider GmbH, Rohrreinigung, Arbeitszeit 3,5 Stunden, Material 25 Euro."
Output:
{
  "customer": {
    "name": "",
    "company": "Schneider GmbH",
    "phone": "",
    "email": "",
    "address": {
      "street": "",
      "zip": "",
      "city": ""
    }
  },
  "document": {
    "type": "rechnung",
    "title": "",
    "notes": ""
  },
  "items": [
    {
      "description": "Rohrreinigung",
      "quantity": null,
      "unit": "",
      "unitPrice": null
    },
    {
      "description": "Material",
      "quantity": null,
      "unit": "",
      "unitPrice": 25
    }
  ],
  "timeCalculation": {
    "laborHours": 3.5,
    "laborDescription": "Arbeitszeit",
    "workers": null,
    "hourlyRate": null,
    "notes": ""
  },
  "appointment": {
    "date": "",
    "time": ""
  },
  "tax": {
    "treatment": "standard",
    "notice": ""
  },
  "ignored_text": [],
  "confidence": {
    "customer": 0.91,
    "items": 0.9,
    "document": 0.96
  },
  "needs_review": false
}

Beispiel 3 (Kamera/Scan)
Input:
"Familie Kaya, Bad Silikonfuge erneuern, ca. 4 h Arbeit, Material Silikon 18 €"
Output:
{
  "customer": {
    "name": "Familie Kaya",
    "company": "",
    "phone": "",
    "email": "",
    "address": {
      "street": "",
      "zip": "",
      "city": ""
    }
  },
  "document": {
    "type": "unknown",
    "title": "",
    "notes": ""
  },
  "items": [
    {
      "description": "Bad Silikonfuge erneuern",
      "quantity": null,
      "unit": "",
      "unitPrice": null
    },
    {
      "description": "Material Silikon",
      "quantity": null,
      "unit": "",
      "unitPrice": 18
    }
  ],
  "timeCalculation": {
    "laborHours": 4,
    "laborDescription": "Arbeit",
    "workers": null,
    "hourlyRate": null,
    "notes": "ca."
  },
  "appointment": {
    "date": "",
    "time": ""
  },
  "tax": {
    "treatment": "standard",
    "notice": ""
  },
  "ignored_text": [],
  "confidence": {
    "customer": 0.82,
    "items": 0.88,
    "document": 0.65
  },
  "needs_review": false
}`;

const INTAKE_SYSTEM_PROMPT =
  "Du extrahierst aus deutscher Umgangssprache oder aus OCR-Text präzise Geschäftsdaten für Handwerker-Angebote/Rechnungen. " +
  "Ignoriere Steuerungs-/Befehlssprache (z. B. 'mach mir mal bitte', 'trag mal ein', 'schreib bitte rein', 'erstelle ein Angebot für', 'füge hinzu', 'notiere') und Füllwörter (z. B. 'ähm', 'also', 'ja', 'bitte', 'mal', 'quasi', 'genau'). " +
  "Erfasse nur relevante Daten und ordne sie semantisch korrekt zu (customer/document/items/timeCalculation/appointment). " +
  "items dürfen ausschließlich echte Leistungen, Materialien oder explizite Anfahrt-Positionen enthalten, nie Befehlsreste. " +
  "Formular-Metadaten wie Rechnungsdatum, Leistungszeitraum, Zahlungsziel, E-Mail, PLZ, Ort, Bezeichnung, Menge, Einheit oder Einzelpreis dürfen niemals als items erscheinen. " +
  "Wenn Steuerhinweise wie Reverse-Charge, § 13b UStG, 'Leistungsempfänger schuldet die Umsatzsteuer', § 19 UStG, 'keine Umsatzsteuer' oder 'umsatzsteuerfrei' vorkommen, erfasse sie in tax.treatment und tax.notice. " +
  "Wenn keine echte Position erkennbar ist, schreibe die freie Leistungsangabe in serviceDescription/document.notes statt künstliche items zu erzeugen. " +
  "Arbeitszeit (z. B. '2 Stunden Arbeit', 'Arbeitszeit 3 h', 'Montagezeit', 'Geselle 3 Stunden', 'Meister 2 Stunden', 'vor Ort 6 Stunden') gehört ausschließlich in timeCalculation und darf nicht in items dupliziert werden. " +
  "Wenn Mengen/Einheiten/Preise fehlen, lasse Felder leer bzw. null. Nichts raten. " +
  "Unsichere Daten zurückhaltend behandeln, confidence setzen und needs_review=true lassen. " +
  "Antworte strikt mit validem JSON, ohne Markdown und ohne erklärenden Text.";

function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  return input as Record<string, unknown>;
}

function normalizeConfidenceValue(input: unknown): number | undefined {
  const value = normalizeNumberValue(input);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeDocumentType(
  input: unknown,
): "offer" | "invoice" | "unknown" | undefined {
  const normalized = normalizeTextValue(input)
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "angebot" || normalized === "offer") {
    return "offer";
  }
  if (normalized === "rechnung" || normalized === "invoice") {
    return "invoice";
  }
  if (normalized === "unknown" || normalized === "unbekannt") {
    return "unknown";
  }
  return undefined;
}

function normalizeTextArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((entry) => normalizeTextValue(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeTimeCalculation(
  input: unknown,
): ParsedIntakeTimeCalculation | undefined {
  const source = asRecord(input);
  if (!source) {
    return undefined;
  }

  const laborHoursCandidate = normalizeNumberValue(source.laborHours);
  const workersCandidate = normalizeNumberValue(source.workers);
  const hourlyRateCandidate = normalizeNumberValue(source.hourlyRate);

  const laborHours =
    typeof laborHoursCandidate === "number" &&
    Number.isFinite(laborHoursCandidate) &&
    laborHoursCandidate > 0
      ? laborHoursCandidate
      : undefined;
  const workers =
    typeof workersCandidate === "number" &&
    Number.isFinite(workersCandidate) &&
    workersCandidate > 0
      ? workersCandidate
      : undefined;
  const hourlyRate =
    typeof hourlyRateCandidate === "number" &&
    Number.isFinite(hourlyRateCandidate) &&
    hourlyRateCandidate >= 0
      ? hourlyRateCandidate
      : undefined;
  const laborDescription = normalizeTextValue(source.laborDescription);
  const notes = normalizeTextValue(source.notes);

  if (
    laborHours === undefined &&
    workers === undefined &&
    hourlyRate === undefined &&
    !laborDescription &&
    !notes
  ) {
    return undefined;
  }

  return {
    laborHours,
    laborDescription,
    workers,
    hourlyRate,
    notes,
  };
}

function splitCustomerName(name: string | undefined): {
  firstName?: string;
  lastName?: string;
} {
  if (!name) {
    return {};
  }
  const normalized = name
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return {};
  }
  const parts = normalized.split(" ");
  if (parts.length === 1) {
    return { firstName: formatLooseText(parts[0]) };
  }
  return {
    firstName: formatLooseText(parts.slice(0, -1).join(" ")),
    lastName: formatLooseText(parts.slice(-1).join(" ")),
  };
}

function parseIntakeModelPayload(raw: string): {
  fields: ParsedIntakeFields;
  timeCalculation?: ParsedIntakeTimeCalculation;
  tax?: DocumentTaxInfo;
  sourceText?: string;
  ignoredText?: string[];
  confidence?: ParsedIntakeConfidence;
  needsReview?: boolean;
  document?: ParsedIntakeDocument;
  appointment?: ParsedIntakeAppointment;
} {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const customer = asRecord(parsed.customer);
  const address = asRecord(customer?.address);
  const document = asRecord(parsed.document);
  const appointment = asRecord(parsed.appointment);
  const confidence = asRecord(parsed.confidence);
  const tax = normalizeDocumentTaxInfo(parsed.tax);
  const timeCalculation = normalizeTimeCalculation(parsed.timeCalculation);

  const customerName = normalizeTextValue(customer?.name);
  const splitName = splitCustomerName(customerName);
  const companyName = normalizeTextValue(customer?.company);
  const customerEmail = normalizeTextValue(customer?.email);
  const serviceDescriptionFromDocumentNotes = normalizeTextValue(document?.notes);

  const fallbackFlatFields = toParsedFields(parsed);
  const fallbackTimeCalculation = buildTimeCalculationFromFields(fallbackFlatFields);
  const resolvedTimeCalculation: ParsedIntakeTimeCalculation | undefined =
    timeCalculation || fallbackTimeCalculation
      ? {
          laborHours:
            timeCalculation?.laborHours ?? fallbackTimeCalculation?.laborHours,
          laborDescription: timeCalculation?.laborDescription,
          workers: timeCalculation?.workers,
          hourlyRate:
            timeCalculation?.hourlyRate ?? fallbackTimeCalculation?.hourlyRate,
          notes: timeCalculation?.notes,
        }
      : undefined;
  const itemCandidates = Array.isArray(parsed.items)
    ? parsed.items
    : Array.isArray(parsed.positions)
      ? parsed.positions
      : [];
  const normalizedItems = normalizeParsedPositions(itemCandidates);

  const normalizedDocumentType =
    normalizeDocumentType(document?.type) ??
    normalizeDocumentType(parsed.documentType) ??
    undefined;
  const normalizedConfidence: ParsedIntakeConfidence | undefined =
    confidence
      ? {
          customer: normalizeConfidenceValue(confidence.customer),
          items: normalizeConfidenceValue(confidence.items),
          document: normalizeConfidenceValue(confidence.document),
        }
      : undefined;

  const resultFields: ParsedIntakeFields = {
    ...fallbackFlatFields,
    customerType:
      companyName && !splitName.lastName
        ? "company"
        : fallbackFlatFields.customerType,
    companyName: companyName ?? fallbackFlatFields.companyName,
    firstName: splitName.firstName ?? fallbackFlatFields.firstName,
    lastName: splitName.lastName ?? fallbackFlatFields.lastName,
    street:
      normalizeTextValue(address?.street) ?? fallbackFlatFields.street,
    postalCode:
      normalizeTextValue(address?.zip) ?? fallbackFlatFields.postalCode,
    city: normalizeTextValue(address?.city) ?? fallbackFlatFields.city,
    customerEmail: customerEmail ?? fallbackFlatFields.customerEmail,
    serviceDescription:
      fallbackFlatFields.serviceDescription ??
      serviceDescriptionFromDocumentNotes,
    hours: resolvedTimeCalculation?.laborHours ?? fallbackFlatFields.hours,
    hourlyRate:
      resolvedTimeCalculation?.hourlyRate ?? fallbackFlatFields.hourlyRate,
    positions:
      normalizedItems.length > 0
        ? normalizedItems
        : fallbackFlatFields.positions,
  };

  if (
    !resultFields.customerType &&
    resultFields.firstName &&
    resultFields.lastName &&
    !resultFields.companyName
  ) {
    resultFields.customerType = "person";
  }

  return {
    fields: resultFields,
    timeCalculation: resolvedTimeCalculation,
    tax,
    sourceText: normalizeTextValue(parsed.sourceText),
    ignoredText:
      normalizeTextArray(parsed.ignored_text).length > 0
        ? normalizeTextArray(parsed.ignored_text)
        : normalizeTextArray(parsed.ignoredText),
    confidence: normalizedConfidence,
    needsReview:
      typeof parsed.needs_review === "boolean"
        ? parsed.needs_review
        : typeof parsed.needsReview === "boolean"
          ? parsed.needsReview
          : undefined,
    document: normalizedDocumentType
      ? {
          type: normalizedDocumentType,
          title: normalizeTextValue(document?.title),
          notes: serviceDescriptionFromDocumentNotes,
        }
      : undefined,
    appointment:
      normalizeTextValue(appointment?.date) || normalizeTextValue(appointment?.time)
        ? {
            date: normalizeTextValue(appointment?.date),
            time: normalizeTextValue(appointment?.time),
          }
        : undefined,
  };
}

export async function parseOfferIntake(transcript: string): Promise<IntakeParseResult> {
  const openai = getClient();
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) {
    return { fields: {}, usedFallback: true, fallbackReason: "model_error" };
  }

  if (!openai) {
    const fallbackFields = fallbackParseIntake(cleanTranscript);
    return {
      fields: fallbackFields,
      timeCalculation: buildTimeCalculationFromFields(fallbackFields),
      usedFallback: true,
      fallbackReason: "no_api_key",
      needsReview: true,
    };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: INTAKE_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Extrahiere aus diesem Spracheingabetext:
${cleanTranscript}

Regeln:
- Nur valide JSON-Antwort.
- Kein Markdown.
- Keine Erklärungen.
- Unsichere/leere Werte leer lassen.
- Nichts raten.

Antwort-JSON-Schema:
${INTAKE_JSON_SCHEMA}

Few-Shot-Beispiele:
${INTAKE_FEW_SHOTS}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return {
        fields: fallbackParseIntake(cleanTranscript),
        usedFallback: true,
        fallbackReason: "model_error",
        needsReview: true,
      };
    }

    const payload = parseIntakeModelPayload(raw);

    return {
      fields: payload.fields,
      timeCalculation: payload.timeCalculation,
      tax: payload.tax,
      usedFallback: false,
      sourceText: payload.sourceText,
      ignoredText: payload.ignoredText,
      confidence: payload.confidence,
      needsReview: payload.needsReview,
      document: payload.document,
      appointment: payload.appointment,
    };
  } catch {
    return {
      fields: fallbackParseIntake(cleanTranscript),
      usedFallback: true,
      fallbackReason: "model_error",
      needsReview: true,
    };
  }
}

export async function parseOfferIntakeFromImage(
  imageDataUrls: string | string[],
): Promise<IntakeParseResult> {
  const openai = getClient();
  const normalizedImageDataUrls = (
    Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls]
  )
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (normalizedImageDataUrls.length === 0) {
    return { fields: {}, usedFallback: true, fallbackReason: "model_error" };
  }

  if (!openai) {
    return {
      fields: {},
      usedFallback: true,
      fallbackReason: "no_api_key",
      needsReview: true,
    };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: INTAKE_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analysiere diese ${normalizedImageDataUrls.length} Foto${normalizedImageDataUrls.length === 1 ? "" : "s"} gemeinsam und gib nur strukturiertes JSON zurück.

Regeln:
- Nur valide JSON-Antwort.
- Kein Markdown.
- Keine Erklärungen.
- Unsichere/leere Werte leer lassen.
- Nichts raten.
- Nutze Informationen aus allen Fotos zusammen.
- Führe Kundendaten, Adressen, Positionen und Preise aus mehreren Fotos in einer gemeinsamen Antwort zusammen.
- Doppelte Positionen nicht mehrfach ausgeben.
- Wenn sich Angaben zwischen Fotos widersprechen, nimm nur den sichersten Wert und setze needs_review auf true.

Antwort-JSON-Schema:
${INTAKE_JSON_SCHEMA}

Few-Shot-Beispiele:
${INTAKE_FEW_SHOTS}`,
            },
            ...normalizedImageDataUrls.map((url) => ({
              type: "image_url" as const,
              image_url: {
                url,
                detail: "high" as const,
              },
            })),
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return { fields: {}, usedFallback: true, fallbackReason: "model_error" };
    }

    const payload = parseIntakeModelPayload(raw);
    return {
      fields: payload.fields,
      timeCalculation: payload.timeCalculation,
      tax: payload.tax,
      usedFallback: false,
      sourceText: payload.sourceText,
      ignoredText: payload.ignoredText,
      confidence: payload.confidence,
      needsReview: payload.needsReview,
      document: payload.document,
      appointment: payload.appointment,
    };
  } catch {
    return { fields: {}, usedFallback: true, fallbackReason: "model_error" };
  }
}
