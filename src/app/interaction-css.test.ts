import { readFileSync } from "fs";
import { join } from "path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const marker = "VISIORO INTERACTION CONTRACT v4";
const contractStart = css.lastIndexOf(marker);
const contractCss = contractStart >= 0 ? css.slice(contractStart) : "";

function findRuleBody(selectorFragment: string): string {
  const escapedFragment = selectorFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contractCss.match(
    new RegExp(`${escapedFragment}[^{]*\\{(?<body>[^}]*)\\}`, "m"),
  );
  return match?.groups?.body ?? "";
}

function findLastRuleBody(selectorFragment: string): string {
  const escapedFragment = selectorFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(
    contractCss.matchAll(new RegExp(`${escapedFragment}[^{]*\\{(?<body>[^}]*)\\}`, "gm")),
  );

  return matches.at(-1)?.groups?.body ?? "";
}

describe("VISIORO interaction CSS contract", () => {
  it("keeps one final interaction layer for hover and focus states", () => {
    expect(contractStart).toBeGreaterThan(-1);
    expect(contractCss).toContain("--vis-control-primary-hover: #1165e0");
    expect(contractCss).toContain("--vis-control-secondary-hover: #eaf2ff");
  });

  it("keeps primary hover states dark with readable white text", () => {
    const primaryHoverBody = findRuleBody("button.primaryButton:hover:not(:disabled)");

    expect(primaryHoverBody).toContain("var(--vis-control-primary-hover)");
    expect(primaryHoverBody).toContain("color: #ffffff");
    expect(primaryHoverBody).not.toMatch(/background(?:-color)?\s*:\s*(?:#fff\b|#ffffff\b|white\b)/i);
  });

  it("uses soft colored hover states instead of clipped hover shadows", () => {
    expect(contractCss).toContain("button.ghostButton:hover:not(:disabled)");
    expect(contractCss).toContain("box-shadow: none !important");
    expect(contractCss).toContain(".subscriptionBillingToggle button.active:hover:not(:disabled)");
    expect(contractCss).toContain(".appSidebar .sidebarQuickNavButton:hover:not(:disabled)");
  });

  it("does not overwrite readable colors of selected or expanded controls", () => {
    const genericHoverRule = contractCss.match(
      /button\[class\][^{]*:hover\s*\{(?<body>[^}]*)\}/m,
    );
    const selector = genericHoverRule?.[0] ?? "";

    expect(selector).toContain(":not(.active)");
    expect(selector).toContain(":not(.isSelected)");
    expect(selector).toContain(':not([aria-pressed="true"])');
    expect(selector).toContain(':not([aria-selected="true"])');
    expect(selector).toContain(':not([aria-expanded="true"])');
  });

  it("keeps selected trade choices readable in settings and onboarding", () => {
    expect(contractCss).toContain("Selected trade contrast contract");
    expect(contractCss).toContain("html body .tradeChoice.isSelected:hover");
    expect(contractCss).toContain(
      'html body .tradeChoice[aria-pressed="true"]:focus-visible',
    );
    expect(contractCss).toContain(
      "html body .tradeMultiSelectOnboarding .tradeChoice.isSelected:hover",
    );

    const selectedTradeBody = findLastRuleBody("html body .tradeChoice.isSelected,");
    const onboardingTradeBody = findLastRuleBody(
      "html body .tradeMultiSelectOnboarding .tradeChoice.isSelected,",
    );

    expect(selectedTradeBody).toContain("background: #0f766e !important");
    expect(selectedTradeBody).toContain("color: #ffffff !important");
    expect(onboardingTradeBody).toContain("background: #1f63ff !important");
    expect(onboardingTradeBody).toContain("color: #ffffff !important");
  });

  it("covers specialist clickable controls that used to fall back to legacy hover", () => {
    expect(contractCss).toContain("Specificity lock");
    expect(contractCss).toContain(".customerPickerDeleteButton:hover:not(:disabled)");
    expect(contractCss).toContain(".positionDeleteButton:hover:not(:disabled)");
    expect(contractCss).toContain(".serviceAddCustomButton:hover:not(:disabled)");
    expect(contractCss).toContain("button.dateInputIconButton:hover:not(:disabled)");
    expect(contractCss).toContain(".settingsSectionToggle:hover:not(:disabled)");
    expect(contractCss).toContain("background: rgba(231, 239, 255, 0.66)");
    expect(contractCss).toContain(".settingsSectionBadge-ok");
    expect(contractCss).toContain(".settingsSectionBadge-warning");
    expect(contractCss).toContain(".settingsSectionBadge-error");
    expect(contractCss).toContain(".settingsFieldNeedsAttention-error");
    expect(contractCss).toContain(".settingsFieldNeedsAttention-warning");
  });

  it("keeps focus visible and suggestion lists scrollable", () => {
    expect(contractCss).toContain("button.dashboardModeToggleButton:focus-visible");
    expect(contractCss).toContain("outline: 3px solid var(--vis-control-focus)");
    expect(contractCss).toContain("overflow-y: auto !important");
    expect(contractCss).not.toContain(".subscriptionModalBody,\n.subscriptionPricingGrid");
  });

  it("does not let the global shadow guard break modal scrolling", () => {
    const shadowGuardStart = css.indexOf("Global Shadow Clipping Guard");
    expect(shadowGuardStart).toBeGreaterThan(-1);

    const shadowGuardCss = css.slice(shadowGuardStart);
    const visibleOverflowRule = shadowGuardCss.match(
      /html body :is\((?<selectors>[\s\S]*?)\)\s*\{\s*overflow:\s*visible !important;\s*\}/,
    );

    expect(visibleOverflowRule?.groups?.selectors ?? "").not.toContain(
      ".customerArchiveSheet",
    );
    expect(visibleOverflowRule?.groups?.selectors ?? "").toContain(
      ".settingsAccordionSection",
    );
    expect(shadowGuardCss).toContain("html body .customerArchiveSheet {");
    expect(shadowGuardCss).toContain(
      "html body .customerArchiveSheet.appointmentsSheet {",
    );
    expect(shadowGuardCss).toContain("overflow-y: auto !important");
  });

  it("keeps mobile onboarding top-aligned and archive back navigation readable", () => {
    expect(css).toContain("place-items: start stretch !important");
    expect(css).toContain("html body button.customerArchiveBackButton");
    expect(css).toContain("width: auto !important");
    expect(css).toContain("min-height: 44px !important");
  });
});
