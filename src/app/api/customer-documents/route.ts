import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import {
  buildInvoiceMetadata,
  calculateLatePaymentInterest,
} from "@/lib/late-payment";
import { readSettings } from "@/lib/settings-store";
import { listStoredOfferRecords } from "@/server/services/offer-store-service";
import { StoredOfferRecord } from "@/types/offer";

function normalizeMatcherValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesCustomerIdentity(
  record: {
    customerName?: string;
    customerAddress?: string;
    customerEmail?: string;
  },
  query: {
    customerName: string;
    customerAddress: string;
    customerEmail: string;
  },
): boolean {
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

function resolveInvoiceMetadata(
  record: StoredOfferRecord,
  settings: Awaited<ReturnType<typeof readSettings>>,
) {
  if (record.invoice) {
    return record.invoice;
  }

  if ((record.documentType ?? "offer") !== "invoice") {
    return null;
  }

  const invoiceDate =
    typeof record.createdAt === "string" && record.createdAt.length >= 10
      ? record.createdAt.slice(0, 10)
      : "";
  const subtotal = record.lineItems.reduce(
    (sum, lineItem) => sum + lineItem.totalPrice,
    0,
  );

  return buildInvoiceMetadata({
    invoiceDate,
    paymentDueDays: settings.invoicePaymentDueDays,
    lineItemsSubtotal: subtotal,
    vatRate: settings.vatRate,
  });
}

export async function GET(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  try {
    const url = new URL(request.url);
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

    const [records, settings] = await Promise.all([
      listStoredOfferRecords(accessResult.user.id),
      readSettings({
        supabase: accessResult.supabase,
        userId: accessResult.user.id,
      }),
    ]);
    const documents = records
      .filter((record) => {
        const recordCustomerNumber = (record.customerNumber ?? "").trim();

        if (customerNumber) {
          if (recordCustomerNumber) {
            return recordCustomerNumber === customerNumber;
          }

          return matchesCustomerIdentity(record, {
            customerName,
            customerAddress,
            customerEmail,
          });
        }

        if (customerName || customerAddress || customerEmail) {
          return matchesCustomerIdentity(record, {
            customerName,
            customerAddress,
            customerEmail,
          });
        }

        return true;
      })
      .map((record) => {
        const invoice = resolveInvoiceMetadata(record, settings);
        const latePayment = calculateLatePaymentInterest({
          settings,
          invoice,
          customerType: record.customerType,
          paymentStatus: record.payment?.status ?? null,
        });

        return {
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
          paymentStatus: record.payment?.status ?? null,
          invoiceDate: invoice?.invoiceDate ?? null,
          paymentDueDays: invoice?.paymentDueDays ?? null,
          dueDate: invoice?.dueDate ?? null,
          totalAmount: invoice?.totalAmount ?? null,
          latePayment: latePayment
            ? {
                enabled: latePayment.enabled,
                isOverdue: latePayment.isOverdue,
                daysOverdue: latePayment.daysOverdue,
                annualInterestPercent: latePayment.annualInterestPercent,
                interestAmount: latePayment.interestAmount,
                debtorType: latePayment.debtorType,
              }
            : null,
          reminderStatus: record.reminder?.status ?? null,
          reminderDueAt: record.reminder?.dueAt ?? null,
          createdAt: record.createdAt,
        };
      });

    return NextResponse.json({ documents });
  } catch {
    return NextResponse.json(
      { error: "Dokumente konnten nicht geladen werden." },
      { status: 500 },
    );
  }
}
