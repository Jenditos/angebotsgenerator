import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { isAuthBypassEnabled } from "@/lib/access/auth-bypass";
import {
  canUseApp,
  readEffectiveUserAccessRecord,
} from "@/lib/access/user-access";
import {
  getSupabasePublicConfig,
  isSupabaseConfigured,
} from "@/lib/supabase/config";

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn(),
}));

jest.mock("@/lib/access/auth-bypass", () => ({
  isAuthBypassEnabled: jest.fn(),
}));

jest.mock("@/lib/access/access-errors", () => ({
  logUserAccessError: jest.fn(),
}));

jest.mock("@/lib/access/user-access", () => ({
  canUseApp: jest.fn(),
  readEffectiveUserAccessRecord: jest.fn(),
}));

jest.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: jest.fn(),
  isSupabaseConfigured: jest.fn(),
}));

const createServerClientMock = jest.mocked(createServerClient);
const isAuthBypassEnabledMock = jest.mocked(isAuthBypassEnabled);
const canUseAppMock = jest.mocked(canUseApp);
const readEffectiveUserAccessRecordMock = jest.mocked(
  readEffectiveUserAccessRecord,
);
const getSupabasePublicConfigMock = jest.mocked(getSupabasePublicConfig);
const isSupabaseConfiguredMock = jest.mocked(isSupabaseConfigured);

function buildSupabaseClient(
  onboardingResult: { data: unknown; error: unknown } = {
    data: null,
    error: null,
  },
) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "user@example.com" } },
        error: null,
      }),
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue(onboardingResult),
        })),
      })),
    })),
  };
}

describe("middleware access control", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    isAuthBypassEnabledMock.mockReturnValue(false);
    isSupabaseConfiguredMock.mockReturnValue(true);
    getSupabasePublicConfigMock.mockReturnValue({
      url: "https://example.supabase.co",
      anonKey: "anon-key",
    });
    canUseAppMock.mockReturnValue(true);
    readEffectiveUserAccessRecordMock.mockResolvedValue({} as never);
    createServerClientMock.mockReturnValue(buildSupabaseClient() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("blocks protected routes when Supabase is not configured", async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);

    const response = await middleware(new NextRequest("https://example.com/"));

    expect(response.headers.get("location")).toBe("https://example.com/auth");
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("fails closed when reading user access throws", async () => {
    readEffectiveUserAccessRecordMock.mockRejectedValue({
      code: "42P01",
      message: 'relation "public.user_access" does not exist',
    });

    const response = await middleware(new NextRequest("https://example.com/"));

    expect(response.headers.get("location")).toBe("https://example.com/upgrade");
  });

  it("fails closed when no access record exists", async () => {
    readEffectiveUserAccessRecordMock.mockResolvedValue(null);

    const response = await middleware(new NextRequest("https://example.com/"));

    expect(response.headers.get("location")).toBe("https://example.com/upgrade");
  });

  it("sends users to onboarding when onboarding status cannot be read", async () => {
    createServerClientMock.mockReturnValue(
      buildSupabaseClient({
        data: null,
        error: { code: "42P01", message: "user_settings missing" },
      }) as never,
    );

    const response = await middleware(new NextRequest("https://example.com/"));

    expect(response.headers.get("location")).toBe(
      "https://example.com/onboarding",
    );
  });
});
