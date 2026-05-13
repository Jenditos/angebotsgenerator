import { resolveDocumentTax } from "@/lib/document-tax";
import {
  CompanySettings,
  DocumentComplianceIssue,
  DocumentComplianceReport,
  DocumentType,
  OfferPdfLineItem,
} from "@/types/offer";

type BuildDocumentComplianceReportInput = {
  documentType: DocumentType;
  customerType: "person" | "company";
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  serviceDescription: string;
  lineItems: OfferPdfLineItem[];
  settings: CompanySettings;
  documentTax?: Parameters<typeof resolveDocumentTax>[0]["documentTax"];
  invoiceDate?: string;
  serviceDate?: string;
  paymentDueDays?: number;
  checkedAt?: Date;
};

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function hasText(value: string | undefined): boolean {
  return normalizeText(value).length > 0;
}

function isValidDateInput(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false;
  }

  const parsed = new Date(`${value.trim()}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function totalAmount(lineItems: OfferPdfLineItem[]): number {
  return lineItems.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
}

function hasValidLineItem(lineItems: OfferPdfLineItem[]): boolean {
  return lineItems.some(
    (item) =>
      hasText(item.description) &&
      Number.isFinite(item.quantity) &&
      item.quantity > 0 &&
      Number.isFinite(item.unitPrice) &&
      item.unitPrice >= 0 &&
      Number.isFinite(item.totalPrice) &&
      item.totalPrice >= 0,
  );
}

function addIssue(
  issues: DocumentComplianceIssue[],
  issue: DocumentComplianceIssue,
): void {
  issues.push(issue);
}

export function buildDocumentComplianceReport(
  input: BuildDocumentComplianceReportInput,
): DocumentComplianceReport {
  const issues: DocumentComplianceIssue[] = [];
  const documentLabel = input.documentType === "invoice" ? "Rechnung" : "Angebot";
  const companyIdentity =
    normalizeText(input.settings.companyName) ||
    normalizeText(input.settings.ownerName);
  const companyPostalCity = [
    normalizeText(input.settings.companyPostalCode),
    normalizeText(input.settings.companyCity),
  ]
    .filter(Boolean)
    .join(" ");
  const taxIdentity =
    normalizeText(input.settings.taxNumber) || normalizeText(input.settings.vatId);
  const resolvedTax = resolveDocumentTax({
    vatRate: input.settings.vatRate,
    settingsNoticeText: input.settings.euVatNoticeText,
    documentTax: input.documentTax,
  });

  if (!companyIdentity) {
    addIssue(issues, {
      code: "company_identity_missing",
      severity: "error",
      field: "settings.companyName",
      message: "Unternehmensname oder Inhabername fehlt.",
    });
  }

  if (!hasText(input.settings.companyStreet) || !companyPostalCity) {
    addIssue(issues, {
      code: "company_address_missing",
      severity: "error",
      field: "settings.companyAddress",
      message: "Vollstaendige Unternehmensadresse fehlt.",
    });
  }

  if (!hasText(input.settings.companyEmail)) {
    addIssue(issues, {
      code: "company_email_missing",
      severity: "warning",
      field: "settings.companyEmail",
      message: "Firmen-E-Mail fehlt. Das wirkt auf Dokumenten unprofessionell.",
    });
  }

  if (!taxIdentity) {
    addIssue(issues, {
      code: "tax_identity_missing",
      severity: "error",
      field: "settings.taxNumber",
      message: "Steuernummer oder USt-IdNr. fehlt.",
    });
  }

  if (!hasText(input.customerName)) {
    addIssue(issues, {
      code: "customer_name_missing",
      severity: "error",
      field: "customerName",
      message: "Kundenname fehlt.",
    });
  }

  if (!hasText(input.customerAddress)) {
    addIssue(issues, {
      code: "customer_address_missing",
      severity: "error",
      field: "customerAddress",
      message: "Kundenadresse fehlt.",
    });
  }

  if (!hasText(input.customerEmail)) {
    addIssue(issues, {
      code: "customer_email_missing",
      severity: "warning",
      field: "customerEmail",
      message:
        "Kunden-E-Mail fehlt. Versand und Nachverfolgung sind dadurch eingeschraenkt.",
    });
  }

  if (!hasText(input.serviceDescription) && !hasValidLineItem(input.lineItems)) {
    addIssue(issues, {
      code: "service_description_missing",
      severity: "error",
      field: "serviceDescription",
      message:
        "Leistungsbeschreibung oder mindestens eine nachvollziehbare Position fehlt.",
    });
  }

  if (!hasValidLineItem(input.lineItems)) {
    addIssue(issues, {
      code: "line_items_missing",
      severity: "error",
      field: "positions",
      message: "Mindestens eine Position braucht Bezeichnung, Menge und Preis.",
    });
  }

  if (input.documentType === "invoice") {
    if (!isValidDateInput(input.invoiceDate)) {
      addIssue(issues, {
        code: "invoice_date_missing",
        severity: "error",
        field: "invoiceDate",
        message: "Rechnungsdatum fehlt oder ist ungueltig.",
      });
    }

    if (!hasText(input.serviceDate)) {
      addIssue(issues, {
        code: "service_period_missing",
        severity: "error",
        field: "serviceDate",
        message: "Leistungszeitraum fehlt.",
      });
    }

    if (
      typeof input.paymentDueDays !== "number" ||
      !Number.isFinite(input.paymentDueDays) ||
      input.paymentDueDays < 0
    ) {
      addIssue(issues, {
        code: "payment_due_days_invalid",
        severity: "error",
        field: "paymentDueDays",
        message: "Zahlungsziel fehlt oder ist ungueltig.",
      });
    }

    if (input.customerType === "company") {
      const invoiceTotal = totalAmount(input.lineItems);
      addIssue(issues, {
        code: "structured_e_invoice_missing",
        severity: invoiceTotal > 250 ? "warning" : "info",
        field: "eInvoice",
        message:
          invoiceTotal > 250
            ? "B2B-Rechnung: PDF wird gespeichert, eine strukturierte E-Rechnung (z. B. XRechnung/ZUGFeRD) wird noch nicht erzeugt."
            : "Kleinbetrag: PDF wird gespeichert. Strukturierte E-Rechnung kann je nach Fall trotzdem sinnvoll sein.",
      });
    }
  }

  if (
    resolvedTax.treatment === "standard" &&
    resolvedTax.vatRate === 0 &&
    !hasText(input.settings.euVatNoticeText)
  ) {
    addIssue(issues, {
      code: "zero_vat_without_notice",
      severity: "warning",
      field: "settings.vatRate",
      message:
        "MwSt. steht auf 0 %. Bitte pruefen, ob ein Steuerhinweis erforderlich ist.",
    });
  }

  if (
    (resolvedTax.treatment === "reverse_charge" ||
      resolvedTax.treatment === "vat_exempt") &&
    !hasText(resolvedTax.noticeText)
  ) {
    addIssue(issues, {
      code: "tax_notice_missing",
      severity: "warning",
      field: "documentTax",
      message:
        "Steuerliche Sonderregel erkannt, aber der Hinweistext ist nicht eindeutig hinterlegt.",
    });
  }

  const status = issues.some((issue) => issue.severity === "error")
    ? "blocked"
    : issues.some((issue) => issue.severity === "warning")
      ? "warning"
      : "ready";

  if (status === "ready") {
    addIssue(issues, {
      code: "document_basis_ready",
      severity: "info",
      message: `${documentLabel} enthaelt die wichtigsten Basisdaten fuer einen sauberen Dokumentenlauf.`,
    });
  }

  return {
    status,
    checkedAt: (input.checkedAt ?? new Date()).toISOString(),
    issues,
  };
}

export function getBlockingComplianceMessages(
  report: DocumentComplianceReport,
): string[] {
  return report.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message);
}

export function getUserFacingComplianceWarnings(
  report: DocumentComplianceReport,
): string[] {
  return report.issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.message);
}
