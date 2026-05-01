import {
  formatIbanForDisplay,
  normalizeBicInput,
  validateIbanInput,
} from "@/lib/iban";
import { AdditionalBankAccount, CompanySettings } from "@/types/offer";

const MAX_BANK_ACCOUNT_ID_LENGTH = 64;
const MAX_BANK_ACCOUNT_LABEL_LENGTH = 80;
const MAX_BANK_NAME_LENGTH = 120;
const MAIN_BANK_ACCOUNT_ID = "main";
const MAX_ADDITIONAL_BANK_ACCOUNTS = 2;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function buildFallbackAdditionalBankAccountId(index: number): string {
  return `additional-${index + 1}`;
}

function buildUniqueAdditionalBankAccountId(input: {
  rawId: string;
  index: number;
  usedIds: Set<string>;
}): string {
  const baseId =
    input.rawId && input.rawId !== MAIN_BANK_ACCOUNT_ID
      ? input.rawId
      : buildFallbackAdditionalBankAccountId(input.index);

  let candidate = baseId;
  let suffix = 2;
  while (input.usedIds.has(candidate) || candidate === MAIN_BANK_ACCOUNT_ID) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function sanitizeAdditionalBankAccounts(
  value: unknown,
): AdditionalBankAccount[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const nextAccounts: AdditionalBankAccount[] = [];
  const usedIds = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    if (nextAccounts.length >= MAX_ADDITIONAL_BANK_ACCOUNTS) {
      break;
    }

    const entry = asObject(value[index]);
    if (!entry) {
      continue;
    }

    const label = asTrimmedString(entry.label, MAX_BANK_ACCOUNT_LABEL_LENGTH);
    const iban = formatIbanForDisplay(asTrimmedString(entry.iban, 64));
    const bic = normalizeBicInput(asTrimmedString(entry.bic, 32));
    const bankName = asTrimmedString(entry.bankName, MAX_BANK_NAME_LENGTH);
    const rawId = asTrimmedString(entry.id, MAX_BANK_ACCOUNT_ID_LENGTH);
    const id = buildUniqueAdditionalBankAccountId({ rawId, index, usedIds });
    usedIds.add(id);

    nextAccounts.push({
      id,
      label,
      iban,
      bic,
      bankName,
    });
  }

  return nextAccounts;
}

export function normalizeDefaultBankAccountId(
  value: unknown,
  additionalBankAccounts: AdditionalBankAccount[],
): string {
  if (typeof value !== "string") {
    return MAIN_BANK_ACCOUNT_ID;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === MAIN_BANK_ACCOUNT_ID) {
    return MAIN_BANK_ACCOUNT_ID;
  }

  return additionalBankAccounts.some((account) => account.id === trimmed)
    ? trimmed
    : MAIN_BANK_ACCOUNT_ID;
}

export function resolvePreferredPaymentBankAccount(settings: Pick<
  CompanySettings,
  | "companyIban"
  | "companyBic"
  | "companyBankName"
  | "additionalBankAccounts"
  | "defaultBankAccountId"
>): {
  accountId: string;
  source: "main" | "additional";
  iban: string;
  bic: string;
  bankName: string;
  isValid: boolean;
} {
  const mainIban = formatIbanForDisplay(settings.companyIban || "");
  const mainBic = normalizeBicInput(settings.companyBic || "");
  const mainBankName = (settings.companyBankName || "").trim();
  const mainValidation = validateIbanInput(mainIban);
  const additionalBankAccounts = sanitizeAdditionalBankAccounts(
    settings.additionalBankAccounts,
  );
  const defaultBankAccountId = normalizeDefaultBankAccountId(
    settings.defaultBankAccountId,
    additionalBankAccounts,
  );

  if (defaultBankAccountId !== MAIN_BANK_ACCOUNT_ID) {
    const selectedAdditionalAccount = additionalBankAccounts.find(
      (account) => account.id === defaultBankAccountId,
    );
    if (selectedAdditionalAccount) {
      const selectedValidation = validateIbanInput(selectedAdditionalAccount.iban);
      if (selectedValidation.isValid) {
        return {
          accountId: selectedAdditionalAccount.id,
          source: "additional",
          iban: selectedValidation.formatted,
          bic: normalizeBicInput(selectedAdditionalAccount.bic),
          bankName: selectedAdditionalAccount.bankName.trim(),
          isValid: true,
        };
      }
    }
  }

  return {
    accountId: MAIN_BANK_ACCOUNT_ID,
    source: "main",
    iban: mainValidation.formatted,
    bic: mainBic,
    bankName: mainBankName,
    isValid: mainValidation.isValid,
  };
}

export {
  MAIN_BANK_ACCOUNT_ID,
  MAX_ADDITIONAL_BANK_ACCOUNTS,
  MAX_BANK_ACCOUNT_LABEL_LENGTH,
};
