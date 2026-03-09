import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import { generateOfferText } from "@/lib/openai";
import { OfferPdfDocument } from "@/lib/pdf";
import { readSettings } from "@/lib/settings-store";
import { sendViaConnectedMailbox } from "@/lib/email-sender";
import { GenerateOfferRequest } from "@/types/offer";

const MAX_LOGO_DATA_URL_LENGTH = 2_000_000;

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
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
    const sendEmailRequested = Boolean(body.sendEmail);

    const hours = toNumber(body.hours);
    const hourlyRate = toNumber(body.hourlyRate);
    const materialCost = toNumber(body.materialCost);

    if (!street || !postalCode || !city || !customerEmail || !serviceDescription) {
      return NextResponse.json({ error: "Bitte alle Pflichtfelder ausfüllen." }, { status: 400 });
    }

    if (customerType === "person" && (!firstName || !lastName)) {
      return NextResponse.json({ error: "Für Privatpersonen bitte Vor- und Nachname ausfüllen." }, { status: 400 });
    }

    if (customerType === "company" && !companyName) {
      return NextResponse.json({ error: "Für Firmenangebote bitte einen Firmennamen eintragen." }, { status: 400 });
    }

    if (!Number.isFinite(hours) || !Number.isFinite(hourlyRate) || !Number.isFinite(materialCost)) {
      return NextResponse.json({ error: "Stunden, Stundensatz und Materialkosten müssen Zahlen sein." }, { status: 400 });
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
      serviceDescription,
      senderName
    });

    const offer = await generateOfferText({
      customerName,
      customerAddress,
      serviceDescription,
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
          serviceDescription,
          hours,
          hourlyRate,
          materialCost,
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
          serviceDescription,
          hours,
          hourlyRate,
          materialCost,
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
