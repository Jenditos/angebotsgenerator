import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { listStoredOfferRecords } from "@/server/services/offer-store-service";

function normalizeMatcherValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesCustomerIdentity(
  record: {
    customerNumber?: string;
    customerName?: string;
    customerAddress?: string;
    customerEmail?: string;
  },
  query: {
    customerNumber: string;
    customerName: string;
    customerAddress: string;
    customerEmail: string;
  },
): boolean {
  if (query.customerNumber) {
    const recordCustomerNumber = (record.customerNumber ?? "").trim();
    if (recordCustomerNumber && recordCustomerNumber === query.customerNumber) {
      return true;
    }
  }

  if (query.customerEmail) {
    const recordEmail = normalizeMatcherValue(record.customerEmail ?? "");
    if (recordEmail && recordEmail === query.customerEmail) {
      return true;
    }
  }

  if (query.customerName) {
    const recordName = normalizeMatcherValue(record.customerName ?? "");
    if (recordName && recordName === query.customerName) {
      if (!query.customerAddress) {
        return true;
      }

      const recordAddress = normalizeMatcherValue(record.customerAddress ?? "");
      if (recordAddress && recordAddress === query.customerAddress) {
        return true;
      }
    }
  }

  return false;
}

export async function GET(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const url = new URL(request.url);
    const projectNumber = (url.searchParams.get("projectNumber") ?? "").trim();
    const projectName = normalizeMatcherValue(
      (url.searchParams.get("projectName") ?? "").trim(),
    );
    const customerNumber = (url.searchParams.get("customerNumber") ?? "").trim();
    const customerName = normalizeMatcherValue(
      (url.searchParams.get("customerName") ?? "").trim(),
    );
    const customerAddress = normalizeMatcherValue(
      (url.searchParams.get("customerAddress") ?? "").trim(),
    );
    const customerEmail = normalizeMatcherValue(
      (url.searchParams.get("customerEmail") ?? "").trim(),
    );

    const records = await listStoredOfferRecords();
    const documents = records
      .filter((record) => {
        const recordProjectNumber = (record.projectNumber ?? "").trim();

        if (projectNumber) {
          if (recordProjectNumber) {
            return recordProjectNumber === projectNumber;
          }

          // Legacy fallback: match records without projectNumber by
          // project identity + customer identity.
          if (!projectName) {
            return false;
          }

          const recordProjectName = normalizeMatcherValue(record.projectName ?? "");
          if (!recordProjectName || recordProjectName !== projectName) {
            return false;
          }

          return matchesCustomerIdentity(record, {
            customerNumber,
            customerName,
            customerAddress,
            customerEmail,
          });
        }

        return true;
      })
      .map((record) => ({
        documentNumber: record.offerNumber,
        documentType: record.documentType === "invoice" ? "invoice" : "offer",
        customerNumber: record.customerNumber ?? null,
        customerName: record.customerName,
        projectNumber: record.projectNumber ?? null,
        projectName: record.projectName ?? null,
        title:
          record.projectName?.trim() ||
          record.serviceDescription?.trim() ||
          null,
        status: record.status ?? null,
        hasPdf: Boolean(record.pdf?.storageKey),
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
