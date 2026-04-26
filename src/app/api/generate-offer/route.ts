import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import { randomUUID } from "node:crypto";
import { requireAppAccess } from "@/lib/access/guards";
import {
  MAX_LOGO_DATA_URL_LENGTH,
  sanitizeCompanyLogoDataUrl,
} from "@/lib/logo-config";
import {
  formatIbanForDisplay,
  normalizeBicInput,
  validateIbanInput,
} from "@/lib/iban";
import { generateOfferText } from "@/lib/openai";
import { OfferPdfDocument } from "@/lib/pdf";
import { getDefaultPdfTableColumns } from "@/lib/pdf-table-config";
import {
  createStoredOfferRecord,
} from "@/server/services/offer-store-service";
import { upsertStoredCustomer } from "@/server/services/customer-store-service";
import { resolveRuntimeDataDir } from "@/server/services/store-runtime-paths";
import {
  CompanySettings,
  CustomerDraftGroup,
  CustomerDraftSubitem,
  DocumentType,
  GenerateOfferRequest,
  OfferPdfLineItem,
  OfferPositionInput,
} from "@/types/offer";

const OFFER_DEBUG_LOGS_ENABLED = process.env.OFFER_DEBUG_LOGS === "1";
const FALLBACK_COMPANY_SETTINGS: CompanySettings = {
  companyName: "",
  ownerName: "",
  companyStreet: "",
  companyPostalCode: "",
  companyCity: "",
  companyEmail: "",
  companyPhone: "",
  companyWebsite: "",
  companyIban: "",
  companyBic: "",
  companyBankName: "",
  ibanVerificationStatus: "not_checked",
  taxNumber: "",
  vatId: "",
  companyCountry: "",
  euVatNoticeText: "",
  includeCustomerVatId: false,
  senderCopyEmail: "",
  logoDataUrl: "",
  pdfTableColumns: getDefaultPdfTableColumns(),
  customServices: [],
  vatRate: 19,
  offerValidityDays: 30,
  invoicePaymentDueDays: 14,
  offerTermsText:
    "Dieses Angebot basiert auf den aktuell gültigen Materialpreisen. Änderungen durch unvorhergesehene Baustellenbedingungen bleiben vorbehalten.",
  lastOfferNumber: "",
  lastInvoiceNumber: "",
  customServiceTypes: [],
};

function debugOfferLog(
  requestId: string,
  stage: string,
  payload?: Record<string, unknown>,
) {
  if (!OFFER_DEBUG_LOGS_ENABLED) {
    return;
  }

  if (payload) {
    console.info(`[generate-offer:${requestId}] ${stage}`, payload);
    return;
  }

  console.info(`[generate-offer:${requestId}] ${stage}`);
}

function buildRuntimeDocumentNumber(
  documentType: DocumentType,
  referenceDate: Date,
): string {
  const prefix = documentType === "invoice" ? "RE" : "ANG";
  const year = referenceDate.getFullYear();
  const entropy = `${referenceDate.getTime()}${Math.floor(Math.random() * 1000)}`;
  const sequence = entropy.slice(-6).padStart(6, "0");
  return `${prefix}-${year}-${sequence}`;
}

