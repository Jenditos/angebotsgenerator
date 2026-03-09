declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => { toEqual: (other: unknown) => void; toBe: (other: unknown) => void };

import { OfferNumberService } from "./offer-number-service";

describe("OfferNumberService", () => {
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

  it("falls back to suffix counter when no numeric suffix exists", () => {
    const result = OfferNumberService.generateNextOfferNumber("ANG-2026", 7);
    expect(result).toEqual({
      nextOfferNumber: "ANG-2027",
      nextFallbackCounter: 7
    });
  });

  it("uses simple counter when base is empty", () => {
    const result = OfferNumberService.generateNextOfferNumber("", 3);
    expect(result).toEqual({
      nextOfferNumber: "4",
      nextFallbackCounter: 4
    });
  });

  it("resolves manual number with priority", () => {
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

  it("uses last offer number, then start number", () => {
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
});
