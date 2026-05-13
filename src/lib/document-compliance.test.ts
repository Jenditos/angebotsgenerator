import { buildDocumentComplianceReport } from "@/lib/document-compliance";
import { CompanySettings, OfferPdfLineItem } from "@/types/offer";

function createSettings(overrides: Partial<CompanySettings> = {}): CompanySettings {
  return {
    companyName: "VISIORO Handwerk GmbH",
    ownerName: "",
    companyStreet: "Musterstrasse 1",
    companyPostalCode: "40210",
    companyCity: "Duesseldorf",
    companyEmail: "info@example.com",
    companyPhone: "",
    companyWebsite: "",
    companyIban: "DE89370400440532013000",
    companyBic: "COBADEFFXXX",
    companyBankName: "Musterbank",
    ibanVerificationStatus: "valid",
    additionalBankAccounts: [],
    defaultBankAccountId: "main",
    taxNumber: "123/456/7890",
    vatId: "",
    companyCountry: "DE",
    euVatNoticeText: "",
    includeCustomerVatId: false,
    senderCopyEmail: "",
    logoDataUrl: "",
    pdfTableColumns: [],
    customServices: [],
    vatRate: 19,
    offerValidityDays: 30,
    invoicePaymentDueDays: 14,
    latePaymentInterestEnabled: false,
    latePaymentConsumerAnnualInterestPercent: 6.27,
    latePaymentBusinessAnnualInterestPercent: 10.27,
    latePaymentGraceDays: 0,
    offerTermsText: "",
    lastOfferNumber: "",
    lastInvoiceNumber: "",
    customServiceTypes: [],
    ...overrides,
  };
}

const lineItems: OfferPdfLineItem[] = [
  {
    position: 1,
    quantity: 2,
    description: "Wand spachteln",
    unit: "Std.",
    unitPrice: 120,
    totalPrice: 240,
  },
];

describe("document-compliance", () => {
  it("blocks documents when tax identity is missing", () => {
    const report = buildDocumentComplianceReport({
      documentType: "offer",
      customerType: "person",
      customerName: "Max Muster",
      customerAddress: "Kundenweg 1, 40210 Duesseldorf",
      customerEmail: "kunde@example.com",
      serviceDescription: "Wand spachteln",
      lineItems,
      settings: createSettings({ taxNumber: "", vatId: "" }),
      checkedAt: new Date("2026-01-01T10:00:00.000Z"),
    });

    expect(report.status).toBe("blocked");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "tax_identity_missing",
          severity: "error",
        }),
      ]),
    );
  });

  it("warns for B2B invoices without a structured e-invoice file", () => {
    const report = buildDocumentComplianceReport({
      documentType: "invoice",
      customerType: "company",
      customerName: "Musterbau GmbH",
      customerAddress: "Kundenweg 1, 40210 Duesseldorf",
      customerEmail: "buchhaltung@example.com",
      serviceDescription: "Badsanierung",
      lineItems: [
        {
          ...lineItems[0],
          totalPrice: 1200,
          unitPrice: 600,
        },
      ],
      settings: createSettings(),
      invoiceDate: "2026-01-01",
      serviceDate: "01.01.2026 - 05.01.2026",
      paymentDueDays: 14,
      checkedAt: new Date("2026-01-01T10:00:00.000Z"),
    });

    expect(report.status).toBe("warning");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "structured_e_invoice_missing",
          severity: "warning",
        }),
      ]),
    );
  });

  it("marks complete consumer invoice basics as ready", () => {
    const report = buildDocumentComplianceReport({
      documentType: "invoice",
      customerType: "person",
      customerName: "Max Muster",
      customerAddress: "Kundenweg 1, 40210 Duesseldorf",
      customerEmail: "kunde@example.com",
      serviceDescription: "Wand spachteln",
      lineItems,
      settings: createSettings(),
      invoiceDate: "2026-01-01",
      serviceDate: "01.01.2026",
      paymentDueDays: 14,
      checkedAt: new Date("2026-01-01T10:00:00.000Z"),
    });

    expect(report.status).toBe("ready");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "document_basis_ready",
          severity: "info",
        }),
      ]),
    );
  });
});
