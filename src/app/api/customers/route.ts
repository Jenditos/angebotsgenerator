import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  listStoredCustomers,
  removeStoredCustomer,
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
