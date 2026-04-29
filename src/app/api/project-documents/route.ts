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
    const projectNumber = (url.searchParams.get("projectNumber") ?? "").trim();

    const records = await listStoredOfferRecords();
    const documents = records
      .filter((record) =>
        projectNumber ? record.projectNumber === projectNumber : true,
      )
      .map((record) => ({
        documentNumber: record.offerNumber,
        documentType: record.documentType === "invoice" ? "invoice" : "offer",
        customerNumber: record.customerNumber ?? null,
        customerName: record.customerName,
        projectNumber: record.projectNumber ?? null,
        projectName: record.projectName ?? null,
        createdAt: record.createdAt,
      }));

    return NextResponse.json({ documents });
  } catch {
    return NextResponse.json(
      { error: "Projekt-Dokumente konnten nicht geladen werden." },
      { status: 500 },
    );
  }
}
