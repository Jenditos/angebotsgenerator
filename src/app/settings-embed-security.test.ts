import { readFileSync } from "node:fs";
import path from "node:path";

describe("embedded settings security headers", () => {
  const nextConfig = readFileSync(
    path.join(process.cwd(), "next.config.mjs"),
    "utf8",
  );

  it("allows the app to embed its own settings page without allowing external framing", () => {
    expect(nextConfig).toContain("\"frame-ancestors 'self'\"");
    expect(nextConfig).toContain('value: "SAMEORIGIN"');
    expect(nextConfig).not.toContain("\"frame-ancestors 'none'\"");
    expect(nextConfig).not.toContain('value: "DENY"');
  });
});
