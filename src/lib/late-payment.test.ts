import {
  addDaysToDateValue,
  buildInvoiceMetadata,
  calculateLatePaymentInterest,
} from "./late-payment";

const baseSettings = {
  latePaymentInterestEnabled: true,
  latePaymentConsumerAnnualInterestPercent: 6,
  latePaymentBusinessAnnualInterestPercent: 12,
  latePaymentGraceDays: 0,
};

describe("late-payment", () => {
  it("adds payment terms to date-only invoice dates", () => {
    expect(addDaysToDateValue("2026-05-07", 14)).toBe("2026-05-21");
  });

  it("builds invoice metadata with gross total and due date", () => {
    const invoice = buildInvoiceMetadata({
      invoiceDate: "2026-05-07",
      paymentDueDays: 14,
      lineItemsSubtotal: 100,
      vatRate: 19,
    });

    expect(invoice).toMatchObject({
      invoiceDate: "2026-05-07",
      dueDate: "2026-05-21",
      subtotalAmount: 100,
      vatAmount: 19,
      totalAmount: 119,
      currency: "EUR",
    });
  });

  it("calculates daily late payment interest only after the due date", () => {
    const invoice = buildInvoiceMetadata({
      invoiceDate: "2026-05-01",
      paymentDueDays: 5,
      lineItemsSubtotal: 1000,
      vatRate: 0,
    });

    const result = calculateLatePaymentInterest({
      settings: baseSettings,
      invoice,
      customerType: "company",
      paymentStatus: "unpaid",
      asOf: new Date("2026-05-16T12:00:00.000Z"),
    });

    expect(result?.isOverdue).toBe(true);
    expect(result?.daysOverdue).toBe(10);
    expect(result?.annualInterestPercent).toBe(12);
    expect(result?.interestAmount).toBe(3.29);
  });

  it("does not calculate interest for paid invoices", () => {
    const invoice = buildInvoiceMetadata({
      invoiceDate: "2026-05-01",
      paymentDueDays: 5,
      lineItemsSubtotal: 1000,
      vatRate: 0,
    });

    const result = calculateLatePaymentInterest({
      settings: baseSettings,
      invoice,
      customerType: "company",
      paymentStatus: "paid",
      asOf: new Date("2026-05-16T12:00:00.000Z"),
    });

    expect(result?.isOverdue).toBe(false);
    expect(result?.interestAmount).toBe(0);
  });

  it("respects grace days", () => {
    const invoice = buildInvoiceMetadata({
      invoiceDate: "2026-05-01",
      paymentDueDays: 5,
      lineItemsSubtotal: 1000,
      vatRate: 0,
    });

    const result = calculateLatePaymentInterest({
      settings: {
        ...baseSettings,
        latePaymentGraceDays: 10,
      },
      invoice,
      customerType: "person",
      paymentStatus: "unpaid",
      asOf: new Date("2026-05-16T12:00:00.000Z"),
    });

    expect(result?.isOverdue).toBe(false);
    expect(result?.daysOverdue).toBe(0);
    expect(result?.interestAmount).toBe(0);
  });
});
