import { NextResponse } from "next/server";
import { listStoredCustomers } from "@/server/services/customer-store-service";

export async function GET() {
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
