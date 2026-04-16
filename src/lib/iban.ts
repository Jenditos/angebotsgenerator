// Country-specific IBAN lengths. Unknown countries fall back to 15-34 chars.
const IBAN_LENGTH_BY_COUNTRY: Record<string, number> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SC: 31,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
};

function removeNonAlphaNumeric(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "");
}

function calculateIbanChecksumRemainder(normalizedIban: string): number {
  const rearranged = `${normalizedIban.slice(4)}${normalizedIban.slice(0, 4)}`;
  let remainder = 0;

  for (const character of rearranged) {
    const numericRepresentation =
      character >= "0" && character <= "9"
        ? character
        : String(character.charCodeAt(0) - 55);

    for (const digitChar of numericRepresentation) {
      remainder = (remainder * 10 + Number(digitChar)) % 97;
    }
  }

  return remainder;
}

export function normalizeIbanInput(value: string): string {
  return removeNonAlphaNumeric(value).toUpperCase();
}

export function formatIbanForDisplay(value: string): string {
  const normalized = normalizeIbanInput(value);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/(.{4})/g, "$1 ").trim();
}

export function normalizeBicInput(value: string): string {
  return removeNonAlphaNumeric(value).toUpperCase().slice(0, 11);
}

export function validateIbanInput(value: string): {
  isValid: boolean;
  normalized: string;
  formatted: string;
  message: string;
} {
  const normalized = normalizeIbanInput(value);
  const formatted = formatIbanForDisplay(normalized);

  if (!normalized) {
    return {
      isValid: false,
      normalized,
      formatted,
      message: "Bitte geben Sie eine IBAN ein.",
    };
  }

  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalized)) {
    return {
      isValid: false,
      normalized,
      formatted,
      message:
        "Die IBAN muss mit einem Ländercode und zwei Prüfziffern beginnen.",
    };
  }

  if (normalized.length < 15 || normalized.length > 34) {
    return {
      isValid: false,
      normalized,
      formatted,
      message: "Die IBAN muss zwischen 15 und 34 Zeichen lang sein.",
    };
  }

  const countryCode = normalized.slice(0, 2);
  const expectedLength = IBAN_LENGTH_BY_COUNTRY[countryCode];
  if (expectedLength && normalized.length !== expectedLength) {
    return {
      isValid: false,
      normalized,
      formatted,
      message: `Für ${countryCode} muss die IBAN ${expectedLength} Zeichen lang sein.`,
    };
  }

  if (calculateIbanChecksumRemainder(normalized) !== 1) {
    return {
      isValid: false,
      normalized,
      formatted,
      message: "Die IBAN-Prüfziffer ist ungültig. Bitte Eingabe prüfen.",
    };
  }

  return {
    isValid: true,
    normalized,
    formatted,
    message: "IBAN ist formal gültig (lokale Prüfung).",
  };
}
