import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { getDefaultPdfTableColumns, sortPdfTableColumns } from "@/lib/pdf-table-config";
import { CompanySettings, OfferPdfLineItem, OfferText, PdfTableColumnId } from "@/types/offer";

Font.registerHyphenationCallback((word) => [word]);

const theme = {
  canvas: "#ffffff",
  pageTint: "#ffffff",
  card: "#ffffff",
  cardSoft: "#ffffff",
  border: "#d5dde8",
  borderSoft: "#e5e9f0",
  text: "#10203a",
  textMuted: "#435068",
  textSoft: "#6a778f",
  accent: "#3f6fb2",
  accentSoft: "#ffffff",
  accentStrong: "#2b4f85"
};

const styles = StyleSheet.create({
  page: {
    backgroundColor: theme.canvas,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 24,
    fontFamily: "Helvetica",
    fontSize: 9.8,
    color: theme.text
  },
  pageShell: {
    border: `1 solid ${theme.border}`,
    borderRadius: 16,
    backgroundColor: theme.pageTint,
    padding: 16
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12
  },
  brandBlock: {
    width: "69%"
  },
  brandPill: {
    borderRadius: 999,
    border: `1 solid ${theme.border}`,
    backgroundColor: theme.card,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginBottom: 6,
    alignSelf: "flex-start"
  },
  brandPillText: {
    fontSize: 7.5,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: theme.accentStrong
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 2,
    color: theme.text
  },
  logoBlock: {
    width: "29%",
    minHeight: 98,
    justifyContent: "center",
    alignItems: "flex-end"
  },
  logo: {
    width: 102,
    height: 102,
    objectFit: "contain"
  },
  metaPanel: {
    border: `1 solid ${theme.border}`,
    borderRadius: 12,
    backgroundColor: theme.card,
    padding: 10,
    marginBottom: 10
  },
  metaGrid: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  metaCell: {
    width: "32%",
    borderRadius: 8,
    border: `1 solid ${theme.borderSoft}`,
    backgroundColor: theme.cardSoft,
    paddingVertical: 7,
    paddingHorizontal: 8
  },
  metaLabel: {
    fontSize: 7.8,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    color: theme.textSoft,
    marginBottom: 3
  },
  metaValue: {
    fontSize: 10.6,
    fontWeight: 700,
    color: theme.text,
    lineHeight: 1.25
  },
  panelGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10
  },
  panel: {
    width: "49%",
    border: `1 solid ${theme.border}`,
    borderRadius: 12,
    backgroundColor: theme.card,
    padding: 10
  },
  panelHeader: {
    fontSize: 7.8,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    color: theme.textSoft,
    marginBottom: 6
  },
  panelTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: theme.text,
    marginBottom: 4
  },
  panelLine: {
    color: theme.textMuted,
    marginBottom: 2,
    lineHeight: 1.35
  },
  projectPanel: {
    border: `1 solid ${theme.border}`,
    borderRadius: 12,
    backgroundColor: theme.card,
    padding: 10,
    marginBottom: 10
  },
  projectSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8
  },
  projectSummaryCell: {
    width: "33.33%",
    paddingRight: 8,
    marginBottom: 7
  },
  projectSummaryLabel: {
    fontSize: 7.5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: theme.textSoft,
    marginBottom: 2
  },
  projectSummaryValue: {
    fontSize: 9.2,
    color: theme.text,
    lineHeight: 1.3
  },
  projectBody: {
    borderRadius: 8,
    border: `1 solid ${theme.borderSoft}`,
    backgroundColor: theme.accentSoft,
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  projectText: {
    color: theme.textMuted,
    lineHeight: 1.45
  },
  tablePanel: {
    border: `1 solid ${theme.border}`,
    borderRadius: 12,
    backgroundColor: theme.card,
    marginBottom: 10
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: "#f7f9fc",
    borderBottom: `1 solid ${theme.border}`
  },
  tableHeadCell: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 8.3,
    textTransform: "uppercase",
    letterSpacing: 0.45,
    color: theme.textMuted,
    fontWeight: 700,
    lineHeight: 1.25
  },
  tableHeadCellDescription: {
    paddingRight: 14
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: `1 solid ${theme.borderSoft}`
  },
  tableGroupRow: {
    borderBottom: `1 solid ${theme.borderSoft}`,
    backgroundColor: "#f4f6f9"
  },
  tableGroupCell: {
    width: "100%",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 8.2,
    textTransform: "uppercase",
    letterSpacing: 0.45,
    color: theme.textMuted,
    fontWeight: 700
  },
  tableRowAlt: {
    backgroundColor: "#fafbfc"
  },
  tableCell: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: theme.text,
    lineHeight: 1.45,
    fontSize: 9
  },
  tableCellDescription: {
    paddingRight: 14
  },
  tableCellDivider: {
    borderRight: `1 solid ${theme.borderSoft}`
  },
  tableCellNumeric: {
    textAlign: "right"
  },
  totalsBox: {
    margin: 8,
    borderRadius: 10,
    border: `1 solid ${theme.accent}`,
    backgroundColor: theme.card,
    paddingVertical: 7,
    paddingHorizontal: 10
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5
  },
  totalsRowLast: {
    marginBottom: 0
  },
  totalsLabel: {
    fontSize: 9.2,
    color: theme.textMuted
  },
  totalsValue: {
    fontSize: 9.2,
    color: theme.text
  },
  totalsDivider: {
    borderTop: `1 solid ${theme.border}`,
    marginTop: 1,
    marginBottom: 6
  },
  totalsGrandLabel: {
    fontSize: 11,
    color: theme.text,
    fontWeight: 700
  },
  totalsGrandValue: {
    fontSize: 14,
    fontWeight: 700,
    color: theme.accentStrong
  },
  validityText: {
    marginTop: 8,
    fontSize: 8.6,
    color: theme.textMuted
  },
  notePanel: {
    border: `1 solid ${theme.border}`,
    borderRadius: 12,
    backgroundColor: theme.card,
    padding: 10
  },
  noteText: {
    color: theme.textMuted,
    lineHeight: 1.45,
    marginBottom: 7
  },
  noteSubHeader: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: theme.textSoft,
    marginBottom: 4,
    marginTop: 2
  },
  footerHint: {
    marginTop: 10,
    fontSize: 8,
    color: theme.textSoft,
    textAlign: "right"
  }
});

