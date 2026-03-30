import { POST } from "@/app/api/billing/create-checkout-session/route";
import { requireAuthenticatedUser } from "@/lib/access/guards";

jest.mock("@/lib/access/guards", () => ({
  requireAuthenticatedUser: jest.fn(),
}));

jest.mock("@/lib/stripe/config", () => ({
  MONTHLY_PRICE_CENTS: 4990,
  STRIPE_MONTHLY_PRICE_ID: "",
  STRIPE_SECRET_KEY: "",
  resolveAppBaseUrl: () => "https://example.com",
}));

const requireAuthenticatedUserMock = jest.mocked(requireAuthenticatedUser);

describe("POST /api/billing/create-checkout-session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 500 when Stripe secret key is missing", async () => {
    const response = await POST(new Request("https://example.com/api/billing/create-checkout-session"));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Stripe ist noch nicht konfiguriert.");
    expect(requireAuthenticatedUserMock).not.toHaveBeenCalled();
  });
});

