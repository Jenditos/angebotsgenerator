import { NextResponse } from "next/server";
import { POST } from "@/app/api/email/disconnect/route";
import { requireAppAccess } from "@/lib/access/guards";
import { revokeEmailProviderTokens } from "@/lib/email-oauth";
import { clearEmailConnection, readEmailConnection } from "@/lib/email-store";

jest.mock("@/lib/access/guards", () => ({
  requireAppAccess: jest.fn(),
}));

jest.mock("@/lib/email-oauth", () => ({
  revokeEmailProviderTokens: jest.fn(),
}));

jest.mock("@/lib/email-store", () => ({
  clearEmailConnection: jest.fn(),
  readEmailConnection: jest.fn(),
}));

const requireAppAccessMock = jest.mocked(requireAppAccess);
const revokeEmailProviderTokensMock = jest.mocked(revokeEmailProviderTokens);
const clearEmailConnectionMock = jest.mocked(clearEmailConnection);
const readEmailConnectionMock = jest.mocked(readEmailConnection);

describe("POST /api/email/disconnect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes through auth guard failures", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Nicht eingeloggt." }, { status: 401 }),
    });

    const response = await POST();

    expect(response.status).toBe(401);
    expect(revokeEmailProviderTokensMock).not.toHaveBeenCalled();
    expect(clearEmailConnectionMock).not.toHaveBeenCalled();
  });

  it("returns revokeWarning but still clears local connection", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });

    readEmailConnectionMock.mockResolvedValue({
      provider: "google",
      email: "user@example.com",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    revokeEmailProviderTokensMock.mockRejectedValue(new Error("Revoke fehlgeschlagen"));

    const response = await POST();
    const body = (await response.json()) as {
      ok: boolean;
      providerRevoked: boolean;
      revokeWarning?: string;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.providerRevoked).toBe(false);
    expect(body.revokeWarning).toContain("Revoke fehlgeschlagen");
    expect(clearEmailConnectionMock).toHaveBeenCalledTimes(1);
  });
});

