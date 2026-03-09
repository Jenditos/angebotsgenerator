import { NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/settings-store";
import { CompanySettings } from "@/types/offer";

export async function GET() {
  try {
    const settings = await readSettings();
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "Einstellungen konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CompanySettings>;

    const sanitized: Partial<CompanySettings> = {
      companyName: body.companyName?.trim() ?? "",
      ownerName: body.ownerName?.trim() ?? "",
      companyStreet: body.companyStreet?.trim() ?? "",
      companyPostalCode: body.companyPostalCode?.trim() ?? "",
      companyCity: body.companyCity?.trim() ?? "",
      companyEmail: body.companyEmail?.trim() ?? "",
      companyPhone: body.companyPhone?.trim() ?? "",
      companyWebsite: body.companyWebsite?.trim() ?? "",
      senderCopyEmail: body.senderCopyEmail?.trim() ?? "",
      logoDataUrl: body.logoDataUrl?.trim() ?? "",
      startOfferNumber: body.startOfferNumber?.trim() ?? "",
      lastOfferNumber: body.lastOfferNumber?.trim() ?? "",
      offerNumberFallbackCounter: Number(body.offerNumberFallbackCounter ?? 0),
      customServiceTypes: Array.isArray(body.customServiceTypes)
        ? body.customServiceTypes.map((item) => String(item).trim()).filter(Boolean)
        : []
    };

    const settings = await writeSettings(sanitized);
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "Einstellungen konnten nicht gespeichert werden." }, { status: 500 });
  }
}
