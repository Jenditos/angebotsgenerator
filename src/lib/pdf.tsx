import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import {
  getDefaultPdfTableColumns,
  sortPdfTableColumns,
} from "@/lib/pdf-table-config";
import {
  DocumentType,
  CompanySettings,
  OfferPdfLineItem,
  OfferText,
  PdfTableColumnId,
} from "@/types/offer";

Font.registerHyphenationCallback((word) => [word]);

const theme = {
  canvas: "#ffffff",
  border: "#d5dde8",
  borderSoft: "#e5e9f0",
  text: "#10203a",
  textMuted: "#435068",
  textSoft: "#6a778f",
  accent: "#3f6fb2",
  accentStrong: "#2b4f85",
};

const styles = StyleSheet.create({
  page: {
    backgroundColor: theme.canvas,
    paddingHorizontal: 34,
    paddingTop: 14,
    paddingBottom: 32,
    fontFamily: "Helvetica",
    fontSize: 9.6,
    color: theme.text,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 2,
  },
  topLeft: {
    width: "56%",
  },
  senderCompactLine: {
    fontSize: 8,
    color: theme.textSoft,
    lineHeight: 1.35,
    marginBottom: 0.5,
  },
  senderContactLine: {
    fontSize: 7.8,
    color: theme.textSoft,
    lineHeight: 1.3,
  },
  topRight: {
    width: "40%",
    alignItems: "flex-end",
  },
  companyLogo: {
    width: 222,
    height: 108,
    objectFit: "contain",
  },
  topDivider: {
    borderTop: `1 solid ${theme.border}`,
    marginBottom: 4,
  },
  offerHeading: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 0.9,
    color: theme.accentStrong,
    marginBottom: 4,
  },
  addressMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  recipientBlock: {
    width: "56%",
  },
  blockLabel: {
    fontSize: 7.9,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: theme.textSoft,
    marginBottom: 3,
  },
  recipientName: {
    fontSize: 10.9,
    fontWeight: 700,
    color: theme.text,
    lineHeight: 1.18,
    marginBottom: 0.3,
  },
  recipientLine: {
    color: theme.textMuted,
    lineHeight: 1.18,
    marginBottom: 0.3,
  },
  metadataBlock: {
    width: "40%",
    border: `1 solid ${theme.border}`,
    paddingHorizontal: 7,
    paddingVertical: 4.5,
  },
  metadataRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 1.5,
  },
  metadataRowLast: {
    marginBottom: 0,
  },
  metadataLabel: {
    width: "62%",
    fontSize: 8,
    color: theme.textMuted,
    lineHeight: 1.3,
  },
  metadataValue: {
    width: "36%",
    fontSize: 8.5,
    color: theme.text,
    textAlign: "right",
    lineHeight: 1.3,
  },
  introSection: {
    borderTop: `1 solid ${theme.border}`,
    paddingTop: 4,
    marginBottom: 5,
  },
  introParagraph: {
    color: theme.textMuted,
    lineHeight: 1.18,
    marginBottom: 2.1,
  },
  introParagraphSalutation: {
    marginBottom: 4.8,
  },
  introParagraphLast: {
    marginBottom: 0,
  },
  locationBlock: {
    border: `1 solid ${theme.border}`,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 5,
  },
  locationColumn: {
    width: "100%",
  },
  locationLine: {
    color: theme.textMuted,
    lineHeight: 1.32,
    marginBottom: 0.5,
  },
  continuationHeader: {
    borderBottom: `1 solid ${theme.border}`,
    paddingBottom: 6,
    marginBottom: 7,
  },
  continuationHeading: {
    fontSize: 14,
    fontWeight: 700,
    color: theme.accentStrong,
    marginBottom: 2,
  },
  continuationSubtitle: {
    fontSize: 8.3,
    color: theme.textSoft,
  },
  tableWrap: {
    border: `1 solid ${theme.border}`,
    marginBottom: 5,
  },
  tableDetailsSection: {
    border: `1 solid ${theme.border}`,
    borderTop: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: -5,
    marginBottom: 5,
  },
  tableDetailsLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.35,
    color: theme.textSoft,
    marginBottom: 2,
  },
  tableDetailsText: {
    fontSize: 8.8,
    lineHeight: 1.3,
    color: theme.textMuted,
  },
  tableHead: {
    flexDirection: "row",
    borderBottom: `1 solid ${theme.border}`,
    backgroundColor: theme.accent,
  },
  tableHeadCell: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 8.2,
    color: "#ffffff",
    fontWeight: 700,
    lineHeight: 1.2,
  },
  tableHeadCellDescription: {
    paddingRight: 12,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: `1 solid ${theme.borderSoft}`,
  },
  tableRowAlt: {
    backgroundColor: "#f8fbff",
  },
  tableGroupRow: {
    borderBottom: `1 solid ${theme.borderSoft}`,
    backgroundColor: "#edf3fb",
  },
  tableGroupCell: {
    width: "100%",
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 8.05,
    textTransform: "uppercase",
    letterSpacing: 0.35,
    color: theme.textMuted,
    fontWeight: 700,
  },
  tableCell: {
    paddingHorizontal: 8,
    paddingVertical: 6.2,
    color: theme.text,
    lineHeight: 1.38,
    fontSize: 8.9,
  },
  tableCellDescription: {
    paddingRight: 12,
  },
  tableCellDivider: {
    borderRight: `1 solid ${theme.borderSoft}`,
  },
  tableCellNumeric: {
    textAlign: "right",
  },
  totalsWrap: {
    alignItems: "flex-end",
    marginBottom: 6,
  },
  totalsBox: {
    width: "51%",
    border: `1 solid ${theme.border}`,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  totalsRowLast: {
    marginBottom: 0,
  },
  totalsLabel: {
    fontSize: 9,
    color: theme.textMuted,
  },
  totalsValue: {
    fontSize: 9,
    color: theme.text,
  },
  totalsDivider: {
    borderTop: `1 solid ${theme.border}`,
    marginTop: 1,
    marginBottom: 5,
  },
  totalsGrandLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: theme.text,
  },
  totalsGrandValue: {
    fontSize: 13.5,
    fontWeight: 700,
    color: theme.accentStrong,
  },
  validityText: {
    marginTop: 5,
    fontSize: 8.4,
    color: theme.textMuted,
  },
  notesSection: {
    borderTop: `1 solid ${theme.border}`,
    paddingTop: 5,
    marginTop: 5,
    marginBottom: 4,
  },
  noteTitle: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.45,
    color: theme.textSoft,
    marginBottom: 3,
  },
  noteText: {
    color: theme.textMuted,
    lineHeight: 1.35,
    marginBottom: 0,
  },
  closingSection: {
    marginTop: 1,
  },
  closingLine: {
    color: theme.textMuted,
    lineHeight: 1.3,
    marginBottom: 5,
  },
  closingSignature: {
    color: theme.text,
    lineHeight: 1.3,
    fontWeight: 700,
  },
  pageFooter: {
    position: "absolute",
    right: 34,
    bottom: 14,
    fontSize: 8,
    color: theme.textSoft,
    textAlign: "right",
  },
});

