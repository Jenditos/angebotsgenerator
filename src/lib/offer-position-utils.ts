import { OfferPosition, OfferTotals } from "@/types/offer-position";

function toMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculatePositionTotal(quantity: number, unitPrice: number): number {
  return toMoney(quantity * unitPrice);
}

export function calculateOfferTotals(positions: OfferPosition[], vatRate: number): OfferTotals {
  const netTotal = toMoney(positions.reduce((sum, position) => sum + position.totalPrice, 0));
  const vatAmount = toMoney(netTotal * (vatRate / 100));

  return {
    netTotal,
    vatAmount,
    grossTotal: toMoney(netTotal + vatAmount)
  };
}
