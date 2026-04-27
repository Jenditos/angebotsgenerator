import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { parseOfferIntake, parseOfferIntakeFromImage } from "@/lib/openai";
import { MAX_VOICE_TRANSCRIPT_LENGTH } from "@/lib/user-input";

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

const EXPLICIT_SERVICE_DESCRIPTION_PATTERN =
  /\b(projektbeschreibung|leistungsbeschreibung|zusatzdetails?|zusatzinfo(?:s)?|beschreibung|details?|hinweise?|bemerkung(?:en)?|notiz(?:en)?)\b/i;
const POSITION_DESCRIPTION_STOPWORDS = new Set([
  "arbeit",
  "arbeiten",
  "beschreibung",
  "detail",
  "details",
  "leistung",
  "leistungen",
  "notiz",
  "notizen",
  "projekt",
  "projektbeschreibung",
  "zusatzdetail",
  "zusatzdetails",
  "zusatzinfo",
  "zusatzinfos",
]);
const INVALID_POSITION_DESCRIPTION_KEYS = new Set([
  "einzelpreis",
  "eur",
  "euro",
  "preis",
]);
const PHOTO_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
const MAX_PHOTO_IMAGE_BYTES = 6 * 1024 * 1024;
const FILLER_TOKEN_PATTERN =
  /\b(?:ähm|aehm|also|ja|bitte|mal|quasi|genau|halt|eben)\b/gi;
const LEADING_FILLER_PATTERN =
  /^(?:\s*(?:ähm|aehm|also|ja|bitte|mal|quasi|genau|halt|eben)\b[,:;\-]?\s*)+/i;
const LEADING_COMMAND_PATTERNS = [
  /^(?:mach(?:\s+mir)?(?:\s+mal)?(?:\s+bitte)?\s*)/i,
  /^(?:trag(?:\s+mal)?\s+ein\s*)/i,
  /^(?:schreib(?:\s+bitte)?\s+(?:rein|ein)\s*)/i,
  /^(?:erstell(?:e|en)?(?:\s+mal)?\s*)/i,
  /^(?:f(?:ü|u)ge?\s+hinzu\s*)/i,
  /^(?:notier(?:e|en)\s*)/i,
  /^(?:kannst\s+du\s*)/i,
  /^(?:ich\s+brauche\s*)/i,
  /^(?:f(?:ü|u)r\s+den\s+kunden\s*)/i,
  /^(?:und\s+dann\s+noch\s*)/i,
  /^(?:angebot\s+f(?:ü|u)r\s*)/i,
  /^(?:rechnung\s+f(?:ü|u)r\s*)/i,
];
const CONTROL_LANGUAGE_PATTERN =
  /\b(?:mach|erstell(?:e|en)?|schreib|trag|f(?:ü|u)ge?|notier(?:e|en)|kannst\s+du|ich\s+brauche|f(?:ü|u)r\s+den\s+kunden|und\s+dann\s+noch)\b/i;
const BUSINESS_SIGNAL_PATTERN =
  /\b(?:angebot|rechnung|kunde|firma|gmbh|ag|kg|straße|strasse|platz|weg|allee|gasse|ring|ufer|hausnummer|plz|telefon|mail|@|wasserhahn|armatur|rohr|heizung|elektro|steckdose|silikon|fuge|montier|einbau|austausch|reinigung|anfahrt|material|kosten|stunden?|stundensatz|euro|eur|€)\b/i;
const LABOR_KEYWORD_PATTERN =
  /\b(?:arbeit(?:szeit)?|montagezeit|zeitaufwand|mannstunden?|geselle|meister|monteur(?:e)?|facharbeiter|vor\s*ort)\b/i;
const NON_LABOR_TIME_HINT_PATTERN =
  /\b(?:anfahrt|fahrtkosten|material|ersatzteile?|ersatzteil|lieferung)\b/i;
const LABOR_NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eins: 1,
  eine: 1,
  einen: 1,
  einer: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fuenf: 5,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwoelf: 12,
  zwölf: 12,
};

type ParseIntakeInputMode = "voice" | "photo";
type ParseIntakeRequestBody = {
  inputMode?: ParseIntakeInputMode;
  transcript?: string;
  photoDataUrl?: string;
};

type IntakeVoicePosition = {
  group?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
};

