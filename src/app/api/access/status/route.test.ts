import { GET } from "./route";
import { isAuthBypassEnabled } from "@/lib/access/auth-bypass";
import { requireAuthenticatedUser } from "@/lib/access/guards";
import {
  buildAccessState,
  ensureEffectiveUserAccessRecord,
} from "@/lib/access/user-access";
import { readOnboardingStatus, readSettings } from "@/lib/settings-store";

jest.mock("@/lib/access/auth-bypass", () => ({
  buildBypassAccessRecord: jest.fn(),
  buildBypassUser: jest.fn(),
  isAuthBypassEnabled: jest.fn(),
}));

jest.mock("@/lib/access/guards", () => ({
  requireAuthenticatedUser: jest.fn(),
}));

jest.mock("@/lib/access/access-errors", () => ({
  classifyUserAccessError: jest.fn(),
  logUserAccessError: jest.fn(),
}));

jest.mock("@/lib/access/user-access", () => ({
  buildAccessState: jest.fn(),
  ensureEffectiveUserAccessRecord: jest.fn(),
}));

jest.mock("@/lib/settings-store", () => ({
  readOnboardingStatus: jest.fn(),
  readSettings: jest.fn(),
  writeOnboardingStatus: jest.fn(),
}));

describe("GET /api/access/status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(isAuthBypassEnabled).mockReturnValue(false);
    jest.mocked(requireAuthenticatedUser).mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: {
        id: "tester-user",
        email: "tester@example.com",
      } as never,
    });
    jest.mocked(ensureEffectiveUserAccessRecord).mockResolvedValue({
      user_id: "tester-user",
    } as never);
    jest.mocked(buildAccessState).mockReturnValue({
      trialActive: false,
      hasSubscription: true,
      canUseApp: true,
    });
    jest.mocked(readOnboardingStatus).mockResolvedValue({
      onboardingCompleted: false,
      onboardingCompletedAt: null,
      onboardingStep: 1,
    });
    jest.mocked(readSettings).mockResolvedValue({
      customServiceTypes: [],
    } as never);
  });

  it("loads onboarding status for authenticated users with app access", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.onboarding.onboardingCompleted).toBe(false);
    expect(readOnboardingStatus).toHaveBeenCalledTimes(1);
    expect(readSettings).toHaveBeenCalledTimes(1);
  });
});
