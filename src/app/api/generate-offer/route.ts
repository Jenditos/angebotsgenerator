import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import { generateOfferText } from "@/lib/openai";
import { OfferPdfDocument } from "@/lib/pdf";
import { readSettings } from "@/lib/settings-store";
import { sendViaConnectedMailbox } from "@/lib/email-sender";
import { GenerateOfferRequest, OfferPdfLineItem, OfferPositionInput } from "@/types/offer";

const MAX_LOGO_DATA_URL_LENGTH = 2_000_000;

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toNonNegativeNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizePositionInput(
  positions: OfferPositionInput[] | undefined
): Array<{ group?: string; description: string; quantity: number; unit: string; unitPrice: number }> {
  if (!Array.isArray(positions)) {
    return [];
  }

  const normalized = positions
    .map((position) => ({
      group: position.group?.trim() || undefined,
      description: position.description?.trim() ?? "",
      quantity: toNonNegativeNumber(toNumber(position.quantity ?? 0)),
      unit: position.unit?.trim() || "",
      unitPrice: toNonNegativeNumber(toNumber(position.unitPrice ?? 0))
    }))
    .filter(
      (position) =>
        Boolean(position.description) || position.quantity > 0 || position.unitPrice > 0 || Boolean(position.unit)
    );

  return normalized;
}

function parseGroupedServiceEntry(value: string): { group?: string; description: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { description: "" };
  }

  const separators = ["::", " > ", "|"];
  for (const separator of separators) {
    const parts = trimmed.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        group: parts[0],
        description: parts.slice(1).join(" - ")
      };
    }
  }

  return { description: trimmed };
}

function normalizeSelectedServices(selectedServices: string[] | undefined): string[] {
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

function composeServiceDescription(selectedServices: string[], freeText: string): string {
  const serviceListText =
    selectedServices.length > 0
      ? selectedServices
          .map((service) => parseGroupedServiceEntry(service).description || service)
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
      totalPrice: position.quantity * position.unitPrice
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
        totalPrice: 0
      });
    });
  }

  if (input.hours > 0 || input.hourlyRate > 0) {
    const quantity = input.hours > 0 ? input.hours : 1;
    fallbackItems.push({
      position: fallbackItems.length + 1,
      quantity,
      description: input.selectedServices.length > 0 ? "Arbeitszeit" : input.serviceDescription || "Arbeitsleistung",
      unit: "Std.",
      unitPrice: input.hourlyRate,
      totalPrice: quantity * input.hourlyRate
    });
  }

  if (input.materialCost > 0) {
    fallbackItems.push({
      position: fallbackItems.length + 1,
      quantity: 1,
      description: "Material",
      unit: "Psch.",
      unitPrice: input.materialCost,
      totalPrice: input.materialCost
    });
  }

  if (fallbackItems.length === 0) {
    fallbackItems.push({
      position: 1,
      quantity: 1,
      description: input.serviceDescription || input.selectedServices[0] || "Leistung",
      unit: "Psch.",
      unitPrice: 0,
      totalPrice: 0
    });
  }

  return fallbackItems;
}

type EmailStatus = "not_requested" | "sent" | "not_configured" | "failed";

