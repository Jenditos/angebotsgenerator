export type OfferNumberGenerationResult = {
  nextOfferNumber: string;
  nextFallbackCounter: number;
};

const SUFFIX_PATTERN = /^(.*?)(\d+)$/;

export class OfferNumberService {
  /**
   * Angebotsnummern-Generierung:
   * - Erkennt Präfix + numerischen Suffix am Ende (z. B. ANG-2026-991490)
   * - Erhöht nur den Suffix um +1 und behält Präfix + führende Nullen
   * - Fallback auf einfachen Zähler, falls Muster nicht passt
   */
  static generateNextOfferNumber(lastOfferNumber: string | null | undefined, fallbackCounter = 0): OfferNumberGenerationResult {
    const normalized = lastOfferNumber?.trim() ?? "";

    if (!normalized) {
      const nextCounter = fallbackCounter + 1;
      return {
        nextOfferNumber: String(nextCounter),
        nextFallbackCounter: nextCounter
      };
    }

    const suffixMatch = normalized.match(SUFFIX_PATTERN);
    if (!suffixMatch) {
      const nextCounter = fallbackCounter + 1;
      return {
        nextOfferNumber: `${normalized}-${nextCounter}`,
        nextFallbackCounter: nextCounter
      };
    }

    const [, prefix, suffix] = suffixMatch;
    const incremented = String(Number.parseInt(suffix, 10) + 1).padStart(suffix.length, "0");

    return {
      nextOfferNumber: `${prefix}${incremented}`,
      nextFallbackCounter: fallbackCounter
    };
  }

  static resolveOfferNumberForCreate(input: {
    manualOfferNumber?: string | null;
    lastOfferNumber?: string | null;
    startOfferNumber?: string | null;
    fallbackCounter?: number;
  }): OfferNumberGenerationResult {
    const manual = input.manualOfferNumber?.trim() ?? "";
    if (manual) {
      return {
        nextOfferNumber: manual,
        nextFallbackCounter: input.fallbackCounter ?? 0
      };
    }

    const base = input.lastOfferNumber?.trim() || input.startOfferNumber?.trim() || "";
    return this.generateNextOfferNumber(base, input.fallbackCounter ?? 0);
  }
}
