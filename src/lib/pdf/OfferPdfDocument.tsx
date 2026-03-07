import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { OfferText } from "@/lib/openai";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { marginBottom: 32 },
  company: { fontSize: 18, fontWeight: "bold", color: "#059669", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#6b7280" },
  section: { marginBottom: 20 },
  label: { fontSize: 9, color: "#6b7280", textTransform: "uppercase", marginBottom: 4, letterSpacing: 0.8 },
  body: { lineHeight: 1.6, color: "#374151" },
  divider: { borderBottomWidth: 1, borderBottomColor: "#e5e7eb", marginVertical: 20 },
  table: { marginTop: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  rowTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, marginTop: 4 },
  rowLabel: { color: "#6b7280", flex: 1 },
  rowValue: { fontWeight: "bold", textAlign: "right" },
  totalLabel: { fontWeight: "bold", fontSize: 13, flex: 1 },
  totalValue: { fontWeight: "bold", fontSize: 13, color: "#059669", textAlign: "right" },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, fontSize: 9, color: "#9ca3af", textAlign: "center" }
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

export function OfferPdfDocument(props: Props) {
  const { offer, customerName, customerStreet, customerZip, customerCity, hours, hourlyRate, materialCost } = props;
  const laborCost = hours * hourlyRate;
  const net = laborCost + materialCost;
  const vat = net * 0.19;
  const gross = net + vat;
  const today = new Date().toLocaleDateString("de-DE");
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.company}>KI-Angebotsgenerator</Text>
          <Text style={styles.subtitle}>Ihr professionelles Angebot vom {today}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.label}>Angebot fuer</Text>
          <Text style={{ fontWeight: "bold", marginBottom: 2 }}>{customerName}</Text>
          {customerStreet && <Text style={styles.body}>{customerStreet}</Text>}
          {customerZip && customerCity && <Text style={styles.body}>{customerZip} {customerCity}</Text>}
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>Betreff</Text>
          <Text style={{ fontWeight: "bold", fontSize: 13 }}>{offer.subject}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>Anschreiben</Text>
          <Text style={styles.body}>{offer.intro}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>Leistungsbeschreibung</Text>
          <Text style={styles.body}>{offer.details}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.table}>
          <Text style={styles.label}>Kostenuebersicht</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Arbeitszeit ({hours} Std. x {hourlyRate} EUR)</Text>
            <Text style={styles.rowValue}>{laborCost.toFixed(2)} EUR</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Materialkosten</Text>
            <Text style={styles.rowValue}>{materialCost.toFixed(2)} EUR</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Zwischensumme (netto)</Text>
            <Text style={styles.rowValue}>{net.toFixed(2)} EUR</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>MwSt. 19%</Text>
            <Text style={styles.rowValue}>{vat.toFixed(2)} EUR</Text>
          </View>
          <View style={styles.rowTotal}>
            <Text style={styles.totalLabel}>Gesamtbetrag (brutto)</Text>
            <Text style={styles.totalValue}>{gross.toFixed(2)} EUR</Text>
          </View>
        </View>
        <View style={[styles.divider, { marginTop: 24 }]} />
        <View style={styles.section}>
          <Text style={styles.body}>{offer.closing}</Text>
        </View>
        <Text style={styles.footer}>Dieses Angebot wurde mit KI-Unterstuetzung erstellt. Alle Angaben ohne Gewaehr.</Text>
      </Page>
    </Document>
  );
}