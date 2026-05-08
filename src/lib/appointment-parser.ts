import {
  AppointmentType,
  DocumentType,
  StoredCustomerRecord,
  StoredOfferRecord,
  StoredProjectRecord,
} from "@/types/offer";

export type AppointmentMatchStatus =
  | "matched"
  | "suggested"
  | "ambiguous"
  | "not_found";

export type AppointmentParseCandidate = {
  id: string;
  displayName: string;
  secondaryText?: string;
  documentType?: DocumentType;
  score: number;
};

export type AppointmentParseMatch = {
  status: AppointmentMatchStatus;
  id?: string;
  displayName?: string;
  documentType?: DocumentType;
  candidates?: AppointmentParseCandidate[];
};

export type AppointmentParseDocumentContext = {
  documentNumber: string;
  documentType?: DocumentType;
  customerName?: string;
  projectName?: string;
};

export type AppointmentParseContext = {
  now?: Date;
  customers?: StoredCustomerRecord[];
  projects?: StoredProjectRecord[];
  documents?: AppointmentParseDocumentContext[];
};

export type AppointmentParseResult = {
  title: string;
  type: AppointmentType;
  customerMatch: AppointmentParseMatch | null;
  projectMatch: AppointmentParseMatch | null;
  documentMatch: AppointmentParseMatch | null;
  description: string;
  location: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  reminderEnabled: boolean;
  reminderMinutesBefore?: number;
  confidenceScore: number;
  warnings: string[];
};

type DateParseResult = {
  date: string;
  warning?: string;
};

type TimeParseResult = {
  time: string;
  warning?: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
};

const GERMAN_NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einer: 1,
  eins: 1,
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
};

const COMPANY_SUFFIXES = new Set([
  "ag",
  "firma",
  "gbr",
  "gmbh",
  "kg",
  "ohg",
  "ug",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dateToInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeToInputValue(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(
    value.getMinutes(),
  ).padStart(2, "0")}`;
}

function combineLocalDateTime(dateValue: string, timeValue: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) {
    return null;
  }

  const parsed = new Date(`${dateValue}T${timeValue}:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + days);
  return next;
}

function getNextWeekday(base: Date, targetWeekday: number, forceFuture: boolean): Date {
  const start = addDays(base, 0);
  let delta = targetWeekday - start.getDay();
  if (delta < 0 || (forceFuture && delta === 0)) {
    delta += 7;
  }
  return addDays(start, delta);
}

function parseGermanRelativeDate(inputText: string, now: Date): DateParseResult {
  const normalized = normalizeSearchText(inputText);
  const today = addDays(now, 0);

  const inHoursMatch = normalized.match(/\bin\s+(\d+)\s+stunden?\b/);
  if (inHoursMatch) {
    const hours = Number(inHoursMatch[1]);
    if (Number.isFinite(hours) && hours > 0) {
      const target = new Date(now.getTime() + hours * 60 * 60 * 1000);
      return { date: dateToInputValue(target) };
    }
  }

  if (/\bheute\b/.test(normalized)) {
    return { date: dateToInputValue(today) };
  }
  if (/\buebermorgen\b/.test(normalized) || /\bubermorgen\b/.test(normalized)) {
    return { date: dateToInputValue(addDays(today, 2)) };
  }
  if (/\bmorgen\b/.test(normalized)) {
    return { date: dateToInputValue(addDays(today, 1)) };
  }

  for (const [weekday, weekdayIndex] of Object.entries(WEEKDAY_INDEX)) {
    const nextWeekdayPattern = new RegExp(
      `\\b(?:naechsten|nachsten|kommenden)\\s+${weekday}\\b`,
    );
    if (nextWeekdayPattern.test(normalized)) {
      return { date: dateToInputValue(getNextWeekday(today, weekdayIndex, true)) };
    }
  }

  for (const [weekday, weekdayIndex] of Object.entries(WEEKDAY_INDEX)) {
    const weekdayPattern = new RegExp(`\\b${weekday}\\b`);
    if (weekdayPattern.test(normalized)) {
      return { date: dateToInputValue(getNextWeekday(today, weekdayIndex, false)) };
    }
  }

  if (/\bende\s+der\s+woche\b/.test(normalized)) {
    return {
      date: dateToInputValue(getNextWeekday(today, WEEKDAY_INDEX.freitag, false)),
      warning: "Ende der Woche wurde als Freitag vorgeschlagen. Bitte prüfen.",
    };
  }

  if (/\bnaechste\s+woche\b|\bnachste\s+woche\b/.test(normalized)) {
    return {
      date: "",
      warning: "Nächste Woche ist zu ungenau. Bitte Datum oder Wochentag ergänzen.",
    };
  }

  const numericDateMatch = inputText.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\b/);
  if (numericDateMatch) {
    const day = Number(numericDateMatch[1]);
    const month = Number(numericDateMatch[2]);
    const year =
      numericDateMatch[3] && numericDateMatch[3].length === 2
        ? 2000 + Number(numericDateMatch[3])
        : numericDateMatch[3]
          ? Number(numericDateMatch[3])
          : now.getFullYear();
    const parsed = new Date(year, month - 1, day);
    if (
      Number.isFinite(parsed.getTime()) &&
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return { date: dateToInputValue(parsed) };
    }
  }

  return {
    date: "",
    warning: "Datum fehlt oder ist unklar. Bitte ergänzen.",
  };
}

