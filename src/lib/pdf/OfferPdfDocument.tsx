import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OfferText } from "../openai";

const styles = StyleSheet.create({
  page: { padding: 50, fontFamily: "Helvetica", fontSize: 11, color: "#1a1a1a", lineHeight: 1.5 },
  header: { marginBottom: 30 },
  companyName: { fontSize: 18, fontWeight: "bold", color: "#1a1a1a" },
  companySubtitle: { fontSize: 10, color: "#666", marginTop: 2 },
  section: { marginBottom: 16 },
  label: { fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 },
  value: { fontSize: 11, color: "#1a1a1a" },
  divider: { borderBottom: "1 solid #e5e7eb", marginVertical: 16 },
  tableHeader: { flexDirection: "row", backgroundColor: "#f9fafb", padding: "8 12", borderRadius: 4, marginBottom: 4 },
  tableRow: { flexDirection: "row", padding: "6 12" },
  tableCell: { flex: 1, fontSize: 10 },
  tableCellRight: { flex: 1, fontSize: 10, textAlign: "right" },
  totalBox: { backgroundColor: "#f0fdf4", padding: "10 12", borderRadius: 4, flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  totalLabel: { fontSize: 12, fontWeight: "bold", color: "#166534" },
  totalValue: { fontSize: 14, fontWeight: "bold", color: "#166534" },
  footer: { position: "absolute", bottom: 30, left: 50, right: 50, borderTop: "1 solid #e5e7eb", paddingTop: 10, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 8, color: "#9ca3af" }
});

type Props = {
  offer: OfferText;
  customerName: string;
  customerStreet?: string;
  customerZip?: string;
  customerCity?: string;
  hours: number;
  hourlyRate: number;
  materialCost: number;
};

export function OfferPdfDocument({ offer, customerName, customerStreet, customerZip, customerCity, hours, hourlyRate, materialCost }: Props) {
  const laborCost = hours * hourlyRate;
  const subtotal = laborCost + materialCost;
  const tax = subtotal * 0.19;
  const total = subtotal + tax;
  const offerNumber = "ANG-" + Date.now().toString().slice(-6);
  const today = new Date().toLocaleDateString("de-DE");
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.companyName}>Angebot</Text>
          <Text style={styles.companySubtitle}>Professioneller Handwerksbetrieb</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 24 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>An</Text>
            <Text style={styles.value}>{customerName}</Text>
            {customerStreet && <Text style={{ fontSize: 10, color: "#555" }}>{customerStreet}</Text>}
            {(customerZip || customerCity) && <Text style={{ fontSize: 10, color: "#555" }}>{customerZip} {customerCity}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.label}>Angebotsnummer</Text>
            <Text style={styles.value}>{offerNumber}</Text>
            <Text style={{ fontSize: 9, color: "#888", marginTop: 4 }}>Datum: {today}</Text>
            <Text style={{ fontSize: 9, color: "#888" }}>Gueltig 30 Tage</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.label}>Betreff</Text>
          <Text style={{ ...styles.value, fontWeight: "bold" }}>{offer.subject}</Text>
        </View>
        <View style={styles.section}>
          <Text style={{ fontSize: 11, color: "#374151", lineHeight: 1.6 }}>{offer.intro}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <View style={styles.tableHeader}>
            <Text style={{ ...styles.tableCell, fontWeight: "bold", fontSize: 9 }}>POSITION</Text>
            <Text style={{ ...styles.tableCell, fontWeight: "bold", fontSize: 9, textAlign: "right" }}>MENGE</Text>
            <Text style={{ ...styles.tableCell, fontWeight: "bold", fontSize: 9, textAlign: "right" }}>EINZELPREIS</Text>
            <Text style={{ ...styles.tableCellRight, fontWeight: "bold", fontSize: 9 }}>GESAMT</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCell}>Arbeitsleistung</Text>
            <Text style={{ ...styles.tableCell, textAlign: "right" }}>{hours} Std.</Text>
            <Text style={{ ...styles.tableCell, textAlign: "right" }}>{hourlyRate.toFixed(2)} EUR</Text>
            <Text style={styles.tableCellRight}>{laborCost.toFixed(2)} EUR</Text>
          </View>
          {materialCost > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.tableCell}>Materialkosten</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>1 Pauschal</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>{materialCost.toFixed(2)} EUR</Text>
              <Text style={styles.tableCellRight}>{materialCost.toFixed(2)} EUR</Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 4 }}>
            <Text style={{ fontSize: 10, color: "#555", marginRight: 40 }}>Zwischensumme:</Text>
            <Text style={{ fontSize: 10 }}>{subtotal.toFixed(2)} EUR</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 }}>
            <Text style={{ fontSize: 10, color: "#555", marginRight: 40 }}>MwSt. 19%:</Text>
            <Text style={{ fontSize: 10 }}>{tax.toFixed(2)} EUR</Text>
          </View>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Gesamtbetrag</Text>
            <Text style={styles.totalValue}>{total.toFixed(2)} EUR</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={{ fontSize: 11, color: "#374151", lineHeight: 1.6 }}>{offer.details}</Text>
        </View>
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 11, color: "#374151", lineHeight: 1.6 }}>{offer.closing}</Text>
        </View>
        <View style={styles.footer}>
          <Text style={styles.footerText}>Dieses Angebot wurde mit KI-Unterstutzung erstellt.</Text>
          <Text style={styles.footerText}>{today}</Text>
        </View>
      </Page>
    </Document>
  );
}