import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { generateOfferText } from "@/lib/openai";
import { OfferPdfDocument } from "@/lib/pdf/OfferPdfDocument";
import { Resend } from "resend";
import { supabaseServer } from "@/lib/supabase";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customerName, customerEmail, serviceDescription, hours, hourlyRate, materialCost, customerAddress } = body;
    if (!customerName || !customerEmail || !serviceDescription) {
      return NextResponse.json({ error: "Bitte fulle alle Pflichtfelder aus." }, { status: 400 });
    }
    const hoursN = Number(hours), rateN = Number(hourlyRate), matN = Number(materialCost);
    const offer = await generateOfferText({ customerName, serviceDescription, hours: hoursN, hourlyRate: rateN, materialCost: matN });
    const pdfBuffer = await renderToBuffer(OfferPdfDocument({
      offer, customerName,
      customerStreet: customerAddress?.street,
      customerZip: customerAddress?.zip,
      customerCity: customerAddress?.city,
      hours: hoursN, hourlyRate: rateN, materialCost: matN
    }));
    const pdfBase64 = pdfBuffer.toString("base64");
    if (supabaseServer) {
      try {
        await supabaseServer.from("offers").insert({
          customer_name: customerName, customer_email: customerEmail,
          service_description: serviceDescription, hours: hoursN,
          hourly_rate: rateN, material_cost: matN, offer_json: offer
        });
      } catch (e) { console.warn("Supabase Fehler:", e); }
    }
    if (resend && process.env.RESEND_FROM_EMAIL) {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL, to: customerEmail, subject: offer.subject,
          text: offer.intro + "\n\n" + offer.details + "\n\n" + offer.closing,
          attachments: [{ filename: "angebot.pdf", content: pdfBase64 }]
        });
      } catch (e) { console.warn("Resend Fehler:", e); }
    }
    return NextResponse.json({ offer, pdfUrl: "data:application/pdf;base64," + pdfBase64 });
  } catch (error) {
    console.error("Fehler:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Serverfehler" }, { status: 500 });
  }
}