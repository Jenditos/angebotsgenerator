export const MAX_VOICE_TRANSCRIPT_LENGTH = 10_000;
export const MAX_EMAIL_ADDRESS_LENGTH = 320;

export const CUSTOMER_TEXT_INPUT_RULES = {
  companyName: { label: "Firmenname", maxLength: 200 },
  firstName: { label: "Vorname", maxLength: 120 },
  lastName: { label: "Nachname", maxLength: 120 },
  street: { label: "Straße", maxLength: 200 },
  postalCode: { label: "Postleitzahl", maxLength: 20 },
  city: { label: "Ort", maxLength: 120 },
  customerEmail: {
    label: "E-Mail-Adresse",
    maxLength: MAX_EMAIL_ADDRESS_LENGTH,
    email: true,
  },
  customerName: { label: "Kundenname", maxLength: 240 },
  customerAddress: { label: "Kundenadresse", maxLength: 500 },
} satisfies TextInputRules;

export const PROJECT_TEXT_INPUT_RULES = {
  projectNumber: { label: "Projektnummer", maxLength: 64 },
  customerNumber: { label: "Kundennummer", maxLength: 64 },
  ...CUSTOMER_TEXT_INPUT_RULES,
  projectName: { label: "Projektname", maxLength: 240 },
  projectAddress: { label: "Projektadresse", maxLength: 500 },
  projectNote: { label: "Projektnotiz", maxLength: 5_000 },
} satisfies TextInputRules;

export const SETTINGS_TEXT_INPUT_RULES = {
  companyName: { label: "Firmenname", maxLength: 200 },
  ownerName: { label: "Inhabername", maxLength: 200 },
  companyStreet: { label: "Firmenstraße", maxLength: 200 },
  companyPostalCode: { label: "Firmen-Postleitzahl", maxLength: 20 },
  companyCity: { label: "Firmensitz", maxLength: 120 },
  companyEmail: {
    label: "Firmen-E-Mail-Adresse",
    maxLength: MAX_EMAIL_ADDRESS_LENGTH,
    email: true,
  },
  companyPhone: { label: "Telefonnummer", maxLength: 50 },
  companyWebsite: { label: "Website", maxLength: 500 },
  companyIban: { label: "IBAN", maxLength: 64 },
  companyBic: { label: "BIC", maxLength: 32 },
  companyBankName: { label: "Bankname", maxLength: 120 },
  defaultBankAccountId: { label: "Standard-Bankkonto", maxLength: 64 },
  taxNumber: { label: "Steuernummer", maxLength: 64 },
  vatId: { label: "Umsatzsteuer-ID", maxLength: 64 },
  companyCountry: { label: "Land", maxLength: 100 },
  euVatNoticeText: { label: "EU-Umsatzsteuerhinweis", maxLength: 2_000 },
  senderCopyEmail: {
    label: "Absender-Kopie-E-Mail-Adresse",
    maxLength: MAX_EMAIL_ADDRESS_LENGTH,
    email: true,
  },
  logoDataUrl: { label: "Logo", maxLength: 6_000_000 },
  offerTermsText: { label: "Angebotsbedingungen", maxLength: 3_000 },
  lastOfferNumber: { label: "Letzte Angebotsnummer", maxLength: 64 },
  lastInvoiceNumber: { label: "Letzte Rechnungsnummer", maxLength: 64 },
} satisfies TextInputRules;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function isValidEmailAddress(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_EMAIL_ADDRESS_LENGTH) {
    return false;
  }

  return EMAIL_PATTERN.test(normalized);
}

type TextInputRule = {
  label: string;
  maxLength: number;
  email?: boolean;
};

type TextInputRules = Record<string, TextInputRule>;

type TextInputValidationResult =
  | {
      ok: true;
      values: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
    };

export function validateTextInputs(
  input: Record<string, unknown>,
  rules: TextInputRules,
): TextInputValidationResult {
  const values: Record<string, string> = {};

  for (const [field, rule] of Object.entries(rules)) {
    const rawValue = input[field];
    if (typeof rawValue === "undefined") {
      values[field] = "";
      continue;
    }

    if (typeof rawValue !== "string") {
      return {
        ok: false,
        error: `${rule.label} muss als Text angegeben werden.`,
      };
    }

    const value = rawValue.trim();
    if (value.length > rule.maxLength) {
      return {
        ok: false,
        error: `${rule.label} darf maximal ${rule.maxLength.toLocaleString(
          "de-DE",
        )} Zeichen lang sein.`,
      };
    }

    if (rule.email && value && !isValidEmailAddress(value)) {
      return {
        ok: false,
        error: `Bitte eine gültige ${rule.label} angeben.`,
      };
    }

    values[field] = value;
  }

  return { ok: true, values };
}

export class UserInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputValidationError";
  }
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new UserInputValidationError(
      "Die Anfrage enthält kein gültiges JSON.",
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new UserInputValidationError(
      "Die Anfrage muss ein JSON-Objekt enthalten.",
    );
  }

  return payload as Record<string, unknown>;
}