function buildRuntimeCustomerNumber(referenceDate: Date): string {
  const sequence = String(referenceDate.getTime()).slice(-6).padStart(6, "0");
  return `KDN-${sequence}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function resolveCompanySettings(
  payload: GenerateOfferRequest["settings"],
): CompanySettings {
  if (!isObjectRecord(payload)) {
    return {
      ...FALLBACK_COMPANY_SETTINGS,
      pdfTableColumns: [...FALLBACK_COMPANY_SETTINGS.pdfTableColumns],
      customServices: [...FALLBACK_COMPANY_SETTINGS.customServices],
      customServiceTypes: [...FALLBACK_COMPANY_SETTINGS.customServiceTypes],
    };
  }

  const resolvedCompanyIban =
    typeof payload.companyIban === "string"
      ? formatIbanForDisplay(payload.companyIban)
      : FALLBACK_COMPANY_SETTINGS.companyIban;
  const resolvedIbanValidation = validateIbanInput(resolvedCompanyIban);

  return {
    companyName:
      typeof payload.companyName === "string"
        ? payload.companyName.trim()
        : FALLBACK_COMPANY_SETTINGS.companyName,
    ownerName:
      typeof payload.ownerName === "string"
        ? payload.ownerName.trim()
        : FALLBACK_COMPANY_SETTINGS.ownerName,
    companyStreet:
      typeof payload.companyStreet === "string"
        ? payload.companyStreet.trim()
        : FALLBACK_COMPANY_SETTINGS.companyStreet,
    companyPostalCode:
      typeof payload.companyPostalCode === "string"
        ? payload.companyPostalCode.trim()
        : FALLBACK_COMPANY_SETTINGS.companyPostalCode,
    companyCity:
      typeof payload.companyCity === "string"
        ? payload.companyCity.trim()
        : FALLBACK_COMPANY_SETTINGS.companyCity,
    companyEmail:
      typeof payload.companyEmail === "string"
        ? payload.companyEmail.trim()
        : FALLBACK_COMPANY_SETTINGS.companyEmail,
    companyPhone:
      typeof payload.companyPhone === "string"
        ? payload.companyPhone.trim()
        : FALLBACK_COMPANY_SETTINGS.companyPhone,
    companyWebsite:
      typeof payload.companyWebsite === "string"
        ? payload.companyWebsite.trim()
        : FALLBACK_COMPANY_SETTINGS.companyWebsite,
    companyIban: resolvedCompanyIban,
    companyBic:
      typeof payload.companyBic === "string"
        ? normalizeBicInput(payload.companyBic)
        : FALLBACK_COMPANY_SETTINGS.companyBic,
    companyBankName:
      typeof payload.companyBankName === "string"
        ? payload.companyBankName.trim()
        : FALLBACK_COMPANY_SETTINGS.companyBankName,
    ibanVerificationStatus:
      payload.ibanVerificationStatus === "valid" && resolvedIbanValidation.isValid
        ? "valid"
        : "not_checked",
    taxNumber:
      typeof payload.taxNumber === "string"
        ? payload.taxNumber.trim()
        : FALLBACK_COMPANY_SETTINGS.taxNumber,
    vatId:
      typeof payload.vatId === "string"
        ? payload.vatId.trim()
        : FALLBACK_COMPANY_SETTINGS.vatId,
    companyCountry:
      typeof payload.companyCountry === "string"
        ? payload.companyCountry.trim()
        : FALLBACK_COMPANY_SETTINGS.companyCountry,
    euVatNoticeText:
      typeof payload.euVatNoticeText === "string"
        ? payload.euVatNoticeText.trim()
        : FALLBACK_COMPANY_SETTINGS.euVatNoticeText,
    includeCustomerVatId:
      typeof payload.includeCustomerVatId === "boolean"
        ? payload.includeCustomerVatId
        : FALLBACK_COMPANY_SETTINGS.includeCustomerVatId,
    senderCopyEmail:
      typeof payload.senderCopyEmail === "string"
        ? payload.senderCopyEmail.trim()
        : FALLBACK_COMPANY_SETTINGS.senderCopyEmail,
    logoDataUrl:
      typeof payload.logoDataUrl === "string"
        ? sanitizeCompanyLogoDataUrl(payload.logoDataUrl)
        : FALLBACK_COMPANY_SETTINGS.logoDataUrl,
    pdfTableColumns: Array.isArray(payload.pdfTableColumns)
      ? payload.pdfTableColumns
      : [...FALLBACK_COMPANY_SETTINGS.pdfTableColumns],
    customServices: Array.isArray(payload.customServices)
      ? payload.customServices
      : [...FALLBACK_COMPANY_SETTINGS.customServices],
    vatRate: toNumberInRange(payload.vatRate, FALLBACK_COMPANY_SETTINGS.vatRate, 0, 100),
    offerValidityDays: toNumberInRange(
      payload.offerValidityDays,
      FALLBACK_COMPANY_SETTINGS.offerValidityDays,
      1,
      365,
    ),
    invoicePaymentDueDays: toNumberInRange(
      payload.invoicePaymentDueDays,
      FALLBACK_COMPANY_SETTINGS.invoicePaymentDueDays,
      0,
      365,
    ),
    offerTermsText:
      typeof payload.offerTermsText === "string"
        ? payload.offerTermsText.trim()
        : FALLBACK_COMPANY_SETTINGS.offerTermsText,
    lastOfferNumber:
      typeof payload.lastOfferNumber === "string"
        ? payload.lastOfferNumber.trim()
        : FALLBACK_COMPANY_SETTINGS.lastOfferNumber,
    lastInvoiceNumber:
      typeof payload.lastInvoiceNumber === "string"
        ? payload.lastInvoiceNumber.trim()
        : FALLBACK_COMPANY_SETTINGS.lastInvoiceNumber,
    customServiceTypes: Array.isArray(payload.customServiceTypes)
      ? payload.customServiceTypes
          .map((entry) => String(entry).trim())
          .filter(Boolean)
      : [...FALLBACK_COMPANY_SETTINGS.customServiceTypes],
  };
}

function hasValidThousandsGrouping(
  rawValue: string,
  separator: "," | ".",
): boolean {
  const parts = rawValue.split(separator);
  if (parts.length <= 1) {
    return true;
  }
  if (!parts.every((part) => /^\d+$/.test(part))) {
    return false;
  }
  if (parts[0].length < 1 || parts[0].length > 3) {
    return false;
  }

  return parts.slice(1).every((part) => part.length === 3);
}

function parseLocaleNumberish(rawValue: string): number {
  const normalized = rawValue
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "");
  if (!normalized) {
    return NaN;
  }

  const isNegative = normalized.startsWith("-");
  const unsigned = normalized.replace(/-/g, "");
  if (!unsigned) {
    return NaN;
  }

  const lastCommaIndex = unsigned.lastIndexOf(",");
  const lastDotIndex = unsigned.lastIndexOf(".");
  const decimalIndex = Math.max(lastCommaIndex, lastDotIndex);
  const commaCount = (unsigned.match(/,/g) ?? []).length;
  const dotCount = (unsigned.match(/\./g) ?? []).length;
  let numberLiteral = "";

  if (decimalIndex < 0) {
    numberLiteral = unsigned.replace(/[^\d]/g, "");
  } else {
    const separatorCharacter = unsigned.charAt(decimalIndex);
    const integerPartRaw = unsigned.slice(0, decimalIndex);
    const fractionPartRaw = unsigned.slice(decimalIndex + 1);
    const integerDigits = integerPartRaw.replace(/[^\d]/g, "");
    const fractionDigits = fractionPartRaw.replace(/[^\d]/g, "");
    const hasOtherSeparator =
      separatorCharacter === "," ? dotCount > 0 : commaCount > 0;
    const hasMultipleSameSeparator =
      separatorCharacter === "," ? commaCount > 1 : dotCount > 1;
    const allowThreeDecimalDigits =
      fractionDigits.length === 3 &&
      (integerDigits.length === 0 || /^0+$/.test(integerDigits));
    const treatAsDecimal =
      fractionDigits.length > 0 &&
      (fractionDigits.length <= 2 || allowThreeDecimalDigits) &&
      (hasOtherSeparator || !hasMultipleSameSeparator || allowThreeDecimalDigits);

    if (treatAsDecimal) {
      if (fractionPartRaw.includes(",") || fractionPartRaw.includes(".")) {
        return NaN;
      }
      if (integerPartRaw.includes(separatorCharacter)) {
        return NaN;
      }
      if (hasOtherSeparator) {
        const thousandsSeparator = separatorCharacter === "," ? "." : ",";
        if (
          integerPartRaw.includes(thousandsSeparator) &&
          !hasValidThousandsGrouping(
            integerPartRaw,
            thousandsSeparator as "," | ".",
          )
        ) {
          return NaN;
        }
      }
      numberLiteral = `${integerDigits || "0"}.${fractionDigits}`;
    } else {
      if (hasOtherSeparator) {
        return NaN;
      }
      if (
        !hasValidThousandsGrouping(
          unsigned,
          separatorCharacter as "," | ".",
        )
      ) {
        return NaN;
      }
      numberLiteral = `${integerPartRaw}${fractionPartRaw}`.replace(/[^\d]/g, "");
    }
  }

  if (!numberLiteral) {
    return NaN;
  }

  const parsed = Number(isNegative ? `-${numberLiteral}` : numberLiteral);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toNumber(value: string | number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value !== "string") {
    return NaN;
  }

  const parsed = parseLocaleNumberish(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toNonNegativeNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function resolveDocumentType(value: unknown): DocumentType {
  return value === "invoice" ? "invoice" : "offer";
}

function toDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parsePaymentDueDays(value: number | string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 14;
  }

  const rounded = Math.floor(parsed);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 365) {
    return 365;
  }

  return rounded;
}

function buildPaymentDueText(days: number): string {
  if (days <= 0) {
    return "sofort ohne Abzug";
  }

  return `innerhalb von ${days} Tagen ohne Abzug`;
}

function normalizeInputValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumberishInputValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function sanitizeSelectedServiceEntries(
  entries: GenerateOfferRequest["selectedServiceEntries"],
): CustomerDraftGroup[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const normalizedGroups: CustomerDraftGroup[] = [];

  for (const entry of entries) {
    const label = normalizeInputValue(entry?.label);
    const subitemsSource = Array.isArray(entry?.subitems) ? entry.subitems : [];
    const subitems: CustomerDraftSubitem[] = [];

    for (const subitem of subitemsSource) {
      const description = normalizeInputValue(subitem?.description);
      const quantity = normalizeInputValue(subitem?.quantity);
      const unit = normalizeInputValue(subitem?.unit);
      const price = normalizeInputValue(subitem?.price);

      if (!description && !quantity && !price) {
        continue;
      }

      subitems.push({
        description,
        quantity,
        unit,
        price,
      });
    }

    if (!label && subitems.length === 0) {
      continue;
    }

    normalizedGroups.push({
      label,
      subitems,
    });
  }

  return normalizedGroups;
}

function toDecimalInputValue(value: number): string {
  const asString = Number.isInteger(value) ? String(value) : String(value);
  return asString.replace(".", ",");
}

function buildDraftGroupsFromLineItems(
  lineItems: OfferPdfLineItem[],
): CustomerDraftGroup[] {
  const groups = new Map<string, CustomerDraftGroup>();

  for (const item of lineItems) {
    const groupLabel = normalizeInputValue(item.group) || "Weitere Positionen";
    const description = normalizeInputValue(item.description);
    const quantity =
      Number.isFinite(item.quantity) && item.quantity > 0
        ? toDecimalInputValue(item.quantity)
        : "";
    const price =
      Number.isFinite(item.unitPrice) && item.unitPrice >= 0
        ? toDecimalInputValue(item.unitPrice)
        : "";
    const unit = normalizeInputValue(item.unit) || "Pauschal";

    if (!description && !quantity && !price) {
      continue;
    }

    const group =
      groups.get(groupLabel) ??
      {
        label: groupLabel,
        subitems: [],
      };

    group.subitems.push({
      description,
      quantity,
      unit,
      price,
    });
    groups.set(groupLabel, group);
  }

  return Array.from(groups.values());
}

function buildInvoiceText(input: {
  customerType: "person" | "company";
  salutation: "herr" | "frau";
  firstName: string;
  lastName: string;
  customerName: string;
  paymentDueDays: number;
}): {
  subject: string;
  intro: string;
  details: string;
  closing: string;
} {
  const personName = [input.firstName.trim(), input.lastName.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  const greeting =
    input.customerType === "person" || personName
      ? input.salutation === "frau"
        ? `Sehr geehrte Frau ${personName || input.customerName},`
        : `Sehr geehrter Herr ${personName || input.customerName},`
      : "Sehr geehrte Damen und Herren,";

  return {
    subject: `Rechnung für ${input.customerName || "Kunde"}`,
    intro: [
      greeting,
      "",
      "für die erbrachten Leistungen stellen wir Ihnen hiermit die folgende Rechnung.",
      "Die einzelnen Positionen und Beträge entnehmen Sie bitte der untenstehenden Aufstellung.",
    ].join("\n"),
    details:
      "Die aufgeführten Leistungen wurden gemäß Auftrag ausgeführt. Die Abrechnung erfolgt auf Basis der dokumentierten Positionen.",
    closing: `Bitte begleichen Sie den Gesamtbetrag ${buildPaymentDueText(input.paymentDueDays)} unter Angabe der Rechnungsnummer.`,
  };
}

function normalizePositionInput(
  positions: OfferPositionInput[] | undefined,
): Array<{
  group?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}> {
  if (!Array.isArray(positions)) {
    return [];
  }

  const normalized = positions
    .map((position) => ({
      group: position.group?.trim() || undefined,
      description: position.description?.trim() ?? "",
      quantity: toNonNegativeNumber(toNumber(position.quantity ?? 0)),
      unit: position.unit?.trim() || "",
      unitPrice: toNonNegativeNumber(toNumber(position.unitPrice ?? 0)),
    }))
    .filter(
      (position) =>
        Boolean(position.description) ||
        position.quantity > 0 ||
        position.unitPrice > 0 ||
        Boolean(position.unit),
    );

  return normalized;
}

function parseGroupedServiceEntry(value: string): {
  group?: string;
  description: string;
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { description: "" };
  }

  const separators = ["::", " > ", "|"];
  for (const separator of separators) {
    const parts = trimmed
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return {
        group: parts[0],
        description: parts.slice(1).join(" - "),
      };
    }
  }

  return { description: trimmed };
}

function normalizeSelectedServices(
  selectedServices: string[] | undefined,
): string[] {
  if (!Array.isArray(selectedServices)) {
    return [];
  }

  const unique = new Set<string>();
  const normalized: string[] = [];

  for (const rawValue of selectedServices) {
    if (typeof rawValue !== "string") {
      continue;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (unique.has(key)) {
      continue;
    }

    unique.add(key);
    normalized.push(trimmed);

    if (normalized.length >= 50) {
      break;
    }
  }

  return normalized;
}

function composeServiceDescription(
  selectedServices: string[],
  freeText: string,
): string {
  const serviceListText =
    selectedServices.length > 0
      ? selectedServices
          .map(
            (service) =>
              parseGroupedServiceEntry(service).description || service,
          )
          .filter(Boolean)
          .join(", ")
      : "";
  const detailText = freeText.trim();

  if (serviceListText && detailText) {
    return `${serviceListText}\n\nDetails: ${detailText}`;
  }

  return serviceListText || detailText;
}

function buildPdfLineItems(input: {
  positions?: OfferPositionInput[];
  serviceDescription: string;
  selectedServices: string[];
  hours: number;
  hourlyRate: number;
  materialCost: number;
}): OfferPdfLineItem[] {
  const explicitPositions = normalizePositionInput(input.positions);
  if (explicitPositions.length > 0) {
    return explicitPositions.map((position, index) => ({
      position: index + 1,
      group: position.group,
      quantity: position.quantity,
      description: position.description || `Position ${index + 1}`,
      unit: position.unit,
      unitPrice: position.unitPrice,
      totalPrice: position.quantity * position.unitPrice,
    }));
  }

  const fallbackItems: OfferPdfLineItem[] = [];
  if (input.selectedServices.length > 0) {
    input.selectedServices.forEach((service, index) => {
      const parsedService = parseGroupedServiceEntry(service);
      fallbackItems.push({
        position: index + 1,
        group: parsedService.group,
        quantity: 1,
        description: parsedService.description || service,
        unit: "Psch.",
        unitPrice: 0,
        totalPrice: 0,
      });
    });
  }

  if (input.hours > 0 || input.hourlyRate > 0) {
    const quantity = input.hours > 0 ? input.hours : 1;
    fallbackItems.push({
      position: fallbackItems.length + 1,
      quantity,
      description:
        input.selectedServices.length > 0
          ? "Arbeitszeit"
          : input.serviceDescription || "Arbeitsleistung",
      unit: "Std.",
      unitPrice: input.hourlyRate,
      totalPrice: quantity * input.hourlyRate,
    });
  }

  if (input.materialCost > 0) {
    fallbackItems.push({
      position: fallbackItems.length + 1,
      quantity: 1,
      description: "Material",
      unit: "Psch.",
      unitPrice: input.materialCost,
      totalPrice: input.materialCost,
    });
  }

  if (fallbackItems.length === 0) {
    fallbackItems.push({
      position: 1,
      quantity: 1,
      description:
        input.serviceDescription || input.selectedServices[0] || "Leistung",
      unit: "Psch.",
      unitPrice: 0,
      totalPrice: 0,
    });
  }

  return fallbackItems;
}

function findInvalidLineItem(
  lineItems: OfferPdfLineItem[],
): OfferPdfLineItem | undefined {
  return lineItems.find(
    (lineItem) =>
      !Number.isFinite(lineItem.quantity) ||
      !Number.isFinite(lineItem.unitPrice) ||
      !Number.isFinite(lineItem.totalPrice) ||
      lineItem.quantity < 0 ||
      lineItem.unitPrice < 0 ||
      lineItem.totalPrice < 0,
  );
}

type EmailStatus = "not_requested" | "sent" | "not_configured" | "failed";

function buildEmailText(input: {
  documentType: DocumentType;
  customerType: "person" | "company";
  salutation: "herr" | "frau";
  firstName: string;
  lastName: string;
  senderName: string;
  paymentDueDays: number;
}): string {
  const personName = [input.firstName.trim(), input.lastName.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  let greeting = "Sehr geehrte Damen und Herren,";
  if (input.customerType === "person") {
    greeting =
      input.salutation === "frau"
        ? `Sehr geehrte Frau ${personName},`
        : `Sehr geehrter Herr ${personName},`;
  } else if (personName) {
    greeting =
      input.salutation === "frau"
        ? `Sehr geehrte Frau ${personName},`
        : `Sehr geehrter Herr ${personName},`;
  }

  const signatureLines = input.senderName.trim()
    ? ["", input.senderName.trim()]
    : [];
  const offerLines = [
    greeting,
    "",
    "vielen Dank für Ihre Anfrage.",
    "",
    "Anbei erhalten Sie unser Angebot.",
    "Bitte entnehmen Sie alle Details dem beigefügten Angebot im Anhang.",
    "",
    "Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.",
    "",
    "Mit freundlichen Grüßen",
    ...signatureLines,
  ];
  const invoiceLines = [
    greeting,
    "",
    "Anbei erhalten Sie unsere Rechnung.",
    `Bitte begleichen Sie den Rechnungsbetrag ${buildPaymentDueText(input.paymentDueDays)}.`,
    "",
    "Für Rückfragen stehen wir Ihnen gerne zur Verfügung.",
    "",
    "Mit freundlichen Grüßen",
    ...signatureLines,
  ];

  return (input.documentType === "invoice" ? invoiceLines : offerLines).join(
    "\n",
  );
}

function adaptTextForDocumentType(
  input: {
    text: {
      subject: string;
      intro: string;
      details: string;
      closing: string;
    };
    documentType: DocumentType;
    customerName: string;
  },
) {
  if (input.documentType === "offer") {
    return input.text;
  }

  const fallbackSubject = `Rechnung für ${input.customerName || "Kunde"}`;
  const nextSubject = (input.text.subject || "").trim() || fallbackSubject;

  return {
    ...input.text,
    subject: nextSubject,
  };
}

export async function handleGenerateOfferAuthorizedRequest(request: Request) {
  const requestId = randomUUID();
  let failureStage = "init";

  try {
    failureStage = "parse_request_body";
    let body: GenerateOfferRequest;
    try {
      body = (await request.json()) as GenerateOfferRequest;
    } catch (error) {
      console.error(
        `[generate-offer:${requestId}] invalid-json`,
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : { error },
      );
      return NextResponse.json(
        { error: "Ungültige Anfrage. Bitte Eingaben prüfen.", requestId },
        { status: 400 },
      );
    }

    debugOfferLog(requestId, "request_received", {
      documentType: body.documentType,
      customerType: body.customerType,
      hasPositions: Array.isArray(body.positions),
      positionsCount: Array.isArray(body.positions) ? body.positions.length : 0,
      selectedServicesCount: Array.isArray(body.selectedServices)
        ? body.selectedServices.length
        : 0,
      selectedServiceEntriesCount: Array.isArray(body.selectedServiceEntries)
        ? body.selectedServiceEntries.length
        : 0,
      hasServiceDescription:
        typeof body.serviceDescription === "string" &&
        body.serviceDescription.trim().length > 0,
    });

    const documentType = resolveDocumentType(body.documentType);

    const customerType = body.customerType === "company" ? "company" : "person";
    const companyName = body.companyName?.trim() ?? "";
    const salutation = body.salutation === "frau" ? "frau" : "herr";
    const firstName = body.firstName?.trim() ?? "";
    const lastName = body.lastName?.trim() ?? "";
    const street = body.street?.trim() ?? "";
    const postalCode = body.postalCode?.trim() ?? "";
    const city = body.city?.trim() ?? "";
    const customerEmail = body.customerEmail?.trim() ?? "";
    const serviceDescription = body.serviceDescription?.trim() ?? "";
    const selectedServices = normalizeSelectedServices(body.selectedServices);
    const composedServiceDescription = composeServiceDescription(
      selectedServices,
      serviceDescription,
    );
    const sendEmailRequested = Boolean(body.sendEmail);
    const requestedPaymentDueDays = parsePaymentDueDays(body.paymentDueDays);
    const resolvedInvoiceDate =
      parseDateInput(typeof body.invoiceDate === "string" ? body.invoiceDate : "") ??
      new Date();
    const servicePeriod = normalizeInputValue(body.serviceDate);

    const hours = toNonNegativeNumber(toNumber(body.hours));
    const hourlyRate = toNonNegativeNumber(toNumber(body.hourlyRate));
    const materialCost = toNonNegativeNumber(toNumber(body.materialCost));
    debugOfferLog(requestId, "normalized_numeric_fields", {
      hoursInput: normalizeNumberishInputValue(body.hours),
      hourlyRateInput: normalizeNumberishInputValue(body.hourlyRate),
      materialCostInput: normalizeNumberishInputValue(body.materialCost),
      hours,
      hourlyRate,
      materialCost,
    });

    if (
      !street ||
      !postalCode ||
      !city ||
      !customerEmail ||
      !composedServiceDescription
    ) {
      return NextResponse.json(
        { error: "Bitte alle Pflichtfelder ausfüllen." },
        { status: 400 },
      );
    }

    if (customerType === "person" && (!firstName || !lastName)) {
      return NextResponse.json(
        { error: "Für Privatpersonen bitte Vor- und Nachname ausfüllen." },
        { status: 400 },
      );
    }

    if (customerType === "company" && !companyName) {
      return NextResponse.json(
        { error: "Für Firmenangebote bitte einen Firmennamen eintragen." },
        { status: 400 },
      );
    }

    if (Array.isArray(body.positions)) {
      const normalizedPositionsPreview = body.positions.map((position, index) => {
        const quantityRaw = normalizeNumberishInputValue(position?.quantity);
        const unitPriceRaw = normalizeNumberishInputValue(position?.unitPrice);
        const quantityParsed = quantityRaw ? toNumber(quantityRaw) : null;
        const unitPriceParsed = unitPriceRaw ? toNumber(unitPriceRaw) : null;

        return {
          index,
          description: normalizeInputValue(position?.description),
          quantityRaw,
          unitPriceRaw,
          quantityParsed,
          unitPriceParsed,
        };
      });
      debugOfferLog(requestId, "positions_before_validation", {
        positions: normalizedPositionsPreview,
      });

      for (const position of body.positions) {
        const description = normalizeInputValue(position?.description) || "Position";
        const quantityRaw = normalizeNumberishInputValue(position?.quantity);
        const unitPriceRaw = normalizeNumberishInputValue(position?.unitPrice);

        if (quantityRaw && !Number.isFinite(toNumber(quantityRaw))) {
          return NextResponse.json(
            {
              error: `Bitte eine gültige Menge für "${description}" eingeben.`,
            },
            { status: 400 },
          );
        }

        if (unitPriceRaw && !Number.isFinite(toNumber(unitPriceRaw))) {
          return NextResponse.json(
            {
              error: `Bitte einen gültigen Einzelpreis / Preis EUR für "${description}" eingeben.`,
            },
            { status: 400 },
          );
        }
      }
    }

    const personName = [firstName, lastName].filter(Boolean).join(" ").trim();
    const customerName =
      customerType === "company"
        ? personName
          ? `${companyName} (z. Hd. ${salutation === "frau" ? "Frau" : "Herr"} ${personName})`
          : companyName
        : personName;
    const customerAddress = `${street}, ${postalCode} ${city}`;
    const settings = resolveCompanySettings(body.settings);
    const ibanValidation = validateIbanInput(settings.companyIban);
    if (!ibanValidation.isValid) {
      return NextResponse.json(
        {
          error:
            "Bitte hinterlegen Sie in den Einstellungen eine gültige IBAN, bevor Dokumente erstellt werden.",
        },
        { status: 400 },
      );
    }
    const validatedSettings: CompanySettings = {
      ...settings,
      companyIban: ibanValidation.formatted,
      ibanVerificationStatus: "valid",
    };
    const paymentDueDays =
      documentType === "invoice"
        ? parsePaymentDueDays(validatedSettings.invoicePaymentDueDays)
        : requestedPaymentDueDays;
    const now = new Date();
    const generatedCreatedAt = now.toISOString();
    let generatedDocumentNumber = buildRuntimeDocumentNumber(
      documentType,
      now,
    );
    const requestedCustomerNumber = normalizeInputValue(body.customerNumber);
    let customerNumberForDocument =
      requestedCustomerNumber || buildRuntimeCustomerNumber(now);
    failureStage = "build_line_items";
    const lineItems = buildPdfLineItems({
      positions: body.positions,
      serviceDescription: composedServiceDescription,
      selectedServices,
      hours,
      hourlyRate,
      materialCost,
    });
    debugOfferLog(requestId, "line_items_built", {
      lineItemsCount: lineItems.length,
      lineItemsPreview: lineItems.map((lineItem) => ({
        position: lineItem.position,
        description: lineItem.description,
        quantity: lineItem.quantity,
        unitPrice: lineItem.unitPrice,
        totalPrice: lineItem.totalPrice,
      })),
    });

    const invalidLineItem = findInvalidLineItem(lineItems);
    if (invalidLineItem) {
      return NextResponse.json(
        {
          error: `Bitte einen gültigen Einzelpreis / Preis EUR für "${invalidLineItem.description || "Position"}" eingeben.`,
        },
        { status: 400 },
      );
    }
    const safeSettings = {
      ...validatedSettings,
      logoDataUrl:
        typeof validatedSettings.logoDataUrl === "string" &&
        validatedSettings.logoDataUrl.length <= MAX_LOGO_DATA_URL_LENGTH
          ? validatedSettings.logoDataUrl
          : "",
    };
    const senderName =
      validatedSettings.companyName?.trim() ||
      validatedSettings.ownerName?.trim() ||
      "";
    const mailText = buildEmailText({
      documentType,
      customerType,
      salutation,
      firstName,
      lastName,
      senderName,
      paymentDueDays,
    });

    failureStage = "generate_offer_text";
    const generatedText =
      documentType === "invoice"
        ? buildInvoiceText({
            customerType,
            salutation,
            firstName,
            lastName,
            customerName,
            paymentDueDays,
          })
        : await generateOfferText({
            customerName,
            customerAddress,
            serviceDescription: composedServiceDescription,
            hours,
            hourlyRate,
            materialCost,
          });
    const offer = adaptTextForDocumentType({
      text: generatedText,
      documentType,
      customerName,
    });
    const selectedServiceDraftGroups = sanitizeSelectedServiceEntries(
      body.selectedServiceEntries,
    );
    const fallbackDraftGroups = buildDraftGroupsFromLineItems(lineItems);
    const draftGroups =
      selectedServiceDraftGroups.length > 0
        ? selectedServiceDraftGroups
        : fallbackDraftGroups;

    failureStage = "persist_customer";
    try {
      const storedCustomer = await upsertStoredCustomer({
        customerType,
        companyName,
        salutation,
        firstName,
        lastName,
        street,
        postalCode,
        city,
        customerEmail,
        customerName,
        customerAddress,
        draftState: {
          serviceDescription: composedServiceDescription,
          hours: toDecimalInputValue(hours),
          hourlyRate: toDecimalInputValue(hourlyRate),
          materialCost: toDecimalInputValue(materialCost),
          invoiceDate: toDateInputValue(resolvedInvoiceDate),
          serviceDate: servicePeriod,
          paymentDueDays: String(paymentDueDays),
          positions: draftGroups,
        },
        referenceDate: now,
      });
      customerNumberForDocument = storedCustomer.customerNumber;
    } catch (error) {
      console.error(
        `[generate-offer:${requestId}] customer_upsert_failed`,
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              runtimeDataDir: resolveRuntimeDataDir(),
            }
          : { error, runtimeDataDir: resolveRuntimeDataDir() },
      );
      return NextResponse.json(
        {
          error:
            "Kunde konnte nicht gespeichert werden. Bitte erneut versuchen.",
          requestId,
        },
        { status: 500 },
      );
    }

    try {
      const storedDocument = await createStoredOfferRecord({
        documentType,
        customerNumber: customerNumberForDocument,
        customerName,
        customerAddress,
        customerEmail,
        serviceDescription: composedServiceDescription,
        lineItems,
        offer,
        configuredLastOfferNumber: validatedSettings.lastOfferNumber,
        configuredLastInvoiceNumber: validatedSettings.lastInvoiceNumber,
        referenceDate: now,
      });
      generatedDocumentNumber = storedDocument.offerNumber;
    } catch (error) {
      console.warn(
        `[generate-offer:${requestId}] offer_record_persist_failed`,
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { error },
      );
    }

    const pdfFilename = `${generatedDocumentNumber}.pdf`;
    debugOfferLog(requestId, "pdf_payload_preview", {
      documentType,
      documentNumber: generatedDocumentNumber,
      customerNumber: customerNumberForDocument,
      customerName,
      customerAddress,
      customerEmail,
      serviceDescription: composedServiceDescription,
      projectDetails: serviceDescription,
      lineItems,
      settings: {
        companyName: validatedSettings.companyName,
        ownerName: validatedSettings.ownerName,
        companyStreet: validatedSettings.companyStreet,
        companyPostalCode: validatedSettings.companyPostalCode,
        companyCity: validatedSettings.companyCity,
        companyEmail: validatedSettings.companyEmail,
        companyPhone: validatedSettings.companyPhone,
        companyWebsite: validatedSettings.companyWebsite,
        companyIbanPresent: Boolean(validatedSettings.companyIban),
        companyIbanLast4: validatedSettings.companyIban
          .replace(/\s+/g, "")
          .slice(-4),
        companyBicPresent: Boolean(validatedSettings.companyBic),
        companyBankNamePresent: Boolean(validatedSettings.companyBankName),
        ibanVerificationStatus: validatedSettings.ibanVerificationStatus,
        senderCopyEmail: validatedSettings.senderCopyEmail,
        logoDataUrlPresent: Boolean(validatedSettings.logoDataUrl),
        pdfTableColumnsCount: validatedSettings.pdfTableColumns.length,
        vatRate: validatedSettings.vatRate,
        offerValidityDays: validatedSettings.offerValidityDays,
        invoicePaymentDueDays: validatedSettings.invoicePaymentDueDays,
        offerTermsTextLength: validatedSettings.offerTermsText.length,
      },
    });

    failureStage = "render_pdf";
    let pdfBuffer: Buffer;
    const pdfDocumentProps = {
      offer,
      offerNumber: generatedDocumentNumber,
      documentType,
      customerNumber: customerNumberForDocument,
      createdAt: generatedCreatedAt,
      invoiceDate:
        documentType === "invoice"
          ? toDateInputValue(resolvedInvoiceDate)
          : undefined,
      serviceDate:
        documentType === "invoice"
          ? servicePeriod
          : undefined,
      paymentDueDays: documentType === "invoice" ? paymentDueDays : undefined,
      customerName,
      customerAddress,
      customerEmail,
      serviceDescription: composedServiceDescription,
      projectDetails: serviceDescription,
      lineItems,
      settings: safeSettings,
    };
    try {
      debugOfferLog(requestId, "pdf_render_start", {
        documentType,
        documentNumber: generatedDocumentNumber,
        customerNumber: customerNumberForDocument,
        lineItemsCount: lineItems.length,
        hasLogoDataUrl: Boolean(safeSettings.logoDataUrl),
      });
      pdfBuffer = await renderToBuffer(OfferPdfDocument(pdfDocumentProps));
    } catch {
      debugOfferLog(requestId, "pdf_render_retry_without_logo");
      pdfBuffer = await renderToBuffer(
        OfferPdfDocument({
          ...pdfDocumentProps,
          settings: {
            ...safeSettings,
            logoDataUrl: "",
          },
        }),
      );
    }

    debugOfferLog(requestId, "pdf_render_success", {
      byteLength: pdfBuffer.byteLength,
    });

    const pdfBase64 = pdfBuffer.toString("base64");

    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;
    let emailStatus: EmailStatus = "not_requested";
    let emailInfo = "Es wurde nur ein PDF erstellt.";

    if (sendEmailRequested) {
      if (resendApiKey && resendFromEmail) {
        try {
          const resend = new Resend(resendApiKey);
          const recipients = [customerEmail];

          await resend.emails.send({
            from: resendFromEmail,
            to: recipients,
            subject: offer.subject,
            text: mailText,
            attachments: [
              {
                filename: pdfFilename,
                content: pdfBase64,
              },
            ],
          });

          emailStatus = "sent";
          emailInfo = `E-Mail über Resend an ${customerEmail} gesendet.`;
        } catch {
          emailStatus = "failed";
          emailInfo =
            "Versand fehlgeschlagen. Bitte OAuth-Verbindung oder Resend-Konfiguration prüfen.";
        }
      } else {
        emailStatus = "not_configured";
        emailInfo =
          "Kein verbundenes Postfach und keine Resend-Konfiguration gefunden.";
      }
    }

    return NextResponse.json({
      offer,
      mailText,
      pdfBase64,
      emailStatus,
      emailInfo,
      customerNumber: customerNumberForDocument,
      documentType,
      documentNumber: generatedDocumentNumber,
      offerNumber: generatedDocumentNumber,
      invoiceNumber:
        documentType === "invoice" ? generatedDocumentNumber : undefined,
      createdAt: generatedCreatedAt,
      created_at: generatedCreatedAt,
    });
  } catch (error) {
    console.error(
      `[generate-offer:${requestId}] failed`,
      error instanceof Error
        ? {
            stage: failureStage,
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : {
            stage: failureStage,
            error,
          },
    );
    return NextResponse.json(
      { error: "Angebot konnte nicht erstellt werden.", requestId },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  return handleGenerateOfferAuthorizedRequest(request);
}