type OfferPdfDocumentProps = {
  offer: OfferText;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  serviceDescription: string;
  lineItems: OfferPdfLineItem[];
  settings: CompanySettings;
};

function isNumericColumn(columnId: PdfTableColumnId): boolean {
  return columnId === "position" || columnId === "quantity" || columnId === "unitPrice" || columnId === "totalPrice";
}

const COLUMN_WEIGHTS: Record<PdfTableColumnId, number> = {
  position: 0.32,
  quantity: 0.68,
  description: 5.05,
  unit: 0.95,
  unitPrice: 1.28,
  totalPrice: 1.42
};

function cellValueForColumn(columnId: PdfTableColumnId, lineItem: OfferPdfLineItem): string {
  const formatMoney = (value: number) =>
    new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);

  switch (columnId) {
    case "position":
      return String(lineItem.position);
    case "quantity":
      return new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(lineItem.quantity);
    case "description":
      return lineItem.description;
    case "unit":
      return lineItem.unit || "-";
    case "unitPrice":
      return `${formatMoney(lineItem.unitPrice)} EUR`;
    case "totalPrice":
      return `${formatMoney(lineItem.totalPrice)} EUR`;
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

function extractAreaFromServiceDescription(text: string): string | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(m²|m2|qm)/i);
  if (!match) {
    return null;
  }

  return `${match[1]} ${match[2].replace(/qm/i, "m²")}`;
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

function buildTableRenderableRows(rows: OfferPdfLineItem[]): TableRenderableRow[] {
  const renderableRows: TableRenderableRow[] = [];
  let currentGroup = "";

  rows.forEach((row) => {
    const rowGroup = row.group?.trim() || "";
    if (rowGroup && rowGroup !== currentGroup) {
      renderableRows.push({
        kind: "group",
        title: rowGroup
      });
      currentGroup = rowGroup;
    }

    if (!rowGroup) {
      currentGroup = "";
    }

    renderableRows.push({
      kind: "item",
      item: row
    });
  });

  return renderableRows;
}

