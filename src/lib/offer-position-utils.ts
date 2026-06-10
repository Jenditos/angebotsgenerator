import { OfferPosition, OfferTotals } from "@/types/offer-position";

export type DocumentMoneyTotals = {
  subtotalAmount: number;
  discountAmount: number;
  taxableAmount: number;
  vatAmount: number;
  totalAmount: number;
};

export function roundMoney(value: number): number {
  const scaledValue = value * 100;
  const floatingPointCorrection =
    Math.sign(value) * Number.EPSILON * Math.abs(scaledValue);

  return Math.round(scaledValue + floatingPointCorrection) / 100;
}

export function sumMoney(values: number[]): number {
  const totalCents = values.reduce(
    (sum, value) => sum + Math.round(roundMoney(value) * 100),
    0,
  );

  return totalCents / 100;
}

export function calculatePositionTotal(quantity: number, unitPrice: number): number {
  return roundMoney(Math.max(0, quantity) * Math.max(0, unitPrice));
}

export function calculateDocumentMoneyTotals(
  lineItemTotals: number[],
  vatRate: number,
  discount = 0,
): DocumentMoneyTotals {
  const subtotalAmount = sumMoney(lineItemTotals);
  const normalizedDiscount = Number.isFinite(discount)
    ? Math.max(0, discount)
    : 0;
  const discountAmount = Math.min(
    subtotalAmount,
    roundMoney(normalizedDiscount),
  );
  const taxableAmount = sumMoney([subtotalAmount, -discountAmount]);
  const normalizedVatRate = Number.isFinite(vatRate) ? Math.max(0, vatRate) : 0;
  const vatAmount = roundMoney(taxableAmount * (normalizedVatRate / 100));

  return {
    subtotalAmount,
    discountAmount,
    taxableAmount,
    vatAmount,
    totalAmount: sumMoney([taxableAmount, vatAmount]),
  };
}

export function normalizeOfferPosition(position: OfferPosition): OfferPosition {
  const normalizedQuantity = Number.isFinite(position.quantity) ? Math.max(0, position.quantity) : 0;
  const normalizedUnitPrice = Number.isFinite(position.unitPrice) ? Math.max(0, position.unitPrice) : 0;

  return {
    ...position,
    quantity: normalizedQuantity,
    unitPrice: normalizedUnitPrice,
    totalPrice: calculatePositionTotal(normalizedQuantity, normalizedUnitPrice)
  };
}

export function calculateOfferTotals(positions: OfferPosition[], vatRate: number): OfferTotals {
  const normalizedPositions = positions.map(normalizeOfferPosition);
  const totals = calculateDocumentMoneyTotals(
    normalizedPositions.map((position) => position.totalPrice),
    vatRate,
  );

  return {
    netTotal: totals.taxableAmount,
    vatAmount: totals.vatAmount,
    grossTotal: totals.totalAmount
  };
}
