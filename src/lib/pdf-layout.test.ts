import {
  buildTableRenderableRows,
  chunkRenderableRows,
} from "@/lib/pdf-layout";
import { OfferPdfLineItem } from "@/types/offer";

function createLineItem(
  position: number,
  description: string,
  group?: string,
): OfferPdfLineItem {
  return {
    position,
    quantity: 1,
    description,
    unit: "Stk",
    unitPrice: 10,
    totalPrice: 10,
    group,
  };
}

describe("pdf-layout", () => {
  it("adds group rows once per contiguous group block", () => {
    const rows = [
      createLineItem(1, "Vorbereitung", "Elektro"),
      createLineItem(2, "Schalter tauschen", "Elektro"),
      createLineItem(3, "Ohne Gruppe"),
      createLineItem(4, "Fliesen schneiden", "Fliesen"),
      createLineItem(5, "Fliesen verlegen", "Fliesen"),
    ];

    const renderable = buildTableRenderableRows(rows);
    const groups = renderable.filter((row) => row.kind === "group");
    const items = renderable.filter((row) => row.kind === "item");

    expect(groups).toEqual([
      { kind: "group", title: "Elektro" },
      { kind: "group", title: "Fliesen" },
    ]);
    expect(items).toHaveLength(5);
  });

  it("chunks long row collections into multiple pages", () => {
    const longDescription = "A".repeat(200);
    const renderable = buildTableRenderableRows([
      createLineItem(1, longDescription, "Maler"),
      createLineItem(2, longDescription, "Maler"),
      createLineItem(3, longDescription, "Maler"),
    ]);

    const chunks = chunkRenderableRows(renderable, 4.5, 4.5);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(renderable.length);
    expect(chunks[0]?.some((row) => row.kind === "group")).toBe(true);
  });

  it("returns a single empty chunk for empty input", () => {
    expect(chunkRenderableRows([], 8.2, 20.2)).toEqual([[]]);
  });
});

