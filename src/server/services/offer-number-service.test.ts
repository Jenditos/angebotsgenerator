import { OfferNumberService } from "./offer-number-service";

describe("OfferNumberService", () => {
  describe("generateNextOfferNumber", () => {
    it("increments numeric suffix and keeps prefix", () => {
      const result = OfferNumberService.generateNextOfferNumber("ANG-2026-991490", 0);

      expect(result).toEqual({
        nextOfferNumber: "ANG-2026-991491",
        nextFallbackCounter: 0
      });
    });

    it("keeps leading zeros in suffix", () => {
      const result = OfferNumberService.generateNextOfferNumber("ANG-000099", 0);

      expect(result.nextOfferNumber).toBe("ANG-000100");
    });

    it("uses fallback counter when no trailing number exists", () => {
      const result = OfferNumberService.generateNextOfferNumber("ANG-2026-AB", 7);

      expect(result).toEqual({
        nextOfferNumber: "8",
        nextFallbackCounter: 8
      });
    });

    it("uses fallback counter for empty source", () => {
      const result = OfferNumberService.generateNextOfferNumber("", 3);

      expect(result).toEqual({
        nextOfferNumber: "4",
        nextFallbackCounter: 4
      });
    });

    it("normalizes invalid fallback counter values", () => {
      const result = OfferNumberService.generateNextOfferNumber(" ", Number.NaN);

      expect(result).toEqual({
        nextOfferNumber: "1",
        nextFallbackCounter: 1
      });
    });
  });

  describe("resolveOfferNumberForCreate", () => {
    it("prioritizes manually entered offer numbers", () => {
      const result = OfferNumberService.resolveOfferNumberForCreate({
        manualOfferNumber: "CUSTOM-44",
        startOfferNumber: "ANG-2026-999",
        fallbackCounter: 9
      });

      expect(result).toEqual({
        nextOfferNumber: "CUSTOM-44",
        nextFallbackCounter: 9
      });
    });

    it("uses last offer number before start offer number", () => {
      const fromLast = OfferNumberService.resolveOfferNumberForCreate({
        lastOfferNumber: "ANG-2026-010",
        startOfferNumber: "ANG-2026-001"
      });

      expect(fromLast.nextOfferNumber).toBe("ANG-2026-011");

      const fromStart = OfferNumberService.resolveOfferNumberForCreate({
        lastOfferNumber: "",
        startOfferNumber: "ANG-2026-001"
      });

      expect(fromStart.nextOfferNumber).toBe("ANG-2026-002");
    });

    it("falls back to numeric counter when start and last are malformed", () => {
      const result = OfferNumberService.resolveOfferNumberForCreate({
        lastOfferNumber: "ABC",
        startOfferNumber: "",
        fallbackCounter: 12
      });

      expect(result).toEqual({
        nextOfferNumber: "13",
        nextFallbackCounter: 13
      });
    });
  });
});
