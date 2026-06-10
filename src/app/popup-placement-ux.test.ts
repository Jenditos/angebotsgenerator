import { readFileSync } from "node:fs";
import path from "node:path";

describe("popup placement contract", () => {
  const styles = readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  it("centers every full-screen dialog backdrop with one shared rule", () => {
    const contractStart = styles.indexOf(
      "/* Dialog placement contract: every full-screen popup is centered consistently. */",
    );
    const contract = styles.slice(contractStart);

    expect(contractStart).toBeGreaterThan(-1);
    expect(contract).toContain(".settingsOverlayBackdrop");
    expect(contract).toContain(".customerPickerModalBackdrop");
    expect(contract).toContain(".infoLegalBackdrop");
    expect(contract).toContain(".voiceLoginModalBackdrop");
    expect(contract).toContain(".customerArchiveBackdrop");
    expect(contract).toContain(".projectDeleteBackdrop");
    expect(contract).toContain("place-items: center !important;");
    expect(contract).toContain("align-items: center !important;");
    expect(contract).toContain("justify-content: center !important;");
  });

  it("keeps centered dialogs inside the visible viewport", () => {
    const contractStart = styles.indexOf(
      "/* Dialog placement contract: every full-screen popup is centered consistently. */",
    );
    const contract = styles.slice(contractStart);

    expect(contract).toContain("height: 100dvh !important;");
    expect(contract).toContain("box-sizing: border-box !important;");
    expect(contract).toContain("overflow: auto !important;");
    expect(contract).toContain("margin: auto !important;");
  });
});
