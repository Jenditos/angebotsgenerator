import { readFileSync } from "node:fs";
import path from "node:path";

describe("upgrade page UX", () => {
  const clientSource = readFileSync(
    path.join(process.cwd(), "src/app/upgrade/UpgradePageClient.tsx"),
    "utf8",
  );
  const cssSource = readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  it("uses a compact responsive layout without clipped status messages", () => {
    expect(clientSource).toContain("upgradeContainer");
    expect(clientSource).toContain("upgradeActions");
    expect(cssSource).toContain("html body .upgradeContainer");
    expect(cssSource).toContain("width: min(720px, 100%) !important");
    expect(cssSource).toContain("white-space: normal !important");
    expect(cssSource).toContain("overflow-wrap: anywhere !important");
  });
});