function normalizeHour(hour: number, periodHint: string): number {
  if (hour < 0 || hour > 23) {
    return hour;
  }
  if (!periodHint) {
    return hour;
  }
  if ((periodHint === "nachmittag" || periodHint === "abend") && hour < 12) {
    return hour + 12;
  }
  return hour;
}

function parseGermanTime(inputText: string, now: Date): TimeParseResult {
  const normalized = normalizeSearchText(inputText);
  const inHoursMatch = normalized.match(/\bin\s+(\d+)\s+stunden?\b/);
  if (inHoursMatch) {
    const hours = Number(inHoursMatch[1]);
    if (Number.isFinite(hours) && hours > 0) {
      return { time: timeToInputValue(new Date(now.getTime() + hours * 60 * 60 * 1000)) };
    }
  }

  const timeMatch =
    inputText.match(
      /\b(?:um\s*)?(\d{1,2})(?::|\.)(\d{2})\s*(?:uhr)?\b/i,
    ) ?? inputText.match(/\b(?:um\s*)?(\d{1,2})\s*uhr\b/i);
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    const periodHint = /\bnachmittag/.test(normalized)
      ? "nachmittag"
      : /\babend/.test(normalized)
        ? "abend"
        : "";
    const normalizedHour = normalizeHour(hour, periodHint);
    if (
      Number.isFinite(normalizedHour) &&
      normalizedHour >= 0 &&
      normalizedHour <= 23 &&
      Number.isFinite(minute) &&
      minute >= 0 &&
      minute <= 59
    ) {
      return {
        time: `${String(normalizedHour).padStart(2, "0")}:${String(
          minute,
        ).padStart(2, "0")}`,
      };
    }
  }

  if (/\bmorgens\b|\bvormittags\b/.test(normalized)) {
    return {
      time: "09:00",
      warning: "Keine genaue Uhrzeit erkannt. 09:00 wurde vorgeschlagen.",
    };
  }
  if (/\bnachmittags\b|\bnachmittag\b/.test(normalized)) {
    return {
      time: "15:00",
      warning: "Keine genaue Uhrzeit erkannt. 15:00 wurde vorgeschlagen.",
    };
  }
  if (/\babends\b|\babend\b/.test(normalized)) {
    return {
      time: "18:00",
      warning: "Keine genaue Uhrzeit erkannt. 18:00 wurde vorgeschlagen.",
    };
  }

  return {
    time: "",
    warning: "Uhrzeit fehlt oder ist unklar. Bitte ergänzen.",
  };
}

function parseReminderMinutes(inputText: string): number | undefined {
  const normalized = normalizeSearchText(inputText);
  if (!/\berinner/.test(normalized)) {
    return undefined;
  }

  const numericMinutes = normalized.match(/\b(\d+)\s+minuten?\s+vorher\b/);
  if (numericMinutes) {
    return Number(numericMinutes[1]);
  }

  const numericHours = normalized.match(/\b(\d+)\s+stunden?\s+vorher\b/);
  if (numericHours) {
    return Number(numericHours[1]) * 60;
  }

  for (const [word, value] of Object.entries(GERMAN_NUMBER_WORDS)) {
    const hourPattern = new RegExp(`\\b${word}\\s+stunden?\\s+vorher\\b`);
    if (hourPattern.test(normalized)) {
      return value * 60;
    }
  }

  return 60;
}

function detectAppointmentType(inputText: string): AppointmentType {
  const normalized = normalizeSearchText(inputText);
  if (/\bzahlungserinnerung\b|\bmahnung\b|\bzahlung\s+erinner/.test(normalized)) {
    return "payment_reminder";
  }
  if (/\brechnung\s+(?:pruefen|prufen)\b|\brechnungs(?:pruefung|prufung)\b/.test(normalized)) {
    return "invoice_check";
  }
  if (/\brueckruf\b|\bruckruf\b|\bzurueckrufen\b|\btelefon\b/.test(normalized)) {
    return "callback";
  }
  if (/\bbesichtigung\b|\bvor\s+ort\b|\baufmass\b|\baufmass\b/.test(normalized)) {
    return "site_visit";
  }
  if (/\bausfuehrung\b|\bausfuhrung\b|\barbeitstermin\b|\bbaustelle\b/.test(normalized)) {
    return "work";
  }
  if (/\bnachfass/.test(normalized) || /\bangebot\b/.test(normalized)) {
    return "follow_up";
  }
  return "other";
}

