import { readFileSync } from "node:fs";
import path from "node:path";

describe("onboarding UX contract", () => {
  it("uses clear navigation labels throughout the onboarding", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/onboarding/OnboardingPageClient.tsx"),
      "utf8",
    );
    const tradeSelectSource = readFileSync(
      path.join(process.cwd(), "src/components/TradeMultiSelect.tsx"),
      "utf8",
    );

    expect(source).not.toContain("Später einrichten");
    expect(source).not.toContain("onboardingSetupSkip");
    expect(source).not.toContain("onBlurCapture");
    expect(source).toContain("Speichern und zur App");
    expect(source).toContain("const success = await queuePersist");
    expect(source).toContain("Zurück");
    expect(tradeSelectSource).not.toContain("Sonstiges Gewerk");
    expect(tradeSelectSource).toContain("Weitere Gewerke anzeigen");
  });

  it("leaves onboarding immediately even when draft persistence fails", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/onboarding/OnboardingPageClient.tsx"),
      "utf8",
    );
    const postponeBody =
      source.match(
        /function postponeOnboarding\(\) \{(?<body>[\s\S]*?)\n  \}\n\n  const stepTitle/,
      )?.groups?.body ?? "";

    expect(postponeBody).toContain("const persistence = queuePersist(");
    expect(postponeBody).toContain("{ keepalive: true }");
    expect(postponeBody).toContain("setOnboardingSnoozeCookie();");
    expect(postponeBody).toContain('router.replace("/");');
    expect(postponeBody).toContain("void persistence;");
    expect(postponeBody).not.toContain("await queuePersist");
    expect(postponeBody).not.toContain("if (!success)");
  });

  it("renders all navigation actions as consistent full-size buttons", () => {
    const styles = readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(styles).toContain(
      ".onboardingSetupSecondary,\nhtml body .onboardingSetupBack",
    );
    expect(styles).toContain("border: 1px solid #cbd5e1 !important;");
    expect(styles).toContain("min-height: 52px !important;");
    expect(styles).toContain("min-width: 112px !important;");
    expect(styles).toContain("min-width: 184px !important;");
  });
});
