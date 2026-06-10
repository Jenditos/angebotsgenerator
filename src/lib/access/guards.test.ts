import { requireAppAccess } from "@/lib/access/guards";
import { isAuthBypassEnabled } from "@/lib/access/auth-bypass";
import { ensureUserAccessRecord } from "@/lib/access/user-access";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

jest.mock("@/lib/access/auth-bypass", () => ({
  buildBypassAccessRecord: jest.fn(),
  buildBypassSupabaseClient: jest.fn(),
  buildBypassUser: jest.fn(),
  isAuthBypassEnabled: jest.fn(),
}));

jest.mock("@/lib/access/user-access", () => ({
  canUseApp: jest.fn(),
  ensureUserAccessRecord: jest.fn(),
}));

jest.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: jest.fn(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: jest.fn(),
}));

const isAuthBypassEnabledMock = jest.mocked(isAuthBypassEnabled);
const ensureUserAccessRecordMock = jest.mocked(ensureUserAccessRecord);
const isSupabaseConfiguredMock = jest.mocked(isSupabaseConfigured);
const createSupabaseServerClientMock = jest.mocked(createSupabaseServerClient);

describe("requireAppAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    isAuthBypassEnabledMock.mockReturnValue(false);
    isSupabaseConfiguredMock.mockReturnValue(true);
    createSupabaseServerClientMock.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "user@example.com" } },
          error: null,
        }),
      },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fails closed when the access table is not set up", async () => {
    ensureUserAccessRecordMock.mockRejectedValue({
      code: "42P01",
      message: 'relation "public.user_access" does not exist',
    });

    const result = await requireAppAccess();

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected access guard failure");
    }
    expect(result.response.status).toBe(503);
    expect(await result.response.json()).toEqual({
      error: "Testzugang ist aktuell nicht vollständig eingerichtet.",
    });
  });

  it("fails closed on unknown database errors", async () => {
    ensureUserAccessRecordMock.mockRejectedValue(new Error("database timeout"));

    const result = await requireAppAccess();

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected access guard failure");
    }
    expect(result.response.status).toBe(500);
  });
});
