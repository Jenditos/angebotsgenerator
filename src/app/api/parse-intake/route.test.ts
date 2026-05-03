import { NextResponse } from "next/server";
import { POST } from "@/app/api/parse-intake/route";
import { requireAppAccess } from "@/lib/access/guards";
import { parseOfferIntake, parseOfferIntakeFromImage } from "@/lib/openai";

jest.mock("@/lib/access/guards", () => ({
  requireAppAccess: jest.fn(),
}));

jest.mock("@/lib/openai", () => ({
  parseOfferIntake: jest.fn(),
  parseOfferIntakeFromImage: jest.fn(),
}));

const requireAppAccessMock = jest.mocked(requireAppAccess);
const parseOfferIntakeMock = jest.mocked(parseOfferIntake);
const parseOfferIntakeFromImageMock = jest.mocked(parseOfferIntakeFromImage);

describe("POST /api/parse-intake", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes through auth guard failures", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Nicht eingeloggt." }, { status: 401 }),
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({ transcript: "Hallo Welt, das ist ein Test." }),
      }),
    );

    expect(response.status).toBe(401);
    expect(parseOfferIntakeMock).not.toHaveBeenCalled();
  });

  it("rejects too short transcript before model call", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({ transcript: "kurz" }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Bitte sprich etwas länger");
    expect(parseOfferIntakeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid photo payload before model call", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "photo",
          photoDataUrl: "not-a-data-url",
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Ungültiges Fotoformat");
    expect(parseOfferIntakeFromImageMock).not.toHaveBeenCalled();
  });

  it("routes photo payload to image parser", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeFromImageMock.mockResolvedValue({
      fields: { companyName: "Malerbetrieb Blau", customerType: "company" },
      usedFallback: false,
      sourceText: "Malerbetrieb Blau",
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "photo",
          photoDataUrl: "data:image/jpeg;base64,QUJDRA==",
        }),
      }),
    );
    const payload = (await response.json()) as {
      fields?: { companyName?: string };
      inputMode?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.inputMode).toBe("photo");
    expect(payload.fields?.companyName).toBe("Malerbetrieb Blau");
    expect(parseOfferIntakeFromImageMock).toHaveBeenCalledTimes(1);
    expect(parseOfferIntakeMock).not.toHaveBeenCalled();
  });

  it("routes multiple photos to the image parser as a combined request", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeFromImageMock.mockResolvedValue({
      fields: {
        companyName: "Malerbetrieb Blau",
        street: "Hauptstraße 5",
        customerType: "company",
      },
      usedFallback: false,
      sourceText: "Malerbetrieb Blau Hauptstraße 5",
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "photo",
          photoDataUrls: [
            "data:image/jpeg;base64,QUJDRA==",
            "data:image/jpeg;base64,RUZHSA==",
          ],
        }),
      }),
    );
    const payload = (await response.json()) as {
      fields?: { companyName?: string; street?: string };
      inputMode?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.inputMode).toBe("photo");
    expect(payload.fields?.companyName).toBe("Malerbetrieb Blau");
    expect(payload.fields?.street).toBe("Hauptstraße 5");
    expect(parseOfferIntakeFromImageMock).toHaveBeenCalledWith([
      "data:image/jpeg;base64,QUJDRA==",
      "data:image/jpeg;base64,RUZHSA==",
    ]);
  });

  it("detects reverse-charge tax hints from OCR source text", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeFromImageMock.mockResolvedValue({
      fields: {
        customerType: "company",
        companyName: "Baucut Beton Bohren Schneiden",
        street: "Bütze Str.39",
        postalCode: "6922",
        city: "Wolfurt",
        positions: [
          {
            description: "Kernbohrungen",
            quantity: 13,
            unit: "Stück",
            unitPrice: 35,
          },
        ],
      },
      usedFallback: false,
      sourceText:
        "Bei den vorgenannten Leistungen handelt es sich um sonstige Leistungen EG nach § 13b UStG. Der Leistungsempfänger schuldet die Umsatzsteuer (Reverse-Charge)",
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "photo",
          photoDataUrl: "data:image/jpeg;base64,QUJDRA==",
        }),
      }),
    );
    const payload = (await response.json()) as {
      tax?: { treatment?: string; noticeText?: string };
    };

    expect(response.status).toBe(200);
    expect(payload.tax).toEqual(
      expect.objectContaining({
        treatment: "reverse_charge",
      }),
    );
    expect(payload.tax?.noticeText).toContain("§ 13b UStG");
  });

  it("rejects more than 10 uploaded photos before model call", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "photo",
          photoDataUrls: Array.from({ length: 11 }, () => "data:image/jpeg;base64,QUJDRA=="),
        }),
      }),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("maximal 10 Fotos");
    expect(parseOfferIntakeFromImageMock).not.toHaveBeenCalled();
  });

  it("drops redundant autofilled descriptions and bogus EUR positions", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeFromImageMock.mockResolvedValue({
      fields: {
        customerType: "person",
        serviceDescription: "Außenputz Arbeiten",
        positions: [
          {
            description: "Außenputz",
            quantity: 100,
            unit: "m²",
            unitPrice: 20,
          },
          {
            description: "EUR",
            quantity: 80,
            unit: "Std",
            unitPrice: 45,
          },
        ],
      },
      usedFallback: false,
      sourceText: "Außenputz Arbeiten 100 Quadratmeter 20 Euro 80 Stunden 45 Euro",
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "photo",
          photoDataUrl: "data:image/jpeg;base64,QUJDRA==",
        }),
      }),
    );
    const payload = (await response.json()) as {
      fields?: {
        serviceDescription?: string;
        positions?: Array<{ description?: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.fields?.serviceDescription).toBeUndefined();
    expect(payload.fields?.positions).toEqual([
      expect.objectContaining({ description: "Außenputz" }),
    ]);
  });

  it("returns noRelevantData when only control language is detected", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeMock.mockResolvedValue({
      fields: {
        serviceDescription: "mach mir mal bitte",
        positions: [{ description: "trag mal ein" }],
      },
      usedFallback: false,
      document: { type: "offer" },
      ignoredText: ["mach mir mal bitte"],
      needsReview: true,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "voice",
          transcript: "Mach mir mal bitte ein Angebot.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      noRelevantData?: boolean;
      message?: string;
      ignoredText?: string[];
    };

    expect(response.status).toBe(200);
    expect(payload.noRelevantData).toBe(true);
    expect(payload.message).toContain("keine eindeutigen Kundendaten");
    expect(payload.ignoredText).toContain("mach mir mal bitte");
  });

  it("keeps service positions even when quantity is missing and filters command prefix", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeMock.mockResolvedValue({
      fields: {
        firstName: "Max",
        lastName: "Müller",
        positions: [
          {
            description: "Mach mir mal bitte Wasserhahn austauschen",
          },
        ],
      },
      usedFallback: false,
      document: { type: "offer" },
      ignoredText: [],
      needsReview: true,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "voice",
          transcript:
            "Mach mir mal bitte ein Angebot für Max Müller, Wasserhahn austauschen.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      noRelevantData?: boolean;
      fields?: { positions?: Array<{ description?: string; quantity?: number }> };
    };

    expect(response.status).toBe(200);
    expect(payload.noRelevantData).toBe(false);
    expect(payload.fields?.positions?.[0]?.description).toBe(
      "Wasserhahn austauschen",
    );
    expect(payload.fields?.positions?.[0]?.quantity).toBeUndefined();
  });

  it("uses serviceDescription instead of creating an artificial position when no real item is found", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeMock.mockResolvedValue({
      fields: {
        serviceDescription: "Fliesenarbeiten",
      },
      usedFallback: false,
      document: { type: "offer" },
      ignoredText: [],
      needsReview: true,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "voice",
          transcript: "Bitte Fliesenarbeiten eintragen.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      fields?: { serviceDescription?: string; positions?: Array<unknown> };
      shouldAutofillServiceDescription?: boolean;
      noRelevantData?: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.noRelevantData).toBe(false);
    expect(payload.fields?.serviceDescription).toBe("Fliesenarbeiten");
    expect(payload.fields?.positions).toBeUndefined();
    expect(payload.shouldAutofillServiceDescription).toBe(true);
  });

  it("filters form-meta entries and deduplicates structured item descriptions", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeMock.mockResolvedValue({
      fields: {
        positions: [
          {
            description: "Fliesenarbeiten",
            quantity: 100,
            unit: "Stück",
            unitPrice: 18,
          },
          {
            description: "Leistungszeitraum eine Woche Zahlungsziel",
            quantity: 14,
            unit: "Tag",
          },
          {
            description: "Fliesenarbeiten 100 Stück Einzelpreis 18",
          },
        ],
      },
      usedFallback: false,
      document: { type: "offer" },
      ignoredText: [],
      needsReview: true,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "voice",
          transcript:
            "Fliesenarbeiten 100 Stück Einzelpreis 18, Leistungszeitraum eine Woche, Zahlungsziel 14 Tage.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      fields?: {
        positions?: Array<{
          description?: string;
          quantity?: number;
          unit?: string;
          unitPrice?: number;
        }>;
      };
      noRelevantData?: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.noRelevantData).toBe(false);
    expect(payload.fields?.positions).toEqual([
      expect.objectContaining({
        description: "Fliesenarbeiten",
        quantity: 100,
        unit: "Stück",
        unitPrice: 18,
      }),
    ]);
  });

  it("moves labor-only positions into time calculation and removes them from items", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeMock.mockResolvedValue({
      fields: {
        positions: [
          {
            description: "Arbeitszeit",
            quantity: 2,
            unit: "Std",
          },
          {
            description: "Wasserhahn austauschen",
          },
        ],
      },
      usedFallback: false,
      document: { type: "offer" },
      ignoredText: [],
      needsReview: true,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "voice",
          transcript:
            "Mach mir ein Angebot: Wasserhahn austauschen, 2 Stunden Arbeitszeit.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      fields?: { hours?: number; positions?: Array<{ description?: string }> };
      ignoredText?: string[];
      timeCalculation?: { laborHours?: number };
      noRelevantData?: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.noRelevantData).toBe(false);
    expect(payload.fields?.hours).toBe(2);
    expect(payload.timeCalculation?.laborHours).toBe(2);
    expect(payload.fields?.positions).toEqual([
      expect.objectContaining({ description: "Wasserhahn austauschen" }),
    ]);
    expect(payload.ignoredText).toContain("Arbeitszeit");
  });

  it("detects spoken labor hours from transcript text even without explicit item", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    parseOfferIntakeMock.mockResolvedValue({
      fields: {},
      usedFallback: false,
      document: { type: "offer" },
      ignoredText: [],
      needsReview: true,
    });

    const response = await POST(
      new Request("https://example.com/api/parse-intake", {
        method: "POST",
        body: JSON.stringify({
          inputMode: "voice",
          transcript: "Bitte eintragen: drei Stunden Arbeitszeit.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      fields?: { hours?: number };
      timeCalculation?: { laborHours?: number };
      noRelevantData?: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.noRelevantData).toBe(false);
    expect(payload.fields?.hours).toBe(3);
    expect(payload.timeCalculation?.laborHours).toBe(3);
  });
});
