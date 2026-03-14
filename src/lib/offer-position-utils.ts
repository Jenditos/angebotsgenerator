import { OfferPosition, OfferTotals } from "@/types/offer-position";

function toMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculatePositionTotal(quantity: number, unitPrice: number): number {
  return toMoney(Math.max(0, quantity) * Math.max(0, unitPrice));
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
  const netTotal = toMoney(normalizedPositions.reduce((sum, position) => sum + position.totalPrice, 0));
  const vatAmount = toMoney(netTotal * (vatRate / 100));

  return {
    netTotal,
    vatAmount,
    grossTotal: toMoney(netTotal + vatAmount)
  };
}
