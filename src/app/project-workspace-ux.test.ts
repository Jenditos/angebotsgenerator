import { readFileSync } from "node:fs";
import path from "node:path";

describe("simple construction-site workspace", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/page.tsx"),
    "utf8",
  );

  it("uses simple action labels and hides advanced fields behind details", () => {
    expect(source).toContain("Für welche Baustelle ist dieses Dokument?");
    expect(source).toContain("Baustelle auswählen");
    expect(source).toContain("+ Neue Baustelle anlegen");
    expect(source).toContain("<summary>Weitere Angaben</summary>");
    expect(source).toContain("Andere Baustelle wählen");
    expect(source).not.toContain("Projekt lösen");
    expect(source).not.toContain("Projektakte");
  });

  it("does not require an IBAN before creating a document", () => {
    expect(source).not.toContain(
      "Bitte hinterlegen Sie in den Einstellungen eine gültige IBAN, bevor Dokumente erstellt werden.",
    );
    expect(source).toContain(
      "Die hinterlegte IBAN ist ungültig. Bitte in den Einstellungen prüfen.",
    );
  });
});
