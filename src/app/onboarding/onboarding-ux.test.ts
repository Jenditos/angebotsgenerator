import { readFileSync } from "node:fs";
import path from "node:path";

describe("onboarding UX contract", () => {
  it("uses a clear exit label instead of postponement language", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/onboarding/OnboardingPageClient.tsx"),
      "utf8",
    );

    expect(source).not.toContain("Später einrichten");
    expect(source).toContain("Zur App");
  });

  it("renders the exit action as a visible secondary button", () => {
    const styles = readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(styles).toContain(
      ".onboardingSetupFooterActions .onboardingSetupSecondary",
    );
    expect(styles).toContain("border: 1px solid #cbd5e1 !important;");
    expect(styles).toContain("min-height: 52px !important;");
  });
});