type OfferPdfDocumentProps = {
  offer: OfferText;
  offerNumber: string;
  documentType?: DocumentType;
  customerNumber?: string;
  createdAt: string;
  invoiceDate?: string;
  serviceDate?: string;
  paymentDueDays?: number;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  serviceDescription: string;
  projectDetails?: string;
  lineItems: OfferPdfLineItem[];
  settings: CompanySettings;
};

function isNumericColumn(columnId: PdfTableColumnId): boolean {
  return (
    columnId === "position" ||
    columnId === "quantity" ||
    columnId === "unitPrice" ||
    columnId === "totalPrice"
  );
}

const COLUMN_WEIGHTS: Record<PdfTableColumnId, number> = {
  position: 0.52,
  description: 5.5,
  quantity: 1.0,
  unit: 0.92,
  unitPrice: 1.3,
  totalPrice: 1.45,
};

const CLASSIC_COLUMN_ORDER: PdfTableColumnId[] = [
  "position",
  "description",
  "quantity",
  "unit",
  "unitPrice",
  "totalPrice",
];

function formatMoney(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function cellValueForColumn(
  columnId: PdfTableColumnId,
  lineItem: OfferPdfLineItem,
): string {
  switch (columnId) {
    case "position":
      return String(lineItem.position);
    case "quantity":
      return new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(lineItem.quantity);
    case "description":
      return lineItem.description;
    case "unit":
      return lineItem.unit || "-";
    case "unitPrice":
      return `${formatMoney(lineItem.unitPrice)} €`;
    case "totalPrice":
      return `${formatMoney(lineItem.totalPrice)} €`;
    default:
      return "";
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function addDays(base: Date, days: number): Date {
  const target = new Date(base.getTime());
  target.setDate(target.getDate() + days);
  return target;
}

function resolveDateInput(value: string | undefined, fallback: Date): Date {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return fallback;
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function splitAddressLines(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitParagraphs(value: string): string[] {
  return value
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function stripLocationLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(Leistungsort|Lieferanschrift)\s*:/i.test(line))
    .join("\n")
    .trim();
}

const INVOICE_NOTE_BLACKLIST_PATTERNS = [
  /Änderungen durch unvorhergesehene Baustellenbedingungen bleiben vorbehalten\.?/gi,
  /Dieses Angebot basiert auf den aktuell gültigen Materialpreisen\.?/gi,
];

function sanitizeInvoiceTermsText(value: string): string {
  let sanitized = value;
  for (const pattern of INVOICE_NOTE_BLACKLIST_PATTERNS) {
    sanitized = sanitized.replace(pattern, " ");
  }

  return sanitized.replace(/\s+/g, " ").trim();
}

function buildInvoicePaymentDueLabel(days: number): string {
  if (days <= 0) {
    return "Zahlbar sofort ohne Abzug";
  }

  return `Zahlbar innerhalb von ${days} Tagen ohne Abzug`;
}

function buildInvoicePaymentDueSentence(days: number): string {
  if (days <= 0) {
    return "sofort ohne Abzug";
  }

  return `innerhalb von ${days} Tagen ohne Abzug`;
}

function isSalutationParagraph(value: string): boolean {
  return /^sehr\s+geehrt/i.test(value.trim());
}

function normalizeAddressForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addressesAreEquivalent(left: string, right: string): boolean {
  const leftNormalized = normalizeAddressForComparison(left);
  const rightNormalized = normalizeAddressForComparison(right);
  if (!leftNormalized || !rightNormalized) {
    return false;
  }

  return (
    leftNormalized === rightNormalized ||
    leftNormalized.includes(rightNormalized) ||
    rightNormalized.includes(leftNormalized)
  );
}

function extractOptionalLocationBlock(
  serviceDescription: string,
): { label: "Leistungsort" | "Lieferanschrift"; value: string } | null {
  const lines = serviceDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(
      /^(Leistungsort|Lieferanschrift)\s*:\s*(.+)$/i,
    );
    if (!match) {
      continue;
    }

    const normalizedLabel = match[1].toLowerCase();
    const value = match[2].trim();
    if (!value) {
      continue;
    }

    return {
      label: normalizedLabel === "lieferanschrift" ? "Lieferanschrift" : "Leistungsort",
      value,
    };
  }

  return null;
}

function buildSenderCompactLine(settings: CompanySettings): string {
  const postalCity = [settings.companyPostalCode, settings.companyCity]
    .filter(Boolean)
    .join(" ")
    .trim();
  return [settings.companyName, settings.companyStreet, postalCity]
    .filter(Boolean)
    .join(" • ");
}

function buildSenderContactLine(settings: CompanySettings): string {
  return [settings.companyPhone, settings.companyEmail, settings.companyWebsite]
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .join(" • ");
}

type TableRenderableRow =
  | {
      kind: "group";
      title: string;
    }
  | {
      kind: "item";
      item: OfferPdfLineItem;
    };

function buildTableRenderableRows(
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

function toTableHeaderLabel(
  columnId: PdfTableColumnId,
  fallbackLabel: string,
): string {
  switch (columnId) {
    case "position":
      return "Pos.";
    case "description":
      return "Bezeichnung";
    case "quantity":
      return "Menge";
    case "unit":
      return "Einheit";
    case "unitPrice":
      return "E-Preis €";
    case "totalPrice":
      return "G-Preis €";
    default:
      return fallbackLabel;
  }
}

function sortColumnsForClassicLayout<T extends { id: PdfTableColumnId }>(
  columns: T[],
): T[] {
  const rankByColumnId = CLASSIC_COLUMN_ORDER.reduce(
    (acc, columnId, index) => {
      acc[columnId] = index;
      return acc;
    },
    {} as Record<PdfTableColumnId, number>,
  );

  return [...columns].sort(
    (left, right) => rankByColumnId[left.id] - rankByColumnId[right.id],
  );
}

function estimateRenderableRowUnits(row: TableRenderableRow): number {
  if (row.kind === "group") {
    return 0.8;
  }

  const descriptionLength = row.item.description.trim().length;
  return Math.max(1, Math.ceil(descriptionLength / 62));
}

function chunkRenderableRows(
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

export function OfferPdfDocument({
  offer,
  offerNumber,
  documentType,
  customerNumber,
  createdAt,
  invoiceDate,
  serviceDate,
  paymentDueDays,
  customerName,
  customerAddress,
  customerEmail,
  serviceDescription,
  projectDetails,
  lineItems,
  settings,
}: OfferPdfDocumentProps) {
  const customerAddressLines = splitAddressLines(customerAddress);
  const customerStreetLine = customerAddressLines[0] || customerAddress;
  const customerPostalCityLine = customerAddressLines[1] || "";
  const customerAdditionalLines = customerAddressLines.slice(2);
  const optionalLocation = extractOptionalLocationBlock(serviceDescription);
  const customerAddressForComparison = [
    customerStreetLine,
    customerPostalCityLine,
    ...customerAdditionalLines,
  ]
    .filter(Boolean)
    .join(", ");
  const showOptionalLocation =
    Boolean(optionalLocation) &&
    !addressesAreEquivalent(
      optionalLocation?.value ?? "",
      customerAddressForComparison,
    );
  const introParagraphs = splitParagraphs(offer.intro || "");
  const projectDetailsText = stripLocationLines(projectDetails || "");

  const parsedCreatedAt = new Date(createdAt);
  const generatedAt = Number.isNaN(parsedCreatedAt.getTime())
    ? new Date()
    : parsedCreatedAt;
  const resolvedDocumentType: DocumentType =
    documentType === "invoice" ? "invoice" : "offer";
  const documentDate =
    resolvedDocumentType === "invoice"
      ? resolveDateInput(invoiceDate, generatedAt)
      : generatedAt;
  const resolvedServiceDate =
    resolvedDocumentType === "invoice"
      ? (serviceDate || "").trim()
      : "";

  const today = documentDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const vatRate = clampNumber(settings.vatRate, 0, 100);
  const offerValidityDays = clampNumber(settings.offerValidityDays, 1, 365);
  const validUntilDate = addDays(documentDate, offerValidityDays).toLocaleDateString(
    "de-DE",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    },
  );
  const resolvedPaymentDueDays = clampNumber(paymentDueDays ?? 14, 0, 365);
  const invoicePaymentDueLabel = buildInvoicePaymentDueLabel(
    resolvedPaymentDueDays,
  );

  const defaultNumberPrefix = resolvedDocumentType === "invoice" ? "RE" : "ANG";
  const quoteNumber =
    (typeof offerNumber === "string" ? offerNumber.trim() : "") ||
    `${defaultNumberPrefix}-${documentDate.getFullYear()}-001`;
  const documentHeading = resolvedDocumentType === "invoice" ? "RECHNUNG" : "ANGEBOT";
  const documentNumberLabel =
    resolvedDocumentType === "invoice" ? "Rechnungs-Nr." : "Angebots-Nr.";
  const servicePeriodLabel = resolvedServiceDate || "—";

  const senderCompactLine = buildSenderCompactLine(settings);
  const senderContactLine = buildSenderContactLine(settings);
  const closingSignatureName =
    settings.companyName?.trim() ||
    settings.ownerName?.trim() ||
    "";
  const configuredColumns = sortPdfTableColumns(settings.pdfTableColumns).filter(
    (column) => column.visible,
  );
  const fallbackColumns = sortPdfTableColumns(getDefaultPdfTableColumns()).filter(
    (column) => column.visible,
  );
  const visibleColumns = sortColumnsForClassicLayout(
    configuredColumns.length > 0 ? configuredColumns : fallbackColumns,
  );

  const totalColumnWeight =
    visibleColumns.reduce((sum, column) => sum + COLUMN_WEIGHTS[column.id], 0) || 1;

  const columnWidthById = visibleColumns.reduce(
    (acc, column) => {
      acc[column.id] = `${(COLUMN_WEIGHTS[column.id] / totalColumnWeight) * 100}%`;
      return acc;
    },
    {} as Partial<Record<PdfTableColumnId, string>>,
  );

  const subtotal = lineItems.reduce((sum, lineItem) => sum + lineItem.totalPrice, 0);
  const tableRows =
    lineItems.length > 0
      ? lineItems
      : [
          {
            position: 1,
            quantity: 1,
            description: serviceDescription || "Leistung",
            unit: "Psch.",
            unitPrice: 0,
            totalPrice: 0,
          },
        ];

  const renderableRows = buildTableRenderableRows(tableRows);
  const rowChunks = chunkRenderableRows(renderableRows, 8.2, 20.2);
  const pageCount = rowChunks.length;

  const vatAmount = subtotal * (vatRate / 100);
  const totalAmount = subtotal + vatAmount;
  const termsText = settings.offerTermsText?.trim();
  const sanitizedInvoiceTermsText = sanitizeInvoiceTermsText(termsText || "");
  const notesText =
    resolvedDocumentType === "invoice"
      ? [
          "Diese Rechnung ist gemäß ausgewiesenem Zahlungsziel fällig.",
          sanitizedInvoiceTermsText,
        ]
          .filter(Boolean)
          .join(" ")
      : termsText || "";

  const chunkStartItemIndex: number[] = [];
  let consumedItems = 0;
  rowChunks.forEach((chunk) => {
    chunkStartItemIndex.push(consumedItems);
    consumedItems += chunk.filter((row) => row.kind === "item").length;
  });

  return (
    <Document>
      {rowChunks.map((chunk, chunkIndex) => {
        const isFirstPage = chunkIndex === 0;
        const isLastPage = chunkIndex === rowChunks.length - 1;

        const metadataRows = [
          { label: documentNumberLabel, value: quoteNumber },
          { label: "Kunden-Nr.", value: customerNumber?.trim() || "—" },
          ...(resolvedDocumentType === "invoice"
            ? [
                { label: "Rechnungsdatum", value: today },
                { label: "Leistungszeitraum", value: servicePeriodLabel },
                {
                  label: "Zahlungsziel",
                  value: invoicePaymentDueLabel,
                },
              ]
              : [
                  { label: "Datum", value: today },
                ]),
        ];

        let globalItemIndex = chunkStartItemIndex[chunkIndex] ?? 0;

        return (
          <Page key={`page-${chunkIndex}`} size="A4" style={styles.page}>
            {isFirstPage ? (
              <>
                <View style={styles.topRow}>
                  <View style={styles.topLeft}>
                    {senderCompactLine ? (
                      <Text style={styles.senderCompactLine}>{senderCompactLine}</Text>
                    ) : null}
                    {senderContactLine ? (
                      <Text style={styles.senderContactLine}>{senderContactLine}</Text>
                    ) : null}
                  </View>

                  <View style={styles.topRight}>
                    {settings.logoDataUrl ? (
                      <Image src={settings.logoDataUrl} style={styles.companyLogo} />
                    ) : null}
                  </View>
                </View>

                <View style={styles.topDivider} />

                <Text style={styles.offerHeading}>{documentHeading}</Text>

                <View style={styles.addressMetaRow}>
                  <View style={styles.recipientBlock}>
                    <Text style={styles.recipientName}>{customerName || "Kunde"}</Text>
                    <Text style={styles.recipientLine}>{customerStreetLine}</Text>
                    {customerPostalCityLine ? (
                      <Text style={styles.recipientLine}>{customerPostalCityLine}</Text>
                    ) : null}
                    {customerAdditionalLines.map((line, index) => (
                      <Text key={`customer-extra-${index}`} style={styles.recipientLine}>
                        {line}
                      </Text>
                    ))}
                    {customerEmail ? (
                      <Text style={styles.recipientLine}>E-Mail: {customerEmail}</Text>
                    ) : null}
                  </View>

                  <View style={styles.metadataBlock}>
                    {metadataRows.map((row, rowIndex) => {
                      const rowStyles =
                        rowIndex === metadataRows.length - 1
                          ? [styles.metadataRow, styles.metadataRowLast]
                          : styles.metadataRow;
                      return (
                        <View key={`meta-${row.label}`} style={rowStyles}>
                          <Text style={styles.metadataLabel}>{row.label}</Text>
                          <Text style={styles.metadataValue}>{row.value}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {showOptionalLocation && optionalLocation ? (
                  <View style={styles.locationBlock}>
                    <View style={styles.locationColumn}>
                      <Text style={styles.blockLabel}>{optionalLocation.label}</Text>
                      <Text style={styles.locationLine}>{optionalLocation.value}</Text>
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.continuationHeader}>
                <Text style={styles.continuationHeading}>{documentHeading}</Text>
                <Text
                  style={styles.continuationSubtitle}
                >{`${documentNumberLabel} ${quoteNumber} • ${customerName || "Kunde"}`}</Text>
              </View>
            )}

            {isFirstPage && introParagraphs.length > 0 ? (
              <View style={styles.introSection}>
                {introParagraphs.map((paragraph, paragraphIndex) => (
                  <Text
                    key={`intro-paragraph-${paragraphIndex}`}
                    style={
                      paragraphIndex === introParagraphs.length - 1
                        ? [styles.introParagraph, styles.introParagraphLast]
                        : paragraphIndex === 0 && isSalutationParagraph(paragraph)
                          ? [styles.introParagraph, styles.introParagraphSalutation]
                        : styles.introParagraph
                    }
                  >
                    {paragraph}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={styles.tableWrap}>
              <View style={styles.tableHead}>
                {visibleColumns.map((column, columnIndex) => {
                  const columnWidth =
                    columnWidthById[column.id] ?? `${100 / visibleColumns.length}%`;
                  const headCellStyle: any[] = [
                    styles.tableHeadCell,
                    { width: columnWidth },
                  ];

                  if (column.id === "description") {
                    headCellStyle.push(styles.tableHeadCellDescription);
                  }
                  if (columnIndex < visibleColumns.length - 1) {
                    headCellStyle.push(styles.tableCellDivider);
                  }
                  if (isNumericColumn(column.id)) {
                    headCellStyle.push(styles.tableCellNumeric);
                  }

                  return (
                    <Text
                      key={`head-${chunkIndex}-${column.id}`}
                      style={headCellStyle}
                    >
                      {toTableHeaderLabel(column.id, column.label)}
                    </Text>
                  );
                })}
              </View>

              {chunk.map((row, rowIndex) => {
                if (row.kind === "group") {
                  return (
                    <View
                      key={`group-${chunkIndex}-${rowIndex}-${row.title}`}
                      style={styles.tableGroupRow}
                      wrap={false}
                    >
                      <Text style={styles.tableGroupCell}>{row.title}</Text>
                    </View>
                  );
                }

                const rowStyle =
                  globalItemIndex % 2 === 1
                    ? [styles.tableRow, styles.tableRowAlt]
                    : styles.tableRow;
                globalItemIndex += 1;

                return (
                  <View
                    key={`row-${chunkIndex}-${rowIndex}-${row.item.position}`}
                    style={rowStyle}
                    wrap={false}
                  >
                    {visibleColumns.map((column, columnIndex) => {
                      const columnWidth =
                        columnWidthById[column.id] ?? `${100 / visibleColumns.length}%`;
                      const rowCellStyle: any[] = [styles.tableCell, { width: columnWidth }];

                      if (column.id === "description") {
                        rowCellStyle.push(styles.tableCellDescription);
                      }
                      if (columnIndex < visibleColumns.length - 1) {
                        rowCellStyle.push(styles.tableCellDivider);
                      }
                      if (isNumericColumn(column.id)) {
                        rowCellStyle.push(styles.tableCellNumeric);
                      }

                      return (
                        <Text
                          key={`row-${chunkIndex}-${rowIndex}-${column.id}`}
                          style={rowCellStyle}
                        >
                          {cellValueForColumn(column.id, row.item)}
                        </Text>
                      );
                    })}
                  </View>
                );
              })}
            </View>

            {isLastPage && projectDetailsText ? (
              <View style={styles.tableDetailsSection}>
                <Text style={styles.tableDetailsLabel}>
                  Projektbeschreibung / Zusatzdetails
                </Text>
                <Text style={styles.tableDetailsText}>{projectDetailsText}</Text>
              </View>
            ) : null}

                {isLastPage ? (
                  <>
                    <View style={styles.totalsWrap}>
                  <View style={styles.totalsBox}>
                    <View style={styles.totalsRow}>
                      <Text style={styles.totalsLabel}>Zwischensumme</Text>
                      <Text style={styles.totalsValue}>{formatMoney(subtotal)} €</Text>
                    </View>
                    <View style={styles.totalsRow}>
                      <Text
                        style={styles.totalsLabel}
                      >{`MwSt. (${vatRate.toFixed(vatRate % 1 === 0 ? 0 : 1)}%)`}</Text>
                      <Text style={styles.totalsValue}>{formatMoney(vatAmount)} €</Text>
                    </View>
                    <View style={styles.totalsDivider} />
                    <View style={[styles.totalsRow, styles.totalsRowLast]}>
                      <Text style={styles.totalsGrandLabel}>Gesamtbetrag</Text>
                      <Text style={styles.totalsGrandValue}>{formatMoney(totalAmount)} €</Text>
                    </View>
                  </View>
                  <Text style={styles.validityText}>
                    {resolvedDocumentType === "invoice"
                      ? invoicePaymentDueLabel
                      : `Dieses Angebot ist gültig bis: ${validUntilDate}`}
                  </Text>
                    </View>

                    {notesText ? (
                      <View style={styles.notesSection}>
                        <Text style={styles.noteTitle}>
                          Zahlungsbedingungen / Hinweise
                        </Text>
                        <Text style={styles.noteText}>{notesText}</Text>
                      </View>
                    ) : null}

                    <View style={styles.closingSection}>
                      {resolvedDocumentType === "invoice" ? (
                        <Text style={styles.closingLine}>
                          {`Bitte überweisen Sie den Gesamtbetrag ${buildInvoicePaymentDueSentence(resolvedPaymentDueDays)} unter Angabe der Rechnungs-Nr. ${quoteNumber}.`}
                        </Text>
                      ) : null}
                      <Text style={styles.closingLine}>Mit freundlichen Grüßen</Text>
                      {closingSignatureName ? (
                        <Text style={styles.closingSignature}>{closingSignatureName}</Text>
                      ) : null}
                    </View>
                  </>
                ) : null}

            <Text style={styles.pageFooter}>{`Seite ${chunkIndex + 1}/${pageCount}`}</Text>
          </Page>
        );
      })}
    </Document>
  );
}