export function OfferPdfDocument({
  offer,
  customerName,
  customerAddress,
  customerEmail,
  serviceDescription,
  lineItems,
  settings
}: OfferPdfDocumentProps) {
  const addressParts = customerAddress.split(",").map((part) => part.trim()).filter(Boolean);
  const customerStreetLine = addressParts[0] || customerAddress;
  const customerPostalCityLine = addressParts[1] || "";
  const generatedAt = new Date();

  const today = generatedAt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const vatRate = clampNumber(settings.vatRate, 0, 100);
  const offerValidityDays = clampNumber(settings.offerValidityDays, 1, 365);
  const validUntilDate = addDays(generatedAt, offerValidityDays).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  const quoteNumber = `ANG-${generatedAt.getFullYear()}-${generatedAt.getTime().toString().slice(-6)}`;
  const phoneText = settings.companyPhone || "-";
  const emailText = settings.companyEmail || "-";
  const webText = settings.companyWebsite || "-";
  const projectSummary = {
    project: serviceDescription.split("\n")[0]?.trim() || "Projekt",
    location: customerAddress || `${customerStreetLine}${customerPostalCityLine ? `, ${customerPostalCityLine}` : ""}`,
    area: extractAreaFromServiceDescription(serviceDescription),
    positions: Math.max(lineItems.length, 1)
  };

  const configuredColumns = sortPdfTableColumns(settings.pdfTableColumns).filter((column) => column.visible);
  const fallbackColumns = sortPdfTableColumns(getDefaultPdfTableColumns()).filter((column) => column.visible);
  const visibleColumns = configuredColumns.length > 0 ? configuredColumns : fallbackColumns;
  const totalColumnWeight = visibleColumns.reduce((sum, column) => sum + COLUMN_WEIGHTS[column.id], 0) || 1;
  const columnWidthById = visibleColumns.reduce(
    (acc, column) => {
      acc[column.id] = `${(COLUMN_WEIGHTS[column.id] / totalColumnWeight) * 100}%`;
      return acc;
    },
    {} as Partial<Record<PdfTableColumnId, string>>
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
            totalPrice: 0
          }
        ];
  const renderableRows = buildTableRenderableRows(tableRows);
  const vatAmount = subtotal * (vatRate / 100);
  const totalAmount = subtotal + vatAmount;
  const termsText = settings.offerTermsText?.trim();

  const formatMoney = (value: number) =>
    new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.pageShell}>
          <View style={styles.titleRow}>
            <View style={styles.brandBlock}>
              <View style={styles.brandPill}>
                <Text style={styles.brandPillText}>Visioro</Text>
              </View>
              <Text style={styles.heading}>Angebot</Text>
            </View>

            <View style={styles.logoBlock}>{settings.logoDataUrl ? <Image src={settings.logoDataUrl} style={styles.logo} /> : null}</View>
          </View>

          <View style={styles.metaPanel}>
            <View style={styles.metaGrid}>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Dokument</Text>
                <Text style={styles.metaValue}>Angebot</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Angebotsnummer</Text>
                <Text style={styles.metaValue}>{quoteNumber}</Text>
              </View>
              <View style={styles.metaCell}>
                <Text style={styles.metaLabel}>Datum</Text>
                <Text style={styles.metaValue}>{today}</Text>
              </View>
            </View>
          </View>

          <View style={styles.panelGrid}>
            <View style={styles.panel}>
              <Text style={styles.panelHeader}>Anbieter</Text>
              <Text style={styles.panelTitle}>{settings.companyName}</Text>
              {settings.ownerName ? <Text style={styles.panelLine}>{settings.ownerName}</Text> : null}
              {settings.companyStreet ? <Text style={styles.panelLine}>{settings.companyStreet}</Text> : null}
              {(settings.companyPostalCode || settings.companyCity) ? (
                <Text style={styles.panelLine}>{`${settings.companyPostalCode} ${settings.companyCity}`.trim()}</Text>
              ) : null}
              <Text style={styles.panelLine}>Tel: {phoneText}</Text>
              <Text style={styles.panelLine}>E-Mail: {emailText}</Text>
              <Text style={styles.panelLine}>Web: {webText}</Text>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelHeader}>Kunde</Text>
              <Text style={styles.panelTitle}>{customerName}</Text>
              <Text style={styles.panelLine}>{customerStreetLine}</Text>
              {customerPostalCityLine ? <Text style={styles.panelLine}>{customerPostalCityLine}</Text> : null}
              <Text style={styles.panelLine}>E-Mail: {customerEmail}</Text>
            </View>
          </View>

          <View style={styles.projectPanel}>
            <Text style={styles.panelHeader}>Projekt-Zusammenfassung</Text>
            <View style={styles.projectSummaryGrid}>
              <View style={styles.projectSummaryCell}>
                <Text style={styles.projectSummaryLabel}>Projekt</Text>
                <Text style={styles.projectSummaryValue}>{projectSummary.project}</Text>
              </View>
              <View style={styles.projectSummaryCell}>
                <Text style={styles.projectSummaryLabel}>Ort</Text>
                <Text style={styles.projectSummaryValue}>{projectSummary.location}</Text>
              </View>
              <View style={styles.projectSummaryCell}>
                <Text style={styles.projectSummaryLabel}>Positionen</Text>
                <Text style={styles.projectSummaryValue}>{projectSummary.positions}</Text>
              </View>
              {projectSummary.area ? (
                <View style={styles.projectSummaryCell}>
                  <Text style={styles.projectSummaryLabel}>Fläche</Text>
                  <Text style={styles.projectSummaryValue}>{projectSummary.area}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.panelHeader}>Leistungsbeschreibung</Text>
            <View style={styles.projectBody}>
              <Text style={styles.projectText}>{serviceDescription}</Text>
            </View>
          </View>

          <View style={styles.tablePanel}>
            <View style={styles.tableHead}>
              {visibleColumns.map((column, columnIndex) => {
                const columnWidth = columnWidthById[column.id] ?? `${100 / visibleColumns.length}%`;
                const headCellStyle: any[] = [styles.tableHeadCell, { width: columnWidth }];
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
                  <Text key={`head-${column.id}`} style={headCellStyle}>
                    {column.label}
                  </Text>
                );
              })}
            </View>

            {renderableRows.map((row, rowIndex) => {
              if (row.kind === "group") {
                return (
                  <View key={`group-${rowIndex}-${row.title}`} style={styles.tableGroupRow} wrap={false}>
                    <Text style={styles.tableGroupCell}>{row.title}</Text>
                  </View>
                );
              }

              const visibleItemRowIndex =
                renderableRows.slice(0, rowIndex + 1).filter((entry) => entry.kind === "item").length - 1;
              const rowStyle =
                visibleItemRowIndex % 2 === 1 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow;

              return (
                <View key={`row-${rowIndex}-${row.item.position}`} style={rowStyle} wrap={false}>
                  {visibleColumns.map((column, columnIndex) => {
                    const columnWidth = columnWidthById[column.id] ?? `${100 / visibleColumns.length}%`;
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
                      <Text key={`row-${rowIndex}-${column.id}`} style={rowCellStyle}>
                        {cellValueForColumn(column.id, row.item)}
                      </Text>
                    );
                  })}
                </View>
              );
            })}

            <View style={styles.totalsBox}>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Zwischensumme</Text>
                <Text style={styles.totalsValue}>{formatMoney(subtotal)} EUR</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{`MwSt. (${vatRate.toFixed(vatRate % 1 === 0 ? 0 : 1)}%)`}</Text>
                <Text style={styles.totalsValue}>{formatMoney(vatAmount)} EUR</Text>
              </View>
              <View style={styles.totalsDivider} />
              <View style={[styles.totalsRow, styles.totalsRowLast]}>
                <Text style={styles.totalsGrandLabel}>Gesamtbetrag</Text>
                <Text style={styles.totalsGrandValue}>{formatMoney(totalAmount)} EUR</Text>
              </View>
            </View>
            <Text style={styles.validityText}>{`Dieses Angebot ist gültig bis: ${validUntilDate}`}</Text>
          </View>

          <View style={styles.notePanel}>
            <Text style={styles.panelHeader}>Hinweis / Bedingungen</Text>
            {termsText ? <Text style={styles.noteText}>{termsText}</Text> : null}
            <Text style={styles.noteSubHeader}>Anschreiben</Text>
            <Text style={styles.noteText}>{offer.intro}</Text>
            <Text style={styles.noteText}>{offer.closing}</Text>
          </View>

          <Text style={styles.footerHint}>Erstellt mit Visioro • Angebote für Handwerker</Text>
        </View>
      </Page>
    </Document>
  );
}