type IntakeTimeCalculation = {
  laborHours?: number;
  laborDescription?: string;
  workers?: number;
  hourlyRate?: number;
  notes?: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeTextValues(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const key = normalizeGermanUmlauts(value.toLowerCase()).replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

function stripLeadingNoise(value: string): { cleaned: string; ignored: string[] } {
  let cleaned = normalizeWhitespace(value);
  const ignored: string[] = [];
  let changed = true;

  while (changed && cleaned) {
    changed = false;
    const fillerMatch = cleaned.match(LEADING_FILLER_PATTERN);
    if (fillerMatch?.[0]) {
      const removed = normalizeWhitespace(fillerMatch[0]);
      if (removed) {
        ignored.push(removed);
      }
      cleaned = normalizeWhitespace(
        cleaned.slice(fillerMatch[0].length).replace(/^[,:;\-]+/, ""),
      );
      changed = true;
      continue;
    }

    for (const pattern of LEADING_COMMAND_PATTERNS) {
      const match = cleaned.match(pattern);
      if (!match?.[0]) {
        continue;
      }
      const removed = normalizeWhitespace(match[0]);
      if (removed) {
        ignored.push(removed);
      }
      cleaned = normalizeWhitespace(
        cleaned.slice(match[0].length).replace(/^[,:;\-]+/, ""),
      );
      changed = true;
      break;
    }
  }

  return { cleaned, ignored: dedupeTextValues(ignored) };
}

function isLikelyControlLanguageSegment(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) {
    return true;
  }
  if (BUSINESS_SIGNAL_PATTERN.test(cleaned)) {
    return false;
  }

  const normalized = normalizeGermanUmlauts(cleaned.toLowerCase());
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  const controlTokenCount = tokens.filter((token) =>
    [
      "mach",
      "mir",
      "bitte",
      "mal",
      "trag",
      "schreib",
      "erstelle",
      "erstellen",
      "fuge",
      "fuege",
      "notiere",
      "notieren",
      "kannst",
      "du",
      "ich",
      "brauche",
      "fuer",
      "den",
      "kunden",
      "und",
      "dann",
      "noch",
      "ja",
      "also",
      "quasi",
      "genau",
      "aehm",
      "ahem",
    ].includes(token)
  ).length;

  const controlRatio = controlTokenCount / tokens.length;
  return controlRatio >= 0.55 || CONTROL_LANGUAGE_PATTERN.test(cleaned);
}

function sanitizeLooseTextValue(
  value: string | undefined,
): { value?: string; ignored: string[] } {
  if (!value) {
    return { ignored: [] };
  }
  const stripped = stripLeadingNoise(value);
  const cleaned = normalizeWhitespace(
    stripped.cleaned
      .replace(FILLER_TOKEN_PATTERN, " ")
      .replace(/^[,.;:!?()\[\]{}\-]+|[,.;:!?()\[\]{}\-]+$/g, " ")
      .replace(/\s+/g, " "),
  );
  if (!cleaned || isLikelyControlLanguageSegment(cleaned)) {
    return { ignored: dedupeTextValues([...stripped.ignored, value.trim()]) };
  }
  return { value: cleaned, ignored: stripped.ignored };
}

function resolveDocumentTypeHint(input: {
  transcript: string;
  parsedType?: string;
}): "offer" | "invoice" | "unknown" {
  const parsedType = (input.parsedType ?? "").toLowerCase().trim();
  if (parsedType === "offer" || parsedType === "angebot") {
    return "offer";
  }
  if (parsedType === "invoice" || parsedType === "rechnung") {
    return "invoice";
  }

  if (/\brechnung\b/i.test(input.transcript)) {
    return "invoice";
  }
  if (/\bangebot\b/i.test(input.transcript)) {
    return "offer";
  }
  return "unknown";
}

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

function sanitizeServiceDescription(
  value: string | undefined,
  transcript: string,
): { value?: string; ignored: string[] } {
  if (!value) {
    return { ignored: [] };
  }

  const base = sanitizeLooseTextValue(normalizeCraftCompounds(value) ?? value.trim());
  if (!base.value) {
    return base;
  }

  if (base.value.length < 3 || base.value.length > 280) {
    return { ignored: dedupeTextValues([...base.ignored, base.value]) };
  }

  const normalizedValue = base.value.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedTranscript = transcript.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalizedTranscript) {
    return base;
  }

  if (normalizedValue === normalizedTranscript) {
    return { ignored: dedupeTextValues([...base.ignored, base.value]) };
  }

  const wordCount = normalizedValue.split(" ").filter(Boolean).length;
  if (normalizedTranscript.includes(normalizedValue) && wordCount > 16) {
    return { ignored: dedupeTextValues([...base.ignored, base.value]) };
  }

  return base;
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

function parseQuantityValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const cleaned = value
    .trim()
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function normalizeUnitLabel(rawUnit: string | undefined): string | undefined {
  if (!rawUnit) {
    return undefined;
  }
  const normalized = normalizeGermanUmlauts(rawUnit.toLowerCase())
    .replace(/\s+/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\./g, "")
    .trim();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "stuck" ||
    normalized === "stueck" ||
    normalized === "stk"
  ) {
    return "Stück";
  }
  if (
    normalized === "m2" ||
    normalized === "qm" ||
    normalized === "quadratmeter" ||
    normalized === "quadratmetern"
  ) {
    return "m²";
  }
  if (
    normalized === "m3" ||
    normalized === "cbm" ||
    normalized === "kubikmeter" ||
    normalized === "kubikmetern"
  ) {
    return "m³";
  }
  if (normalized === "m" || normalized === "meter" || normalized === "metern") {
    return "m";
  }
  if (normalized === "kg" || normalized === "kilogramm") {
    return "kg";
  }
  if (normalized === "t" || normalized === "tonne" || normalized === "tonnen") {
    return "t";
  }
  if (normalized === "l" || normalized === "liter") {
    return "l";
  }
  if (
    normalized === "std" ||
    normalized === "stunde" ||
    normalized === "stunden" ||
    normalized === "h"
  ) {
    return "Std";
  }
  if (normalized === "tag" || normalized === "tage") {
    return "Tag";
  }
  if (
    normalized === "pauschal" ||
    normalized === "pauschale" ||
    normalized === "psch"
  ) {
    return "Pauschal";
  }

  return undefined;
}

