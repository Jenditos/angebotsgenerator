import {
  calculateDocumentMoneyTotals,
  calculatePositionTotal,
} from "./offer-position-utils";

describe("offer-position-utils", () => {
  it("uses visible rounded position totals for document totals", () => {
    const positionTotal = calculatePositionTotal(3, 0.335);
    const totals = calculateDocumentMoneyTotals([positionTotal], 19);

    expect(positionTotal).toBe(1.01);
    expect(totals).toEqual({
      subtotalAmount: 1.01,
      discountAmount: 0,
      taxableAmount: 1.01,
      vatAmount: 0.19,
      totalAmount: 1.2,
    });
  });

  it("subtracts a cent-rounded discount before calculating VAT", () => {
    const totals = calculateDocumentMoneyTotals([10.01, 5.02], 19, 0.335);

    expect(totals).toEqual({
      subtotalAmount: 15.03,
      discountAmount: 0.34,
      taxableAmount: 14.69,
      vatAmount: 2.79,
      totalAmount: 17.48,
    });
  });
});