function typeToTitle(type: AppointmentType): string {
  switch (type) {
    case "site_visit":
      return "Besichtigung";
    case "work":
      return "Ausführung";
    case "callback":
      return "Rückruf";
    case "follow_up":
      return "Angebot nachfassen";
    case "payment_reminder":
      return "Zahlungserinnerung";
    case "invoice_check":
      return "Rechnung prüfen";
    default:
      return "Termin";
  }
}

function scoreTextAgainstInput(inputText: string, label: string): number {
  const normalizedInput = ` ${normalizeSearchText(inputText)} `;
  const normalizedLabel = normalizeSearchText(label);
  if (!normalizedInput.trim() || !normalizedLabel) {
    return 0;
  }

  if (normalizedInput.includes(` ${normalizedLabel} `)) {
    return 100;
  }

  const tokens = normalizedLabel
    .split(" ")
    .filter((token) => token.length >= 3 && !COMPANY_SUFFIXES.has(token));
  if (tokens.length === 0) {
    return 0;
  }

  const matched = tokens.filter((token) => normalizedInput.includes(` ${token} `));
  if (matched.length === 0) {
    return 0;
  }

  return Math.round((matched.length / tokens.length) * 85);
}

function createMatchFromCandidates(
  candidates: AppointmentParseCandidate[],
  options?: { suggested?: boolean; ambiguousIfMultiple?: boolean },
): AppointmentParseMatch | null {
  const sorted = candidates
    .filter((candidate) => candidate.score >= 40)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  if (sorted.length === 0) {
    return null;
  }

  const bestScore = sorted[0].score;
  const closeMatches = sorted.filter((candidate) => bestScore - candidate.score <= 8);
  if (closeMatches.length > 1 || (options?.ambiguousIfMultiple && sorted.length > 1)) {
    return {
      status: "ambiguous",
      candidates: options?.ambiguousIfMultiple ? sorted : closeMatches,
    };
  }

  return {
    status: options?.suggested ? "suggested" : "matched",
    id: sorted[0].id,
    displayName: sorted[0].displayName,
    documentType: sorted[0].documentType,
    candidates: sorted,
  };
}

function matchCustomer(
  inputText: string,
  customers: StoredCustomerRecord[],
): AppointmentParseMatch | null {
  const candidates = customers.map((customer) => ({
    id: customer.customerNumber,
    displayName: customer.customerName,
    secondaryText: customer.customerAddress,
    score: Math.max(
      scoreTextAgainstInput(inputText, customer.customerName),
      scoreTextAgainstInput(inputText, customer.companyName),
      scoreTextAgainstInput(inputText, customer.lastName),
    ),
  }));

  return createMatchFromCandidates(candidates, { ambiguousIfMultiple: true });
}

function matchProject(
  inputText: string,
  projects: StoredProjectRecord[],
  customerMatch: AppointmentParseMatch | null,
): AppointmentParseMatch | null {
  const candidates = projects.map((project) => {
    const customerBonus =
      customerMatch?.status === "matched" &&
      customerMatch.id &&
      project.customerNumber === customerMatch.id
        ? 12
        : 0;
    return {
      id: project.projectNumber,
      displayName: project.projectName,
      secondaryText: project.customerName,
      score: Math.max(
        scoreTextAgainstInput(inputText, project.projectName),
        scoreTextAgainstInput(inputText, project.projectAddress),
      ) + customerBonus,
    };
  });

  return createMatchFromCandidates(candidates, { suggested: true });
}

function matchDocument(
  inputText: string,
  documents: AppointmentParseDocumentContext[],
): AppointmentParseMatch | null {
  const normalized = normalizeSearchText(inputText);
  const numberMatch = normalized.match(/\b(?:rechnung|angebot|nr|nummer)?\s*(\d{3,})\b/);
  const explicitNumber = numberMatch?.[1] ?? "";
  const wantsInvoice = /\brechnung\b/.test(normalized);
  const wantsOffer = /\bangebot\b/.test(normalized);

  const candidates = documents.map((document) => {
    const normalizedNumber = normalizeSearchText(document.documentNumber);
    let score = 0;
    if (explicitNumber && normalizedNumber.includes(explicitNumber)) {
      score += 100;
    } else {
      score = Math.max(
        scoreTextAgainstInput(inputText, document.documentNumber),
        scoreTextAgainstInput(inputText, document.projectName ?? ""),
      );
    }
    if (wantsInvoice && document.documentType === "invoice") {
      score += 8;
    }
    if (wantsOffer && document.documentType === "offer") {
      score += 8;
    }

    return {
      id: document.documentNumber,
      displayName: document.documentNumber,
      secondaryText: document.projectName || document.customerName,
      documentType: document.documentType,
      score,
    };
  });

  return createMatchFromCandidates(candidates, { suggested: true });
}

