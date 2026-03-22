import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import { generateOfferText } from "@/lib/openai";
import { OfferPdfDocument } from "@/lib/pdf";
import { readSettings, writeSettings } from "@/lib/settings-store";
import { sendViaConnectedMailbox } from "@/lib/email-sender";
import {
  CustomerDraftGroup,
  CustomerDraftState,
  CustomerDraftSubitem,
  DocumentType,
  GenerateOfferRequest,
  OfferPdfLineItem,
  OfferPositionInput,
} from "@/types/offer";
import { createStoredOfferRecord } from "@/server/services/offer-store-service";
import { upsertStoredCustomer } from "@/server/services/customer-store-service";

const MAX_LOGO_DATA_URL_LENGTH = 2_000_000;

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
    "",
    input.senderName,
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
    "",
    input.senderName,
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateOfferRequest;
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
              error: `Bitte einen gültigen EP / Preis EUR für "${description}" eingeben.`,
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
    const settings = await readSettings();
    const configuredPaymentDueDays = parsePaymentDueDays(
      settings.invoicePaymentDueDays,
    );
    const paymentDueDays =
      documentType === "invoice"
        ? configuredPaymentDueDays
        : requestedPaymentDueDays;
    const selectedServiceEntries = sanitizeSelectedServiceEntries(
      body.selectedServiceEntries,
    );
    const lineItems = buildPdfLineItems({
      positions: body.positions,
      serviceDescription: composedServiceDescription,
      selectedServices,
      hours,
      hourlyRate,
      materialCost,
    });
    const invalidLineItem = findInvalidLineItem(lineItems);
    if (invalidLineItem) {
      return NextResponse.json(
        {
          error: `Bitte einen gültigen EP / Preis EUR für "${invalidLineItem.description || "Position"}" eingeben.`,
        },
        { status: 400 },
      );
    }
    const draftState: CustomerDraftState = {
      serviceDescription,
      hours: String(body.hours ?? "").trim(),
      hourlyRate: String(body.hourlyRate ?? "").trim(),
      materialCost: String(body.materialCost ?? "").trim(),
      invoiceDate: toDateInputValue(resolvedInvoiceDate),
      serviceDate: servicePeriod,
      paymentDueDays: String(paymentDueDays),
      positions:
        selectedServiceEntries.length > 0
          ? selectedServiceEntries
          : buildDraftGroupsFromLineItems(lineItems),
    };
    const storedCustomerRecord = await upsertStoredCustomer({
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
      draftState,
    });
    const safeSettings = {
      ...settings,
      logoDataUrl:
        typeof settings.logoDataUrl === "string" &&
        settings.logoDataUrl.length <= MAX_LOGO_DATA_URL_LENGTH
          ? settings.logoDataUrl
          : "",
    };
    const senderName =
      settings.companyName?.trim() ||
      settings.ownerName?.trim() ||
      "Ihr Handwerksbetrieb";
    const mailText = buildEmailText({
      documentType,
      customerType,
      salutation,
      firstName,
      lastName,
      senderName,
      paymentDueDays,
    });

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
    const storedOfferRecord = await createStoredOfferRecord({
      documentType,
      customerNumber: storedCustomerRecord.customerNumber,
      customerName,
      customerAddress,
      customerEmail,
      serviceDescription: composedServiceDescription,
      lineItems,
      offer,
      configuredLastOfferNumber:
        documentType === "offer" ? settings.lastOfferNumber : undefined,
    });
    const pdfFilename = `${storedOfferRecord.offerNumber}.pdf`;
    if (
      documentType === "offer" &&
      settings.lastOfferNumber !== storedOfferRecord.offerNumber
    ) {
      await writeSettings({
        lastOfferNumber: storedOfferRecord.offerNumber,
      }).catch(() => undefined);
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderToBuffer(
        OfferPdfDocument({
          offer,
          offerNumber: storedOfferRecord.offerNumber,
          documentType,
          customerNumber: storedCustomerRecord.customerNumber,
          createdAt: storedOfferRecord.createdAt,
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
        }),
      );
    } catch {
      pdfBuffer = await renderToBuffer(
        OfferPdfDocument({
          offer,
          offerNumber: storedOfferRecord.offerNumber,
          documentType,
          customerNumber: storedCustomerRecord.customerNumber,
          createdAt: storedOfferRecord.createdAt,
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
          settings: {
            ...safeSettings,
            logoDataUrl: "",
          },
        }),
      );
    }

    const pdfBase64 = pdfBuffer.toString("base64");

    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;
    let emailStatus: EmailStatus = "not_requested";
    let emailInfo = "Es wurde nur ein PDF erstellt.";

    if (sendEmailRequested) {
      const mailboxResult = await sendViaConnectedMailbox({
        to: customerEmail,
        subject: offer.subject,
        text: mailText,
        pdfBase64,
        filename: pdfFilename,
      });

      if (mailboxResult.ok) {
        emailStatus = "sent";
        emailInfo = mailboxResult.info;
      } else if (mailboxResult.reason === "failed") {
        emailStatus = "failed";
        emailInfo = mailboxResult.info;
      } else if (resendApiKey && resendFromEmail) {
        try {
          const resend = new Resend(resendApiKey);
          const recipients = [customerEmail, settings.senderCopyEmail].filter(
            Boolean,
          );

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
      customerNumber: storedCustomerRecord.customerNumber,
      documentType,
      documentNumber: storedOfferRecord.offerNumber,
      offerNumber: storedOfferRecord.offerNumber,
      invoiceNumber:
        documentType === "invoice" ? storedOfferRecord.offerNumber : undefined,
      createdAt: storedOfferRecord.createdAt,
      created_at: storedOfferRecord.created_at,
    });
  } catch (error) {
    console.error("generate-offer failed", error);
    return NextResponse.json(
      { error: "Fehler 500 bei der Angebotserstellung" },
      { status: 500 },
    );
  }
}
