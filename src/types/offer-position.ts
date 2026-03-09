export type OfferUnit = "Std." | "m²" | "Stk." | "lfm" | "Pauschal";

export type OfferPosition = {
  id: string;
  serviceType: string;
  description: string;
  quantity: number;
  unit: OfferUnit;
  unitPrice: number;
  totalPrice: number;
};

export type OfferTotals = {
  netTotal: number;
  vatAmount: number;
  grossTotal: number;
};

export type OfferPositionsChangePayload = {
  positions: OfferPosition[];
  totals: OfferTotals;
};

// Basiskategorien für Bau / Handwerk. Eigene Werte der Firma werden zusätzlich geladen.
export const DEFAULT_SERVICE_TYPES: string[] = [
  "Wartung",
  "Inspektion",
  "Reparatur",
  "Renovieren",
  "Sanieren",
  "Modernisieren",
  "Restaurieren",
  "Umbau",
  "Anbau",
  "Ausbau",
  "Rohbau",
  "Innenausbau",
  "Malerarbeiten",
  "Trockenbau",
  "Fliesenarbeiten",
  "Bodenbeläge",
  "Elektroinstallation",
  "Sanitär/Heizung/Lüftung",
  "Dacharbeiten",
  "Fenster/Türen",
  "Garten- und Landschaftsbau"
];