function parseLaborNumberToken(token: string): number | undefined {
  const normalized = normalizeGermanUmlauts(token.toLowerCase()).trim();
  if (!normalized) {
    return undefined;
  }
  if (/^\d+(?:[.,]\d+)?$/.test(normalized)) {
    const parsed = Number(normalized.replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return LABOR_NUMBER_WORDS[normalized];
}

function isLaborUnit(unit: string | undefined): boolean {
  if (!unit) {
    return false;
  }
  const normalized = normalizeGermanUmlauts(unit.toLowerCase())
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .trim();
  return (
    normalized === "std" ||
    normalized === "h" ||
    normalized === "stunde" ||
    normalized === "stunden"
  );
}

function extractLaborHoursFromText(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  let total = 0;
  let hasMatch = false;
  const patterns = [
    /(\d+(?:[.,]\d+)?|[A-Za-zÄÖÜäöüß]+)\s*(?:stunden?|std|h)\b/gi,
    /(?:arbeitszeit|montagezeit|geselle|meister|vor\s*ort)\s*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?|[A-Za-zÄÖÜäöüß]+)\s*(?:stunden?|std|h)?\b/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(normalized);
    while (match) {
      const parsed = parseLaborNumberToken(match[1]);
      if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
        total += parsed;
        hasMatch = true;
      }
      match = pattern.exec(normalized);
    }
  }

  return hasMatch ? total : undefined;
}

function isLaborOnlyPosition(position: IntakeVoicePosition): boolean {
  const description = sanitizePositionDescription(position.description) ?? "";
  if (!description) {
    return false;
  }
  const normalizedDescription = normalizeGermanUmlauts(description.toLowerCase());
  const hasLaborKeywords = LABOR_KEYWORD_PATTERN.test(normalizedDescription);
  const hasLaborUnit = isLaborUnit(normalizeUnitLabel(position.unit) ?? position.unit);
  if (!hasLaborKeywords && !hasLaborUnit) {
    return false;
  }
  if (NON_LABOR_TIME_HINT_PATTERN.test(normalizedDescription)) {
    return false;
  }

  const reduced = normalizedDescription
    .replace(
      /\b(?:ca|circa|vor|ort|und|inkl|inklusive|arbeit(?:szeit)?|montagezeit|zeitaufwand|mannstunden?|geselle|meister|monteur(?:e)?|facharbeiter|std|stunde|stunden|h)\b/g,
      " ",
    )
    .replace(/\d+(?:[.,]\d+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return reduced.length === 0;
}

function separateLaborFromPositions(
  positions: IntakeVoicePosition[] | undefined,
): {
  positions?: IntakeVoicePosition[];
  laborHours?: number;
  ignoredLaborText: string[];
} {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { positions: undefined, ignoredLaborText: [] };
  }

  const filtered: IntakeVoicePosition[] = [];
  const ignoredLaborText: string[] = [];
  let laborHoursTotal = 0;
  let hasLaborHours = false;

  for (const position of positions) {
    const isLabor = isLaborOnlyPosition(position);
    if (!isLabor) {
      filtered.push(position);
      continue;
    }

    const description = sanitizePositionDescription(position.description);
    if (description) {
      ignoredLaborText.push(description);
    }

    const unit = normalizeUnitLabel(position.unit) ?? position.unit;
    const quantity = parseQuantityValue(position.quantity);
    const hoursFromQuantity =
      typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0 && isLaborUnit(unit)
        ? quantity
        : undefined;
    const hoursFromText = extractLaborHoursFromText(description);
    const resolvedHours =
      hoursFromQuantity ??
      (typeof hoursFromText === "number" && Number.isFinite(hoursFromText) && hoursFromText > 0
        ? hoursFromText
        : undefined);

    if (typeof resolvedHours === "number") {
      laborHoursTotal += resolvedHours;
      hasLaborHours = true;
    }
  }

  return {
    positions: filtered.length > 0 ? filtered : undefined,
    laborHours: hasLaborHours ? laborHoursTotal : undefined,
    ignoredLaborText,
  };
}

function extractLaborHoursFromSourceText(sourceText: string): number | undefined {
  const cleaned = normalizeWhitespace(sourceText);
  if (!cleaned) {
    return undefined;
  }

  let total = 0;
  let hasMatch = false;
  const patterns = [
    /(\d+(?:[.,]\d+)?|[A-Za-zÄÖÜäöüß]+)\s*(?:stunden?|std|h)\s*(?:arbeit(?:szeit)?|montagezeit|vor\s*ort)?/gi,
    /(?:arbeitszeit|montagezeit|geselle|meister|vor\s*ort)\s*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?|[A-Za-zÄÖÜäöüß]+)\s*(?:stunden?|std|h)?/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(cleaned);
    while (match) {
      const contextStart = Math.max(0, (match.index ?? 0) - 24);
      const contextEnd = Math.min(
        cleaned.length,
        (match.index ?? 0) + match[0].length + 24,
      );
      const context = cleaned.slice(contextStart, contextEnd).toLowerCase();
      if (NON_LABOR_TIME_HINT_PATTERN.test(context)) {
        match = pattern.exec(cleaned);
        continue;
      }

      const parsed = parseLaborNumberToken(match[1]);
      if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
        total += parsed;
        hasMatch = true;
      }
      match = pattern.exec(cleaned);
    }
  }

  return hasMatch ? total : undefined;
}

