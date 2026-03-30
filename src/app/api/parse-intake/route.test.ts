import { NextResponse } from "next/server";
import { POST } from "@/app/api/parse-intake/route";
import { requireAppAccess } from "@/lib/access/guards";
import { parseOfferIntake } from "@/lib/openai";

jest.mock("@/lib/access/guards", () => ({
  requireAppAccess: jest.fn(),
}));

jest.mock("@/lib/openai", () => ({
  parseOfferIntake: jest.fn(),
}));

const requireAppAccessMock = jest.mocked(requireAppAccess);
const parseOfferIntakeMock = jest.mocked(parseOfferIntake);

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
});

