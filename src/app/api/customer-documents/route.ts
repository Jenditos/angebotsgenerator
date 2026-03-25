import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { listStoredOfferRecords } from "@/server/services/offer-store-service";

export async function GET(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const url = new URL(request.url);
    const customerNumber = (url.searchParams.get("customerNumber") ?? "").trim();

    const records = await listStoredOfferRecords();
    const documents = records
      .filter((record) =>
        customerNumber ? record.customerNumber === customerNumber : true,
      )
      .map((record) => ({
        documentNumber: record.offerNumber,
        documentType: record.documentType === "invoice" ? "invoice" : "offer",
        customerNumber: record.customerNumber ?? null,
        customerName: record.customerName,
        createdAt: record.createdAt,
      }));

    return NextResponse.json({ documents });
  } catch {
    return NextResponse.json(
      { error: "Dokumente konnten nicht geladen werden." },
      { status: 500 },
    );
  }
}
