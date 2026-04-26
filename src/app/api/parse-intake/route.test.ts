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
});
