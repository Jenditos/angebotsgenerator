import { OfferPdfLineItem } from "@/types/offer";

export type TableRenderableRow =
  | {
      kind: "group";
      title: string;
    }
  | {
      kind: "item";
      item: OfferPdfLineItem;
    };

export function buildTableRenderableRows(
  rows: OfferPdfLineItem[],
): TableRenderableRow[] {
  const renderableRows: TableRenderableRow[] = [];
  let currentGroup = "";

  rows.forEach((row) => {
    const rowGroup = row.group?.trim() || "";
    if (rowGroup && rowGroup !== currentGroup) {
      renderableRows.push({ kind: "group", title: rowGroup });
      currentGroup = rowGroup;
    }

    if (!rowGroup) {
      currentGroup = "";
    }

    renderableRows.push({ kind: "item", item: row });
  });

  return renderableRows;
}

function estimateRenderableRowUnits(row: TableRenderableRow): number {
  if (row.kind === "group") {
    return 0.8;
  }

  const descriptionLength = row.item.description.trim().length;
  return Math.max(1, Math.ceil(descriptionLength / 62));
}

export function chunkRenderableRows(
  rows: TableRenderableRow[],
  firstPageCapacity: number,
  followingPageCapacity: number,
): TableRenderableRow[][] {
  if (rows.length === 0) {
    return [[]];
  }

  const chunks: TableRenderableRow[][] = [];
  let currentChunk: TableRenderableRow[] = [];
  let usedUnits = 0;
  let capacity = firstPageCapacity;

  rows.forEach((row) => {
    const rowUnits = estimateRenderableRowUnits(row);
    if (currentChunk.length > 0 && usedUnits + rowUnits > capacity) {
      chunks.push(currentChunk);
      currentChunk = [];
      usedUnits = 0;
      capacity = followingPageCapacity;
    }

    currentChunk.push(row);
    usedUnits += rowUnits;
  });

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

