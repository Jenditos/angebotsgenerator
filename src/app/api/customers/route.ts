import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { CustomerDraftState } from "@/types/offer";
import {
  listStoredCustomers,
  removeStoredCustomer,
  upsertStoredCustomer,
} from "@/server/services/customer-store-service";
import {
  CUSTOMER_TEXT_INPUT_RULES,
  readJsonObject,
  UserInputValidationError,
  validateTextInputs,
} from "@/lib/user-input";

export async function GET() {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const customers = await listStoredCustomers(accessResult.user.id);
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
    const body = await readJsonObject(request);
    const validation = validateTextInputs(body, CUSTOMER_TEXT_INPUT_RULES);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      companyName,
      firstName,
      lastName,
      street,
      postalCode,
      city,
      customerEmail,
      customerName,
    } = validation.values;
    const customerAddress =
      validation.values.customerAddress ||
      [street, [postalCode, city].filter(Boolean).join(" ")]
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
      userId: accessResult.user.id,
      customerType: body.customerType === "company" ? "company" : "person",
      companyName,
      salutation: body.salutation === "frau" ? "frau" : "herr",
      firstName,
      lastName,
      street,
      postalCode,
      city,
      customerEmail,
      customerName,
      customerAddress,
      draftState: body.draftState as CustomerDraftState | undefined,
    });

    return NextResponse.json({ customer });
  } catch (error) {
    if (error instanceof UserInputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
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

    const removed = await removeStoredCustomer(
      accessResult.user.id,
      customerNumber,
    );
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
