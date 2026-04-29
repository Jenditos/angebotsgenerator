import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { CustomerDraftState } from "@/types/offer";
import {
  listStoredCustomers,
  removeStoredCustomer,
  upsertStoredCustomer,
} from "@/server/services/customer-store-service";

export async function GET() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const customers = await listStoredCustomers();
    return NextResponse.json({ customers });
  } catch {
    return NextResponse.json(
      { error: "Gespeicherte Kunden konnten nicht geladen werden." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const body = (await request.json()) as {
      customerType?: unknown;
      companyName?: unknown;
      salutation?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      street?: unknown;
      postalCode?: unknown;
      city?: unknown;
      customerEmail?: unknown;
      customerName?: unknown;
      customerAddress?: unknown;
      draftState?: unknown;
    };

    const customerName =
      typeof body.customerName === "string" ? body.customerName.trim() : "";
    const street = typeof body.street === "string" ? body.street.trim() : "";
    const postalCode =
      typeof body.postalCode === "string" ? body.postalCode.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const customerAddress =
      typeof body.customerAddress === "string"
        ? body.customerAddress.trim()
        : [street, [postalCode, city].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(", ");

    if (!customerName) {
      return NextResponse.json(
        { error: "Bitte einen Kontakt oder Kundennamen angeben." },
        { status: 400 },
      );
    }

    if (!street || !postalCode || !city || !customerAddress) {
      return NextResponse.json(
        { error: "Bitte eine vollständige Kundenadresse angeben." },
        { status: 400 },
      );
    }

    const customer = await upsertStoredCustomer({
      customerType: body.customerType === "company" ? "company" : "person",
      companyName:
        typeof body.companyName === "string" ? body.companyName.trim() : "",
      salutation: body.salutation === "frau" ? "frau" : "herr",
      firstName:
        typeof body.firstName === "string" ? body.firstName.trim() : "",
      lastName: typeof body.lastName === "string" ? body.lastName.trim() : "",
      street,
      postalCode,
      city,
      customerEmail:
        typeof body.customerEmail === "string" ? body.customerEmail.trim() : "",
      customerName,
      customerAddress,
      draftState: body.draftState as CustomerDraftState | undefined,
    });

    return NextResponse.json({ customer });
  } catch {
    return NextResponse.json(
      { error: "Kontakt konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const url = new URL(request.url);
    const customerNumber = (url.searchParams.get("customerNumber") ?? "").trim();
    if (!customerNumber) {
      return NextResponse.json(
        { error: "Kundennummer fehlt." },
        { status: 400 },
      );
    }

    const removed = await removeStoredCustomer(customerNumber);
    if (!removed) {
      return NextResponse.json(
        { error: "Kunde konnte nicht gelöscht werden." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Gespeicherter Kunde konnte nicht gelöscht werden." },
      { status: 500 },
    );
  }
}
