import {
  ONBOARDING_SNOOZE_COOKIE_NAME,
  hasOnboardingSnoozeCookie,
} from "@/lib/onboarding";

describe("onboarding snooze cookie", () => {
  it("detects a deliberate onboarding postponement", () => {
    expect(
      hasOnboardingSnoozeCookie(
        `theme=light; ${ONBOARDING_SNOOZE_COOKIE_NAME}=1; locale=de`,
      ),
    ).toBe(true);
  });

  it("ignores missing or inactive snooze cookies", () => {
    expect(hasOnboardingSnoozeCookie("theme=light")).toBe(false);
    expect(
      hasOnboardingSnoozeCookie(`${ONBOARDING_SNOOZE_COOKIE_NAME}=0`),
    ).toBe(false);
  });
});