function buildOfferEmailText(input: {
  customerType: "person" | "company";
  salutation: "herr" | "frau";
  firstName: string;
  lastName: string;
  serviceDescription: string;
  senderName: string;
}): string {
  const serviceLine = input.serviceDescription.trim() || "angefragten Leistungen";
  const personName = [input.firstName.trim(), input.lastName.trim()].filter(Boolean).join(" ").trim();

  let greeting = "Sehr geehrte Damen und Herren,";
  if (input.customerType === "person") {
    greeting = input.salutation === "frau" ? `Sehr geehrte Frau ${personName},` : `Sehr geehrter Herr ${personName},`;
  } else if (personName) {
    greeting = input.salutation === "frau" ? `Sehr geehrte Frau ${personName},` : `Sehr geehrter Herr ${personName},`;
  }

  return [
    greeting,
    "",
    "vielen Dank für Ihre Anfrage.",
    "",
    `Anbei erhalten Sie unser Angebot für die ${serviceLine}.`,
    "Bitte entnehmen Sie alle Details dem beigefügten Angebot im Anhang.",
    "",
    "Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.",
    "",
    "Mit freundlichen Grüßen",
    input.senderName
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateOfferRequest;

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
    const composedServiceDescription = composeServiceDescription(selectedServices, serviceDescription);
    const sendEmailRequested = Boolean(body.sendEmail);

    const hours = toNonNegativeNumber(toNumber(body.hours));
    const hourlyRate = toNonNegativeNumber(toNumber(body.hourlyRate));
    const materialCost = toNonNegativeNumber(toNumber(body.materialCost));

    if (!street || !postalCode || !city || !customerEmail || !composedServiceDescription) {
      return NextResponse.json({ error: "Bitte alle Pflichtfelder ausfüllen." }, { status: 400 });
    }

    if (customerType === "person" && (!firstName || !lastName)) {
      return NextResponse.json({ error: "Für Privatpersonen bitte Vor- und Nachname ausfüllen." }, { status: 400 });
    }

    if (customerType === "company" && !companyName) {
      return NextResponse.json({ error: "Für Firmenangebote bitte einen Firmennamen eintragen." }, { status: 400 });
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
    const lineItems = buildPdfLineItems({
      positions: body.positions,
      serviceDescription: composedServiceDescription,
      selectedServices,
      hours,
      hourlyRate,
      materialCost
    });
    const safeSettings = {
      ...settings,
      logoDataUrl:
        typeof settings.logoDataUrl === "string" && settings.logoDataUrl.length <= MAX_LOGO_DATA_URL_LENGTH
          ? settings.logoDataUrl
          : ""
    };
    const senderName = settings.ownerName?.trim() || settings.companyName?.trim() || "Ihr Handwerksbetrieb";
    const mailText = buildOfferEmailText({
      customerType,
      salutation,
      firstName,
      lastName,
      serviceDescription: composedServiceDescription,
      senderName
    });

    const offer = await generateOfferText({
      customerName,
      customerAddress,
      serviceDescription: composedServiceDescription,
      hours,
      hourlyRate,
      materialCost
    });

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderToBuffer(
        OfferPdfDocument({
          offer,
          customerName,
          customerAddress,
          customerEmail,
          serviceDescription: composedServiceDescription,
          lineItems,
          settings: safeSettings
        })
      );
    } catch {
      pdfBuffer = await renderToBuffer(
        OfferPdfDocument({
          offer,
          customerName,
          customerAddress,
          customerEmail,
          serviceDescription: composedServiceDescription,
          lineItems,
          settings: {
            ...safeSettings,
            logoDataUrl: ""
          }
        })
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
        filename: "angebot.pdf"
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
          const recipients = [customerEmail, settings.senderCopyEmail].filter(Boolean);

          await resend.emails.send({
            from: resendFromEmail,
            to: recipients,
            subject: offer.subject,
            text: mailText,
            attachments: [
              {
                filename: "angebot.pdf",
                content: pdfBase64
              }
            ]
          });

          emailStatus = "sent";
          emailInfo = `E-Mail über Resend an ${customerEmail} gesendet.`;
        } catch {
          emailStatus = "failed";
          emailInfo = "Versand fehlgeschlagen. Bitte OAuth-Verbindung oder Resend-Konfiguration prüfen.";
        }
      } else {
        emailStatus = "not_configured";
        emailInfo = "Kein verbundenes Postfach und keine Resend-Konfiguration gefunden.";
      }
    }

    return NextResponse.json({
      offer,
      mailText,
      pdfBase64,
      emailStatus,
      emailInfo
    });
  } catch (error) {
    console.error("generate-offer failed", error);
    return NextResponse.json({ error: "Fehler 500 bei der Angebotserstellung" }, { status: 500 });
  }
}
