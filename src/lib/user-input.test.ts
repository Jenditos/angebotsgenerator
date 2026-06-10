import {
  CUSTOMER_TEXT_INPUT_RULES,
  readJsonObject,
  SETTINGS_TEXT_INPUT_RULES,
  UserInputValidationError,
  validateTextInputs,
} from "@/lib/user-input";

describe("user-input", () => {
  it("rejects invalid optional email addresses", () => {
    const result = validateTextInputs(
      { customerEmail: "keine-email" },
      CUSTOMER_TEXT_INPUT_RULES,
    );

    expect(result).toEqual({
      ok: false,
      error: "Bitte eine gültige E-Mail-Adresse angeben.",
    });
  });

  it("rejects oversized settings text with a clear limit", () => {
    const result = validateTextInputs(
      { offerTermsText: "a".repeat(3_001) },
      SETTINGS_TEXT_INPUT_RULES,
    );

    expect(result).toEqual({
      ok: false,
      error: "Angebotsbedingungen darf maximal 3.000 Zeichen lang sein.",
    });
  });

  it("rejects malformed JSON as user input", async () => {
    const request = new Request("https://example.com/api/customers", {
      method: "POST",
      body: "{",
    });

    await expect(readJsonObject(request)).rejects.toEqual(
      new UserInputValidationError("Die Anfrage enthält kein gültiges JSON."),
    );
  });
});
