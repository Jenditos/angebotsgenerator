import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { CompanySettings, OfferText } from "@/types/offer";

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 34,
    paddingTop: 24,
    paddingBottom: 28,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#17263f",
    backgroundColor: "#ffffff"
  },
  topLine: {
    height: 5,
    backgroundColor: "#3a78f5",
    borderRadius: 999,
    marginBottom: 12
  },
  logoWrap: {
    minHeight: 74,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10
  },
  logo: {
    width: 86,
    height: 86,
    objectFit: "contain"
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12
  },
  senderCard: {
    width: "57%",
    border: "1 solid #d6e2fa",
    backgroundColor: "#f7faff",
    borderRadius: 10,
    padding: 11,
    marginTop: 10
  },
  companyName: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 4
  },
  ownerLine: {
    color: "#2f476f",
    marginBottom: 6
  },
  senderSummary: {
    color: "#3e567d",
    fontSize: 9.3,
    marginBottom: 3
  },
  rightStack: {
    width: "39%"
  },
  infoCard: {
    border: "1 solid #d6e2fa",
    backgroundColor: "#f5f8ff",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8
  },
  infoLabel: {
    fontSize: 8.5,
    color: "#5c7398",
    marginBottom: 2
  },
  infoValue: {
    fontSize: 10.5,
    fontWeight: 700,
    marginBottom: 6,
    color: "#203a62"
  },
  contactCard: {
    border: "1 solid #d6e2fa",
    backgroundColor: "#fbfdff",
    borderRadius: 8,
    padding: 10
  },
  contactLabel: {
    fontSize: 8.5,
    color: "#5c7398",
    marginBottom: 3
  },
  contactValue: {
    fontSize: 10,
    color: "#2e456d",
    marginBottom: 3
  },
  recipientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12
  },
  recipientCard: {
    width: "68%",
    border: "1 solid #d8e4fb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#ffffff"
  },
  recipientContactCard: {
    width: "30%",
    border: "1 solid #d8e4fb",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#fbfdff"
  },
  recipientTitle: {
    color: "#5f7599",
    fontSize: 8.5,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  recipientLine: {
    marginBottom: 3
  },
  recipientContactLabel: {
    color: "#5f7599",
    fontSize: 8.5,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  recipientContactValue: {
    color: "#2f476f"
  },
  sectionCard: {
    border: "1 solid #e0e9fc",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6
  },
  sectionText: {
    color: "#2f4368",
    lineHeight: 1.45
  },
  table: {
    border: "1 solid #dce6fb",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 12
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: "#eef4ff",
    borderBottom: "1 solid #dce6fb",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  thPos: {
    width: "40%",
    fontSize: 9,
    color: "#4d648a",
    textTransform: "uppercase",
    letterSpacing: 0.3
  },
  thQty: {
    width: "16%",
    fontSize: 9,
    color: "#4d648a",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    textAlign: "right"
  },
  thUnit: {
    width: "22%",
    fontSize: 9,
    color: "#4d648a",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    textAlign: "right"
  },
  thTotal: {
    width: "22%",
    fontSize: 9,
    color: "#4d648a",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    textAlign: "right"
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottom: "1 solid #edf2fc"
  },
  rowPos: {
    width: "40%",
    color: "#1d2d47"
  },
  rowQty: {
    width: "16%",
    textAlign: "right",
    color: "#375179"
  },
  rowUnit: {
    width: "22%",
    textAlign: "right",
    color: "#375179"
  },
  rowTotal: {
    width: "22%",
    textAlign: "right",
    color: "#1d2d47",
    fontWeight: 700
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f1f7ff",
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  totalLabel: {
    fontSize: 11,
    color: "#294572",
    fontWeight: 700
  },
  totalValue: {
    fontSize: 14,
    color: "#163769",
    fontWeight: 700
  },
  noteTitle: {
    fontSize: 10.5,
    fontWeight: 700,
    marginBottom: 5
  },
  noteText: {
    lineHeight: 1.46,
    color: "#2f4368",
    marginBottom: 8
  }
});

type OfferPdfDocumentProps = {
  offer: OfferText;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  serviceDescription: string;
  hours: number;
  hourlyRate: number;
  materialCost: number;
  settings: CompanySettings;
};

export function OfferPdfDocument({
  offer,
  customerName,
  customerAddress,
  customerEmail,
  serviceDescription,
  hours,
  hourlyRate,
  materialCost,
  settings
}: OfferPdfDocumentProps) {
  const laborAmount = hours * hourlyRate;
  const totalAmount = laborAmount + materialCost;
  const addressParts = customerAddress.split(",").map((part) => part.trim()).filter(Boolean);
  const customerStreetLine = addressParts[0] || customerAddress;
  const customerPostalCityLine = addressParts[1] || "";

  const today = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  const quoteNumber = `ANG-${new Date().getFullYear()}-${new Date().getTime().toString().slice(-6)}`;
  const phoneText = settings.companyPhone || "-";
  const emailText = settings.companyEmail || "-";
  const webText = settings.companyWebsite || "-";
  const companySummary = [settings.companyName, settings.companyStreet, `${settings.companyPostalCode} ${settings.companyCity}`]
    .map((item) => item.trim())
    .filter(Boolean)
    .join(" - ");
  const contactSummary = [settings.companyPhone, settings.companyEmail, settings.companyWebsite]
    .map((item) => item.trim())
    .filter(Boolean)
    .join(" | ");

  const formatMoney = (value: number) =>
    new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topLine} />
        <View style={styles.logoWrap}>{settings.logoDataUrl ? <Image src={settings.logoDataUrl} style={styles.logo} /> : null}</View>

        <View style={styles.headerRow}>
          <View style={styles.senderCard}>
            <Text style={styles.companyName}>{settings.companyName}</Text>
            <Text style={styles.ownerLine}>{settings.ownerName}</Text>
            {companySummary ? <Text style={styles.senderSummary}>{companySummary}</Text> : null}
            {contactSummary ? <Text style={styles.senderSummary}>Kontakt: {contactSummary}</Text> : null}
          </View>

          <View style={styles.rightStack}>
            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>Dokument</Text>
              <Text style={styles.infoValue}>Angebot</Text>
              <Text style={styles.infoLabel}>Angebotsnummer</Text>
              <Text style={styles.infoValue}>{quoteNumber}</Text>
              <Text style={styles.infoLabel}>Datum</Text>
              <Text style={styles.infoValue}>{today}</Text>
            </View>
            <View style={styles.contactCard}>
              <Text style={styles.contactLabel}>Kontakt</Text>
              <Text style={styles.contactValue}>Tel: {phoneText}</Text>
              <Text style={styles.contactValue}>E-Mail: {emailText}</Text>
              <Text style={styles.contactValue}>Web: {webText}</Text>
            </View>
          </View>
        </View>

        <View style={styles.recipientRow}>
          <View style={styles.recipientCard}>
            <Text style={styles.recipientTitle}>Kunde</Text>
            <Text style={styles.recipientLine}>{customerName}</Text>
            <Text style={styles.recipientLine}>{customerStreetLine}</Text>
            {customerPostalCityLine ? <Text style={styles.recipientLine}>{customerPostalCityLine}</Text> : null}
          </View>
          <View style={styles.recipientContactCard}>
            <Text style={styles.recipientContactLabel}>Kontakt</Text>
            <Text style={styles.recipientContactValue}>E-Mail: {customerEmail}</Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Projekt / Leistung</Text>
          <Text style={styles.sectionText}>{serviceDescription}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={styles.thPos}>Position</Text>
            <Text style={styles.thQty}>Menge</Text>
            <Text style={styles.thUnit}>Einheitspreis</Text>
            <Text style={styles.thTotal}>Betrag</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowPos}>Arbeitszeit</Text>
            <Text style={styles.rowQty}>{hours.toFixed(2)} Std.</Text>
            <Text style={styles.rowUnit}>{formatMoney(hourlyRate)} EUR</Text>
            <Text style={styles.rowTotal}>{formatMoney(laborAmount)} EUR</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowPos}>Material</Text>
            <Text style={styles.rowQty}>1</Text>
            <Text style={styles.rowUnit}>{formatMoney(materialCost)} EUR</Text>
            <Text style={styles.rowTotal}>{formatMoney(materialCost)} EUR</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Gesamtpreis (zzgl. MwSt.)</Text>
            <Text style={styles.totalValue}>{formatMoney(totalAmount)} EUR</Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.noteTitle}>Hinweis zum Angebot</Text>
          <Text style={styles.noteText}>{offer.intro}</Text>
          <Text style={styles.noteText}>{offer.closing}</Text>
        </View>
      </Page>
    </Document>
  );
}
