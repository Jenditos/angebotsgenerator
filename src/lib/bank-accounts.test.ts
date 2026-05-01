import {
  MAIN_BANK_ACCOUNT_ID,
  MAX_ADDITIONAL_BANK_ACCOUNTS,
  normalizeDefaultBankAccountId,
  resolvePreferredPaymentBankAccount,
  sanitizeAdditionalBankAccounts,
} from "@/lib/bank-accounts";

describe("bank-accounts", () => {
  test("sanitizeAdditionalBankAccounts limits the number of additional accounts", () => {
    const sanitized = sanitizeAdditionalBankAccounts([
      { id: "a1", iban: "DE89 3704 0044 0532 0130 00" },
      { id: "a2", iban: "DE44 5001 0517 5407 3249 31" },
      { id: "a3", iban: "DE12 1002 0500 0001 2345 67" },
    ]);

    expect(sanitized).toHaveLength(MAX_ADDITIONAL_BANK_ACCOUNTS);
    expect(sanitized[0]?.id).toBe("a1");
    expect(sanitized[1]?.id).toBe("a2");
  });

  test("normalizeDefaultBankAccountId falls back to main for unknown ids", () => {
    const accounts = sanitizeAdditionalBankAccounts([
      { id: "extra-1", iban: "DE89 3704 0044 0532 0130 00" },
    ]);

    expect(normalizeDefaultBankAccountId("extra-1", accounts)).toBe("extra-1");
    expect(normalizeDefaultBankAccountId("unknown", accounts)).toBe(
      MAIN_BANK_ACCOUNT_ID,
    );
  });

  test("resolvePreferredPaymentBankAccount uses valid additional default account", () => {
    const preferred = resolvePreferredPaymentBankAccount({
      companyIban: "DE44 5001 0517 5407 3249 31",
      companyBic: "GENODEF1P06",
      companyBankName: "Main Bank",
      additionalBankAccounts: [
        {
          id: "extra-1",
          label: "Reserve",
          iban: "DE89 3704 0044 0532 0130 00",
          bic: "COBADEFFXXX",
          bankName: "Zusatzbank",
        },
      ],
      defaultBankAccountId: "extra-1",
    });

    expect(preferred.source).toBe("additional");
    expect(preferred.accountId).toBe("extra-1");
    expect(preferred.isValid).toBe(true);
    expect(preferred.bankName).toBe("Zusatzbank");
  });

  test("resolvePreferredPaymentBankAccount falls back to main if selected additional account is invalid", () => {
    const preferred = resolvePreferredPaymentBankAccount({
      companyIban: "DE44 5001 0517 5407 3249 31",
      companyBic: "GENODEF1P06",
      companyBankName: "Main Bank",
      additionalBankAccounts: [
        {
          id: "extra-1",
          label: "Reserve",
          iban: "INVALID",
          bic: "COBADEFFXXX",
          bankName: "Zusatzbank",
        },
      ],
      defaultBankAccountId: "extra-1",
    });

    expect(preferred.source).toBe("main");
    expect(preferred.accountId).toBe(MAIN_BANK_ACCOUNT_ID);
    expect(preferred.isValid).toBe(true);
  });

  test("resolvePreferredPaymentBankAccount stays valid with additional default even when main iban is invalid", () => {
    const preferred = resolvePreferredPaymentBankAccount({
      companyIban: "INVALID",
      companyBic: "GENODEF1P06",
      companyBankName: "Main Bank",
      additionalBankAccounts: [
        {
          id: "extra-1",
          label: "Reserve",
          iban: "DE89 3704 0044 0532 0130 00",
          bic: "COBADEFFXXX",
          bankName: "Zusatzbank",
        },
      ],
      defaultBankAccountId: "extra-1",
    });

    expect(preferred.source).toBe("additional");
    expect(preferred.isValid).toBe(true);
  });
});
