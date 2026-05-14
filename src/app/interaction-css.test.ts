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
});