function detectLocation(inputText: string): string {
  const match = inputText.match(/\b(?:in|nach)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-\s]{2,40})(?:[,.;]|$)/);
  if (!match?.[1]) {
    return "";
  }

  return normalizeWhitespace(match[1])
    .replace(/\b(?:wegen|zur|zum|fuer|für|mit)\b.*$/i, "")
    .trim();
}

function buildTitle(
  type: AppointmentType,
  customerMatch: AppointmentParseMatch | null,
  inputText: string,
): string {
  const base = typeToTitle(type);
  if (customerMatch?.status === "matched" && customerMatch.displayName) {
    return `${base} bei ${customerMatch.displayName}`;
  }

  const nameMatch = inputText.match(/\bbei\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]{2,40})\b/);
  if (nameMatch?.[1]) {
    return `${base} bei ${nameMatch[1].trim()}`;
  }

  return base;
}

function buildWarnings(
  dateResult: DateParseResult,
  timeResult: TimeParseResult,
  customerMatch: AppointmentParseMatch | null,
  projectMatch: AppointmentParseMatch | null,
  documentMatch: AppointmentParseMatch | null,
): string[] {
  const warnings = [dateResult.warning, timeResult.warning].filter(
    (value): value is string => Boolean(value),
  );

  if (customerMatch?.status === "ambiguous") {
    warnings.push("Kunde nicht eindeutig erkannt. Bitte auswählen.");
  }
  if (projectMatch?.status === "ambiguous") {
    warnings.push("Projekt nicht eindeutig erkannt. Bitte auswählen.");
  }
  if (documentMatch?.status === "ambiguous") {
    warnings.push("Dokument nicht eindeutig erkannt. Bitte prüfen.");
  }

  return Array.from(new Set(warnings));
}

export function toAppointmentDocumentContext(
  record: StoredOfferRecord,
): AppointmentParseDocumentContext {
  return {
    documentNumber: record.offerNumber,
    documentType: record.documentType,
    customerName: record.customerName,
    projectName: record.projectName,
  };
}

export function parseAppointmentInput(
  inputText: string,
  context: AppointmentParseContext = {},
): AppointmentParseResult {
  const cleanedInput = normalizeWhitespace(inputText).slice(0, 2000);
  const now = context.now ?? new Date();
  const dateResult = parseGermanRelativeDate(cleanedInput, now);
  const timeResult = parseGermanTime(cleanedInput, now);
  const type = detectAppointmentType(cleanedInput);
  const customerMatch = matchCustomer(cleanedInput, context.customers ?? []);
  const projectMatch = matchProject(
    cleanedInput,
    context.projects ?? [],
    customerMatch,
  );
  const documentMatch = matchDocument(cleanedInput, context.documents ?? []);
  const reminderMinutesBefore = parseReminderMinutes(cleanedInput);
  const startsAt =
    dateResult.date && timeResult.time
      ? combineLocalDateTime(dateResult.date, timeResult.time)
      : null;
  const durationMinutes = 60;
  const endsAt = startsAt
    ? new Date(startsAt.getTime() + durationMinutes * 60 * 1000)
    : null;
  const warnings = buildWarnings(
    dateResult,
    timeResult,
    customerMatch,
    projectMatch,
    documentMatch,
  );
  const location = detectLocation(cleanedInput);
  const title = buildTitle(type, customerMatch, cleanedInput);
  const hasCoreTime = Boolean(dateResult.date && timeResult.time);
  const confidenceScore = Math.max(
    0.35,
    Math.min(
      0.94,
      0.48 +
        (hasCoreTime ? 0.22 : 0) +
        (type !== "other" ? 0.12 : 0) +
        (customerMatch?.status === "matched" ? 0.08 : 0) +
        (projectMatch?.status === "matched" ||
        projectMatch?.status === "suggested"
          ? 0.05
          : 0) -
        warnings.length * 0.07,
    ),
  );

  return {
    title,
    type,
    customerMatch,
    projectMatch,
    documentMatch,
    description: cleanedInput,
    location,
    date: dateResult.date,
    startTime: timeResult.time,
    durationMinutes,
    startsAt: startsAt ? `${dateToInputValue(startsAt)}T${timeToInputValue(startsAt)}:00` : "",
    endsAt: endsAt ? `${dateToInputValue(endsAt)}T${timeToInputValue(endsAt)}:00` : "",
    allDay: false,
    reminderEnabled: typeof reminderMinutesBefore === "number",
    reminderMinutesBefore,
    confidenceScore: Number(confidenceScore.toFixed(2)),
    warnings,
  };
}
