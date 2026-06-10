const mockUpsert = jest.fn();
const mockMaybeSingle = jest.fn();
const mockDeleteEq = jest.fn();

jest.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      upsert: mockUpsert,
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
      delete: () => ({
        eq: mockDeleteEq,
      }),
    }),
  }),
}));

jest.mock("@/lib/supabase/config", () => ({
  isSupabaseAdminConfigured: () => true,
}));

import {
  clearEmailConnection,
  readEmailConnection,
  writeEmailConnection,
} from "@/lib/email-store";

const originalProvider = process.env.EMAIL_CONNECTION_STORAGE_PROVIDER;
const originalSecret = process.env.EMAIL_OAUTH_SECRET;

describe("email-store Supabase encryption", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EMAIL_CONNECTION_STORAGE_PROVIDER = "supabase";
    process.env.EMAIL_OAUTH_SECRET = "a-test-secret-that-is-long-enough";
    mockUpsert.mockResolvedValue({ error: null });
    mockDeleteEq.mockResolvedValue({ error: null });
  });

  afterAll(() => {
    process.env.EMAIL_CONNECTION_STORAGE_PROVIDER = originalProvider;
    process.env.EMAIL_OAUTH_SECRET = originalSecret;
  });

  it("stores OAuth credentials encrypted and decrypts them again", async () => {
    const connection = {
      provider: "google" as const,
      accountEmail: "office@example.com",
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      expiresAt: Date.parse("2026-06-10T15:00:00.000Z"),
    };

    await writeEmailConnection(
      "00000000-0000-4000-8000-000000000001",
      connection,
    );

    const stored = mockUpsert.mock.calls[0][0].encrypted_payload as string;
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain(connection.accessToken);
    expect(stored).not.toContain(connection.refreshToken);

    mockMaybeSingle.mockResolvedValue({
      data: { encrypted_payload: stored },
      error: null,
    });

    await expect(
      readEmailConnection("00000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual(connection);
  });

  it("removes only the requesting user's connection", async () => {
    await clearEmailConnection("00000000-0000-4000-8000-000000000001");
    expect(mockDeleteEq).toHaveBeenCalledWith(
      "user_id",
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects an unknown provider instead of silently using local files", async () => {
    process.env.EMAIL_CONNECTION_STORAGE_PROVIDER = "supabse";

    await expect(
      readEmailConnection("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("Unbekannter E-Mail-Verbindungsspeicher");
  });
});