function normalizeTimeCalculation(input: unknown): IntakeTimeCalculation | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const laborHours = parseQuantityValue(record.laborHours);
  const workers = parseQuantityValue(record.workers);
  const hourlyRate = parseQuantityValue(record.hourlyRate);
  const laborDescription = sanitizePositionDescription(
    typeof record.laborDescription === "string" ? record.laborDescription : undefined,
  );
  const notesSanitized = sanitizeLooseTextValue(
    typeof record.notes === "string" ? record.notes : undefined,
  ).value;
  const notes = notesSanitized?.trim() ? notesSanitized : undefined;

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

function sanitizePositionDescription(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedCompound = normalizeCraftCompounds(value) ?? value;
  const stripped = stripLeadingNoise(normalizedCompound);
  const cleaned = normalizeWhitespace(
    stripped.cleaned
      .replace(FILLER_TOKEN_PATTERN, " ")
      .replace(
        /\b(?:position|leistung|unterpunkt|bitte|und|dann|noch|circa|ca|eintragen|hinzuf(?:ü|u)gen|notieren)\b/gi,
        " ",
      )
      .replace(/^[,.;:!?()\[\]{}\-]+|[,.;:!?()\[\]{}\-]+$/g, " ")
      .replace(/\s+/g, " "),
  );
  if (!cleaned || isLikelyControlLanguageSegment(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function normalizeDescriptionForComparison(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return normalizeGermanUmlauts(
    (normalizeCraftCompounds(value) ?? value).toLowerCase(),
  )
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .filter((token) => !POSITION_DESCRIPTION_STOPWORDS.has(token))
    .join(" ")
    .trim();
}

function normalizePositionKey(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return normalizeGermanUmlauts(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseEmbeddedQuantityAndUnit(value: string): {
  description: string;
  quantity?: number;
  unit?: string;
} {
  const embeddedMatch = value.match(
    /^(.*?)(\d+(?:[.,]\d+)?)\s*(quadratmetern?|qm|m²|m2|kubikmetern?|cbm|m³|m3|metern?|m|stück|stueck|stk|kilogramm|kg|tonnen?|t|liter|l|stunden?|std|h|tage?|tag|pauschal(?:e)?)$/i,
  );
  if (!embeddedMatch) {
    return { description: value };
  }

  const description = sanitizePositionDescription(embeddedMatch[1]) ?? value;
  const quantity = parseQuantityValue(embeddedMatch[2]);
  const unit = normalizeUnitLabel(embeddedMatch[3]);
  return { description, quantity, unit };
}

function extractTranscriptUnitHints(transcript: string): IntakeVoicePosition[] {
  const hints: IntakeVoicePosition[] = [];
  const seen = new Set<string>();
  const patterns = [
    /([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9\- ]{1,90}?)\s+(\d+(?:[.,]\d+)?)\s*(quadratmetern?|qm|m²|m2|kubikmetern?|cbm|m³|m3|metern?|m|stück|stueck|stk|kilogramm|kg|tonnen?|t|liter|l|stunden?|std|h|tage?|tag|pauschal(?:e)?)/gi,
    /(\d+(?:[.,]\d+)?)\s*(quadratmetern?|qm|m²|m2|kubikmetern?|cbm|m³|m3|metern?|m|stück|stueck|stk|kilogramm|kg|tonnen?|t|liter|l|stunden?|std|h|tage?|tag|pauschal(?:e)?)\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9\- ]{1,90})/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(transcript);
    while (match) {
      const isDescriptionFirst = pattern === patterns[0];
      const rawDescription = isDescriptionFirst ? match[1] : match[3];
      const rawQuantity = isDescriptionFirst ? match[2] : match[1];
      const rawUnit = isDescriptionFirst ? match[3] : match[2];
      const description = sanitizePositionDescription(rawDescription);
      const quantity = parseQuantityValue(rawQuantity);
      const unit = normalizeUnitLabel(rawUnit);

      if (description && quantity && unit) {
        const dedupeKey = `${normalizePositionKey(description)}|${quantity}|${unit}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          hints.push({ description, quantity, unit });
        }
      }
      match = pattern.exec(transcript);
    }
  }

  return hints;
}

function mergePositionsWithTranscriptHints(
  positions: IntakeVoicePosition[] | undefined,
  transcript: string,
): IntakeVoicePosition[] | undefined {
  const basePositions = Array.isArray(positions) ? [...positions] : [];
  const hints = extractTranscriptUnitHints(transcript);
  if (basePositions.length === 0 && hints.length === 0) {
    return undefined;
  }

  const enriched = basePositions.map((position) => {
    const normalizedDescription = sanitizePositionDescription(position.description);
    const embedded =
      normalizedDescription !== undefined
        ? parseEmbeddedQuantityAndUnit(normalizedDescription)
        : { description: normalizedDescription ?? "" };

    return {
      ...position,
      description: embedded.description,
      quantity: parseQuantityValue(position.quantity) ?? embedded.quantity,
      unit:
        normalizeUnitLabel(position.unit) ??
        embedded.unit ??
        position.unit ??
        undefined,
    } satisfies IntakeVoicePosition;
  });

  const usedHintKeys = new Set<string>();
  for (const position of enriched) {
    const positionKey = normalizePositionKey(position.description);
    const matchingHint = hints.find((hint) => {
      const hintKey = normalizePositionKey(hint.description);
      return (
        hintKey &&
        positionKey &&
        (positionKey.includes(hintKey) || hintKey.includes(positionKey))
      );
    });

    if (!matchingHint) {
      continue;
    }

    const hintKey = `${normalizePositionKey(matchingHint.description)}|${matchingHint.quantity}|${matchingHint.unit}`;
    usedHintKeys.add(hintKey);

    if (!position.quantity) {
      position.quantity = matchingHint.quantity;
    }
    if (!position.unit || position.unit === "Pauschal") {
      position.unit = matchingHint.unit;
    }
  }

  for (const hint of hints) {
    const hintKey = `${normalizePositionKey(hint.description)}|${hint.quantity}|${hint.unit}`;
    if (usedHintKeys.has(hintKey)) {
      continue;
    }

    enriched.push({
      description: hint.description ?? "Position",
      quantity: hint.quantity,
      unit: hint.unit,
      unitPrice: undefined,
    });
  }

  const dedupe = new Set<string>();
  const normalized: IntakeVoicePosition[] = [];
  for (const position of enriched) {
    const description = sanitizePositionDescription(position.description);
    if (!description) {
      continue;
    }
    const quantity = parseQuantityValue(position.quantity);
    const unit = normalizeUnitLabel(position.unit) ?? position.unit;
    const unitPrice = parseQuantityValue(position.unitPrice);
    const key = `${normalizePositionKey(position.group)}|${normalizePositionKey(description)}|${quantity ?? ""}|${normalizePositionKey(unit)}|${unitPrice ?? ""}`;
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    normalized.push({
      ...position,
      description,
      quantity,
      unit,
      unitPrice,
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

function buildFallbackPositionFromServiceDescription(
  serviceDescription: string | undefined,
): IntakeVoicePosition[] | undefined {
  const cleaned = sanitizePositionDescription(serviceDescription);
  if (!cleaned) {
    return undefined;
  }
  return [
    {
      description: cleaned,
      quantity: undefined,
      unit: undefined,
      unitPrice: undefined,
    },
  ];
}

function hasRelevantBusinessData(input: {
  fields: Record<string, unknown>;
  positions: IntakeVoicePosition[] | undefined;
  documentType: "offer" | "invoice" | "unknown";
}): boolean {
  if (Array.isArray(input.positions) && input.positions.length > 0) {
    return true;
  }

  const candidateKeys = [
    "companyName",
    "firstName",
    "lastName",
    "street",
    "postalCode",
    "city",
    "customerEmail",
    "serviceDescription",
    "hours",
    "hourlyRate",
    "materialCost",
  ];
  return candidateKeys.some((key) => hasValue(input.fields[key]));
}

function sanitizeTextFieldAndCollectIgnored(
  value: string | undefined,
  ignoredCollector: Set<string>,
): string | undefined {
  const sanitized = sanitizeLooseTextValue(value);
  for (const ignoredValue of sanitized.ignored) {
    ignoredCollector.add(ignoredValue);
  }
  return sanitized.value;
}

function normalizeDocumentTypeForResponse(input: unknown): "offer" | "invoice" | "unknown" {
  const normalized = String(input ?? "").toLowerCase().trim();
  if (normalized === "offer" || normalized === "angebot") {
    return "offer";
  }
  if (normalized === "invoice" || normalized === "rechnung") {
    return "invoice";
  }
  return "unknown";
}

function normalizeConfidenceScore(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed));
    }
  }
  return 0;
}

function hasInvalidPositionDescription(value: string | undefined): boolean {
  const normalizedKey = normalizePositionKey(
    sanitizePositionDescription(value) ?? value,
  );
  return !normalizedKey || INVALID_POSITION_DESCRIPTION_KEYS.has(normalizedKey);
}

function filterMeaningfulPositions(
  positions: IntakeVoicePosition[] | undefined,
): IntakeVoicePosition[] | undefined {
  if (!Array.isArray(positions)) {
    return undefined;
  }

  const filtered = positions.filter(
    (position) => !hasInvalidPositionDescription(position.description),
  );

  return filtered.length > 0 ? filtered : undefined;
}

function isRedundantAutofilledServiceDescription(input: {
  serviceDescription: string | undefined;
  positions: IntakeVoicePosition[] | undefined;
}): boolean {
  const normalizedServiceDescription = normalizeDescriptionForComparison(
    input.serviceDescription,
  );
  if (!normalizedServiceDescription || !Array.isArray(input.positions)) {
    return false;
  }

  return input.positions.some((position) => {
    const normalizedPositionDescription = normalizeDescriptionForComparison(
      position.description,
    );
    if (!normalizedPositionDescription) {
      return false;
    }

    return (
      normalizedPositionDescription === normalizedServiceDescription ||
      normalizedPositionDescription.includes(normalizedServiceDescription) ||
      normalizedServiceDescription.includes(normalizedPositionDescription)
    );
  });
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

function estimateBase64PayloadBytes(base64Payload: string): number {
  const normalized = base64Payload.replace(/\s+/g, "");
  if (!normalized) {
    return 0;
  }

  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;

  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function validatePhotoDataUrl(photoDataUrl: string): {
  ok: boolean;
  status?: number;
  error?: string;
} {
  const normalized = photoDataUrl.trim();
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      error: "Bitte ein Foto aufnehmen oder hochladen.",
    };
  }

  if (!PHOTO_DATA_URL_PATTERN.test(normalized)) {
    return {
      ok: false,
      status: 400,
      error:
        "Ungültiges Fotoformat. Bitte JPG, PNG, WEBP oder GIF verwenden.",
    };
  }

  const payloadStart = normalized.indexOf(",");
  const base64Payload =
    payloadStart >= 0 ? normalized.slice(payloadStart + 1) : normalized;
  const estimatedBytes = estimateBase64PayloadBytes(base64Payload);
  if (estimatedBytes <= 0) {
    return {
      ok: false,
      status: 400,
      error: "Das Foto konnte nicht gelesen werden. Bitte erneut versuchen.",
    };
  }

  if (estimatedBytes > MAX_PHOTO_IMAGE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Das Foto ist zu groß. Bitte auf maximal ${Math.round(
        MAX_PHOTO_IMAGE_BYTES / (1024 * 1024),
      ).toLocaleString("de-DE")} MB verkleinern.`,
    };
  }

  return { ok: true };
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  let requestMode: ParseIntakeInputMode = "voice";

  try {
    const body = (await request.json()) as ParseIntakeRequestBody;
    requestMode = body.inputMode === "photo" ? "photo" : "voice";
    const transcript = body.transcript?.trim() ?? "";
    const photoDataUrl = body.photoDataUrl?.trim() ?? "";
    console.log("[parse-intake] request received", {
      inputMode: requestMode,
      transcriptLength: transcript.length,
      photoPayloadLength: photoDataUrl.length,
    });

    if (requestMode === "voice") {
      if (transcript.length < 8) {
        console.warn("[parse-intake] transcript too short", {
          transcriptLength: transcript.length,
        });
        return NextResponse.json(
          {
            error:
              "Bitte sprich etwas länger, damit ich die Angaben erkennen kann.",
          },
          { status: 400 },
        );
      }

      if (transcript.length > MAX_VOICE_TRANSCRIPT_LENGTH) {
        console.warn("[parse-intake] transcript too long", {
          transcriptLength: transcript.length,
          maxTranscriptLength: MAX_VOICE_TRANSCRIPT_LENGTH,
        });
        return NextResponse.json(
          {
            error: `Die Sprachaufnahme ist zu lang. Bitte auf maximal ${MAX_VOICE_TRANSCRIPT_LENGTH.toLocaleString("de-DE")} Zeichen kürzen.`,
          },
          { status: 413 },
        );
      }
    } else {
      const validation = validatePhotoDataUrl(photoDataUrl);
      if (!validation.ok) {
        console.warn("[parse-intake] invalid photo payload", {
          status: validation.status,
          photoPayloadLength: photoDataUrl.length,
        });
        return NextResponse.json(
          {
            error:
              validation.error ??
              "Fotodaten konnten nicht verarbeitet werden.",
          },
          { status: validation.status ?? 400 },
        );
      }
    }

    const parsed =
      requestMode === "photo"
        ? await parseOfferIntakeFromImage(photoDataUrl)
        : await parseOfferIntake(transcript);
    const sourceText =
      requestMode === "voice" ? transcript : parsed.sourceText?.trim() ?? "";
    const ignoredCollector = new Set<string>(
      Array.isArray(parsed.ignoredText)
        ? parsed.ignoredText
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean)
        : [],
    );
    const parsedDocumentType = normalizeDocumentTypeForResponse(
      parsed.document?.type,
    );
    const documentType = resolveDocumentTypeHint({
      transcript: sourceText,
      parsedType: parsedDocumentType,
    });
    const serviceDescriptionExplicitlyMentioned =
      requestMode === "voice"
        ? shouldAutofillServiceDescription(transcript)
        : Boolean(parsed.fields.serviceDescription?.trim());
    const parsedTimeCalculation = normalizeTimeCalculation(parsed.timeCalculation);
    const mergedPositions = mergePositionsWithTranscriptHints(
      parsed.fields.positions?.map((position) => ({
        ...position,
        group: normalizeCraftCompounds(position.group) ?? position.group,
        description:
          normalizeCraftCompounds(position.description) ?? position.description,
        unit: normalizeUnitLabel(position.unit) ?? position.unit,
      })),
      sourceText,
    );
    const separatedLabor = separateLaborFromPositions(mergedPositions);
    for (const ignoredLaborText of separatedLabor.ignoredLaborText) {
      ignoredCollector.add(ignoredLaborText);
    }
    const normalizedPositionsFromModel = filterMeaningfulPositions(
      separatedLabor.positions,
    );
    const serviceDescriptionCandidate = sanitizeServiceDescription(
      normalizeCraftCompounds(parsed.fields.serviceDescription),
      sourceText,
    );
    const serviceDescriptionResult = serviceDescriptionExplicitlyMentioned
      ? serviceDescriptionCandidate
      : { value: undefined, ignored: serviceDescriptionCandidate.ignored };
    for (const ignoredValue of serviceDescriptionCandidate.ignored) {
      ignoredCollector.add(ignoredValue);
    }
    const normalizedPositions =
      normalizedPositionsFromModel ??
      buildFallbackPositionFromServiceDescription(
        serviceDescriptionCandidate.value,
      );
    const normalizedEmail = normalizeCustomerEmail({
      transcript: sourceText,
      parsedEmail: parsed.fields.customerEmail,
      firstName: parsed.fields.firstName,
      lastName: parsed.fields.lastName,
    });
    const normalizedServiceDescription = isRedundantAutofilledServiceDescription({
      serviceDescription: serviceDescriptionResult.value,
      positions: normalizedPositions,
    })
      ? undefined
      : serviceDescriptionResult.value;
    const laborHours =
      parsedTimeCalculation?.laborHours ??
      parseQuantityValue(parsed.fields.hours) ??
      separatedLabor.laborHours ??
      extractLaborHoursFromSourceText(sourceText);
    const hourlyRate =
      parsedTimeCalculation?.hourlyRate ?? parseQuantityValue(parsed.fields.hourlyRate);
    const normalizedTimeCalculation: IntakeTimeCalculation | undefined =
      laborHours !== undefined ||
      hourlyRate !== undefined ||
      parsedTimeCalculation?.workers !== undefined ||
      parsedTimeCalculation?.laborDescription ||
      parsedTimeCalculation?.notes
        ? {
            laborHours,
            laborDescription: parsedTimeCalculation?.laborDescription,
            workers: parsedTimeCalculation?.workers,
            hourlyRate,
            notes: parsedTimeCalculation?.notes,
          }
        : undefined;
    const normalizedFields = {
      ...parsed.fields,
      positions: normalizedPositions,
      hours: laborHours,
      hourlyRate,
      companyName: sanitizeTextFieldAndCollectIgnored(
        parsed.fields.companyName,
        ignoredCollector,
      ),
      firstName: sanitizeTextFieldAndCollectIgnored(
        parsed.fields.firstName,
        ignoredCollector,
      ),
      lastName: sanitizeTextFieldAndCollectIgnored(
        parsed.fields.lastName,
        ignoredCollector,
      ),
      street: sanitizeTextFieldAndCollectIgnored(
        parsed.fields.street,
        ignoredCollector,
      ),
      postalCode: sanitizeTextFieldAndCollectIgnored(
        parsed.fields.postalCode,
        ignoredCollector,
      ),
      city: sanitizeTextFieldAndCollectIgnored(parsed.fields.city, ignoredCollector),
      customerEmail:
        sanitizeTextFieldAndCollectIgnored(
          normalizedEmail ?? parsed.fields.customerEmail,
          ignoredCollector,
        ) ?? undefined,
      serviceDescription: normalizedServiceDescription,
    };
    const customerType =
      parsed.fields.customerType ??
      (normalizedFields.companyName ? "company" : "person");
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
    const hasRelevantData = hasRelevantBusinessData({
      fields: normalizedFields as Record<string, unknown>,
      positions: normalizedFields.positions,
      documentType,
    });
    const confidence = {
      customer: normalizeConfidenceScore(parsed.confidence?.customer),
      items: normalizeConfidenceScore(parsed.confidence?.items),
      document: normalizeConfidenceScore(parsed.confidence?.document),
    };
    const needsReview =
      typeof parsed.needsReview === "boolean"
        ? parsed.needsReview
        : true;
    const ignoredText = dedupeTextValues(
      Array.from(ignoredCollector)
        .map((entry) => normalizeWhitespace(entry))
        .filter(Boolean),
    );
    console.log("[parse-intake] parsed transcript", {
      inputMode: requestMode,
      usedFallback: parsed.usedFallback,
      fallbackReason: parsed.fallbackReason ?? null,
      missingCount: missingFieldKeys.length,
      positionsCount: normalizedFields.positions?.length ?? 0,
      laborHours: laborHours ?? null,
      documentType,
      ignoredCount: ignoredText.length,
      hasRelevantData,
    });

    if (!hasRelevantData) {
      return NextResponse.json({
        fields: {
          customerType,
        },
        missingFields: [],
        missingFieldKeys: [],
        shouldAutofillServiceDescription: false,
        usedFallback: parsed.usedFallback,
        fallbackReason: parsed.fallbackReason ?? null,
        inputMode: requestMode,
        sourceText: sourceText || null,
        document: {
          type: documentType,
          title: parsed.document?.title ?? "",
          notes: parsed.document?.notes ?? "",
        },
        appointment: parsed.appointment ?? { date: "", time: "" },
        timeCalculation: normalizedTimeCalculation,
        confidence,
        needsReview: true,
        ignoredText,
        noRelevantData: true,
        message:
          "Es konnten keine eindeutigen Kundendaten oder Leistungen erkannt werden.",
      });
    }

    return NextResponse.json({
      fields: {
        ...normalizedFields,
        customerType
      },
      missingFields,
      missingFieldKeys,
      shouldAutofillServiceDescription: serviceDescriptionExplicitlyMentioned,
      usedFallback: parsed.usedFallback,
      fallbackReason: parsed.fallbackReason ?? null,
      inputMode: requestMode,
      sourceText: sourceText || null,
      document: {
        type: documentType,
        title: parsed.document?.title ?? "",
        notes: parsed.document?.notes ?? "",
      },
      appointment: parsed.appointment ?? { date: "", time: "" },
      timeCalculation: normalizedTimeCalculation,
      confidence,
      needsReview,
      ignoredText,
      noRelevantData: false,
    });
  } catch (error) {
    console.error("[parse-intake] failed to process intake", {
      inputMode: requestMode,
      error,
    });
    return NextResponse.json(
      {
        error:
          requestMode === "photo"
            ? "Fotodaten konnten nicht verarbeitet werden."
            : "Sprachdaten konnten nicht verarbeitet werden.",
      },
      { status: 500 },
    );
  }
}
