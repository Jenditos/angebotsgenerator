import { PdfTableColumnConfig, PdfTableColumnId } from "@/types/offer";

const DEFAULT_COLUMNS: PdfTableColumnConfig[] = [
  { id: "position", label: "Position", visible: true, order: 0 },
  { id: "quantity", label: "Menge", visible: true, order: 1 },
  { id: "description", label: "Bezeichnung / Leistung", visible: true, order: 2 },
  { id: "unit", label: "Einheit", visible: true, order: 3 },
  { id: "unitPrice", label: "Einzelpreis", visible: true, order: 4 },
  { id: "totalPrice", label: "Gesamtpreis", visible: true, order: 5 }
];

function isPdfColumnId(value: string): value is PdfTableColumnId {
  return DEFAULT_COLUMNS.some((column) => column.id === value);
}

export function getDefaultPdfTableColumns(): PdfTableColumnConfig[] {
  return DEFAULT_COLUMNS.map((column) => ({ ...column }));
}

export function sortPdfTableColumns(columns: PdfTableColumnConfig[]): PdfTableColumnConfig[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

export function sanitizePdfTableColumns(payload: unknown): PdfTableColumnConfig[] {
  const defaults = getDefaultPdfTableColumns();
  if (!Array.isArray(payload)) {
    return defaults;
  }

  const persistedById = new Map<PdfTableColumnId, { label?: string; visible?: boolean; order?: number }>();

  for (const item of payload) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const id = "id" in item && typeof item.id === "string" ? item.id : "";
    if (!isPdfColumnId(id)) {
      continue;
    }

    const label = "label" in item && typeof item.label === "string" ? item.label.trim() : undefined;
    const visible = "visible" in item && typeof item.visible === "boolean" ? item.visible : undefined;
    const order =
      "order" in item && typeof item.order === "number" && Number.isFinite(item.order)
        ? item.order
        : undefined;

    persistedById.set(id, { label, visible, order });
  }

  return sortPdfTableColumns(
    defaults.map((column) => {
      const persisted = persistedById.get(column.id);
      return {
        ...column,
        label: persisted?.label || column.label,
        visible: typeof persisted?.visible === "boolean" ? persisted.visible : column.visible,
        order: typeof persisted?.order === "number" ? persisted.order : column.order
      };
    })
  ).map((column, index) => ({
    ...column,
    order: index
  }));
}
