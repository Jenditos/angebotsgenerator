import { readFileSync } from "fs";
import { join } from "path";

describe("onboarding startup", () => {
  it("does not show a blocking onboarding loading message in the app", () => {
    const homePage = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    const onboardingPage = readFileSync(
      join(process.cwd(), "src/app/onboarding/OnboardingPageClient.tsx"),
      "utf8",
    );

    expect(`${homePage}\n${onboardingPage}`).not.toContain(
      "Onboarding wird geladen",
    );
  });
});
