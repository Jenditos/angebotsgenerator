import {
  appendDocumentTaxNotice,
  buildDocumentTaxLabel,
  detectDocumentTaxInfo,
  resolveDocumentTax,
} from "@/lib/document-tax";

describe("document-tax helpers", () => {
  it("detects reverse-charge notice text", () => {
    expect(
      detectDocumentTaxInfo(
        "Bei den vorgenannten Leistungen handelt es sich um sonstige Leistungen EG nach § 13b UStG. Der Leistungsempfänger schuldet die Umsatzsteuer (Reverse-Charge)",
      ),
    ).toEqual(
      expect.objectContaining({
        treatment: "reverse_charge",
      }),
    );
  });

  it("suppresses vat when reverse-charge is detected for the document", () => {
    expect(
      resolveDocumentTax({
        vatRate: 19,
        documentTax: {
          treatment: "reverse_charge",
          noticeText:
            "Der Leistungsempfänger schuldet die Umsatzsteuer (Reverse-Charge).",
        },
      }),
    ).toEqual(
      expect.objectContaining({
        treatment: "reverse_charge",
        vatRate: 0,
      }),
    );
  });

  it("suppresses vat when company notice contains a tax exemption hint", () => {
    expect(
      resolveDocumentTax({
        vatRate: 19,
        settingsNoticeText:
          "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
      }),
    ).toEqual(
      expect.objectContaining({
        treatment: "vat_exempt",
        vatRate: 0,
      }),
    );
  });

  it("builds a readable zero-vat label", () => {
    expect(
      buildDocumentTaxLabel({
        treatment: "reverse_charge",
        vatRate: 0,
      }),
    ).toBe("Keine MwSt. (Reverse-Charge)");
  });

  it("appends notice text without duplicating it", () => {
    expect(
      appendDocumentTaxNotice(
        "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
        "Der Leistungsempfänger schuldet die Umsatzsteuer.",
      ),
    ).toBe(
      "Zahlbar innerhalb von 14 Tagen ohne Abzug. Der Leistungsempfänger schuldet die Umsatzsteuer.",
    );
    expect(
      appendDocumentTaxNotice(
        "Der Leistungsempfänger schuldet die Umsatzsteuer.",
        "Der Leistungsempfänger schuldet die Umsatzsteuer.",
      ),
    ).toBe("Der Leistungsempfänger schuldet die Umsatzsteuer.");
  });
});
