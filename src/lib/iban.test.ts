import {
  formatIbanForDisplay,
  normalizeBicInput,
  validateIbanInput,
} from "@/lib/iban";

describe("iban utility", () => {
  it("formats and validates a correct IBAN", () => {
    const validation = validateIbanInput("de89370400440532013000");
    expect(validation.isValid).toBe(true);
    expect(validation.formatted).toBe("DE89 3704 0044 0532 0130 00");
  });

  it("rejects an IBAN with invalid checksum", () => {
    const validation = validateIbanInput("DE89 3704 0044 0532 0130 01");
    expect(validation.isValid).toBe(false);
  });

  it("rejects an IBAN with country length mismatch", () => {
    const validation = validateIbanInput("DE8937040044053201300");
    expect(validation.isValid).toBe(false);
    expect(validation.message).toContain("22 Zeichen");
  });

  it("normalizes BIC input", () => {
    expect(normalizeBicInput("coba de ff xxx")).toBe("COBADEFFXXX");
  });

  it("allows longer BIC-like input without stopping after 11 characters", () => {
    expect(normalizeBicInput("abcd efgh ijkl mnop qrst uvwx yz12 3456")).toBe(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456".slice(0, 32),
    );
  });

  it("formats IBAN in 4-char groups", () => {
    expect(formatIbanForDisplay("DE89370400440532013000")).toBe(
      "DE89 3704 0044 0532 0130 00",
    );
  });
});
