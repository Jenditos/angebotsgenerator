export type OfferNumberGenerationResult = {
  nextOfferNumber: string;
  nextFallbackCounter: number;
};

export type ResolveOfferNumberInput = {
  manualOfferNumber?: string | null;
  lastOfferNumber?: string | null;
  startOfferNumber?: string | null;
  fallbackCounter?: number;
};

const TRAILING_NUMBER_PATTERN = /^(.*?)(\d+)$/;

function normalizeCounter(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value ?? 0));
}

export class OfferNumberService {
  /**
   * Angebotsnummern-Generierung:
   * 1) Präfix + numerischen End-Suffix erkennen und nur den Suffix erhöhen.
   * 2) Falls kein End-Suffix vorhanden ist, auf einen numerischen Fallback-Zähler wechseln.
   */
  static generateNextOfferNumber(lastOfferNumber: string | null | undefined, fallbackCounter = 0): OfferNumberGenerationResult {
    const normalized = (lastOfferNumber ?? "").trim();
    const safeFallbackCounter = normalizeCounter(fallbackCounter);

    if (!normalized) {
      const nextCounter = safeFallbackCounter + 1;
      return {
        nextOfferNumber: String(nextCounter),
        nextFallbackCounter: nextCounter
      };
    }

    const suffixMatch = normalized.match(TRAILING_NUMBER_PATTERN);
    if (!suffixMatch) {
      const nextCounter = safeFallbackCounter + 1;
      return {
        nextOfferNumber: String(nextCounter),
        nextFallbackCounter: nextCounter
      };
    }

    const [, prefix, suffix] = suffixMatch;
    const incrementedSuffix = (BigInt(suffix) + 1n).toString().padStart(suffix.length, "0");

    return {
      nextOfferNumber: `${prefix}${incrementedSuffix}`,
      nextFallbackCounter: safeFallbackCounter
    };
  }

  static resolveOfferNumberForCreate(input: ResolveOfferNumberInput): OfferNumberGenerationResult {
    const manualOfferNumber = (input.manualOfferNumber ?? "").trim();
    const safeFallbackCounter = normalizeCounter(input.fallbackCounter);

    if (manualOfferNumber) {
      return {
        nextOfferNumber: manualOfferNumber,
        nextFallbackCounter: safeFallbackCounter
      };
    }

    const baseOfferNumber = (input.lastOfferNumber ?? "").trim() || (input.startOfferNumber ?? "").trim();
    return this.generateNextOfferNumber(baseOfferNumber, safeFallbackCounter);
  }
}
