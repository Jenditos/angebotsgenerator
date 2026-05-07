import {
  CompanySettings,
  DocumentPaymentStatus,
  StoredInvoiceMetadata,
} from "@/types/offer";

export type LatePaymentDebtorType = "consumer" | "business";

export type LatePaymentCalculation = {
  enabled: boolean;
  isOverdue: boolean;
  daysOverdue: number;
  annualInterestPercent: number;
  interestAmount: number;
  dueDate: string;
  calculationBaseAmount: number;
  debtorType: LatePaymentDebtorType;
};

const DEFAULT_CONSUMER_ANNUAL_INTEREST_PERCENT = 6.27;
const DEFAULT_BUSINESS_ANNUAL_INTEREST_PERCENT = 10.27;
const MIN_INTEREST_PERCENT = 0;
const MAX_INTEREST_PERCENT = 100;
const MIN_GRACE_DAYS = 0;
const MAX_GRACE_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function normalizeLatePaymentInterestPercent(
  value: unknown,
  fallback: number,
): number {
  return clampNumber(value, fallback, MIN_INTEREST_PERCENT, MAX_INTEREST_PERCENT);
}

export function normalizeLatePaymentGraceDays(value: unknown, fallback = 0): number {
  return Math.floor(clampNumber(value, fallback, MIN_GRACE_DAYS, MAX_GRACE_DAYS));
}

export function getDefaultLatePaymentConsumerAnnualInterestPercent(): number {
  return DEFAULT_CONSUMER_ANNUAL_INTEREST_PERCENT;
}

export function getDefaultLatePaymentBusinessAnnualInterestPercent(): number {
  return DEFAULT_BUSINESS_ANNUAL_INTEREST_PERCENT;
}

export function resolveLatePaymentDebtorType(
  customerType: "person" | "company" | null | undefined,
): LatePaymentDebtorType {
  return customerType === "person" ? "consumer" : "business";
}

export function resolveLatePaymentAnnualInterestPercent(
  settings: Pick<
    CompanySettings,
    | "latePaymentConsumerAnnualInterestPercent"
    | "latePaymentBusinessAnnualInterestPercent"
  >,
  debtorType: LatePaymentDebtorType,
): number {
  return debtorType === "consumer"
    ? normalizeLatePaymentInterestPercent(
        settings.latePaymentConsumerAnnualInterestPercent,
        DEFAULT_CONSUMER_ANNUAL_INTEREST_PERCENT,
      )
    : normalizeLatePaymentInterestPercent(
        settings.latePaymentBusinessAnnualInterestPercent,
        DEFAULT_BUSINESS_ANNUAL_INTEREST_PERCENT,
      );
}

function parseDateValue(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function toDateValue(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysToDateValue(dateValue: string, days: number): string {
  const parsedDate = parseDateValue(dateValue);
  if (!parsedDate) {
    return "";
  }

  const normalizedDays = Number.isFinite(days) ? Math.floor(days) : 0;
  parsedDate.setUTCDate(parsedDate.getUTCDate() + normalizedDays);
  return toDateValue(parsedDate);
}

export function buildInvoiceMetadata(input: {
  invoiceDate: string;
  paymentDueDays: number;
  lineItemsSubtotal: number;
  vatRate: number;
}): StoredInvoiceMetadata | null {
  const invoiceDate = parseDateValue(input.invoiceDate)
    ? input.invoiceDate
    : "";
  if (!invoiceDate) {
    return null;
  }

  const paymentDueDays = Math.floor(
    clampNumber(input.paymentDueDays, 14, 0, 365),
  );
  const subtotalAmount = Math.max(
    0,
    Number.isFinite(input.lineItemsSubtotal) ? input.lineItemsSubtotal : 0,
  );
  const vatRate = normalizeLatePaymentInterestPercent(input.vatRate, 0);
  const vatAmount = subtotalAmount * (vatRate / 100);
  const totalAmount = subtotalAmount + vatAmount;

  return {
    invoiceDate,
    paymentDueDays,
    dueDate: addDaysToDateValue(invoiceDate, paymentDueDays),
    subtotalAmount: Number(subtotalAmount.toFixed(2)),
    vatRate,
    vatAmount: Number(vatAmount.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
    currency: "EUR",
  };
}

function shouldCalculateForPaymentStatus(
  status: DocumentPaymentStatus | null | undefined,
): boolean {
  return status === "unpaid" || status === "pending" || status === "failed";
}

export function calculateLatePaymentInterest(input: {
  settings: Pick<
    CompanySettings,
    | "latePaymentInterestEnabled"
    | "latePaymentConsumerAnnualInterestPercent"
    | "latePaymentBusinessAnnualInterestPercent"
    | "latePaymentGraceDays"
  >;
  invoice: StoredInvoiceMetadata | null | undefined;
  customerType?: "person" | "company" | null;
  paymentStatus?: DocumentPaymentStatus | null;
  asOf?: Date;
}): LatePaymentCalculation | null {
  const invoice = input.invoice;
  if (!invoice?.dueDate) {
    return null;
  }

  const dueDate = parseDateValue(invoice.dueDate);
  if (!dueDate) {
    return null;
  }

  const debtorType = resolveLatePaymentDebtorType(input.customerType);
  const annualInterestPercent = resolveLatePaymentAnnualInterestPercent(
    input.settings,
    debtorType,
  );
  const graceDays = normalizeLatePaymentGraceDays(
    input.settings.latePaymentGraceDays,
  );
  const asOf = input.asOf ?? new Date();
  const asOfDate = new Date(
    Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()),
  );
  const payableAfterGraceDate = new Date(dueDate);
  payableAfterGraceDate.setUTCDate(payableAfterGraceDate.getUTCDate() + graceDays);
  const rawDaysOverdue = Math.floor(
    (asOfDate.getTime() - payableAfterGraceDate.getTime()) / MS_PER_DAY,
  );
  const daysOverdue = Math.max(0, rawDaysOverdue);
  const calculationBaseAmount = Math.max(0, invoice.totalAmount);
  const canCalculate =
    Boolean(input.settings.latePaymentInterestEnabled) &&
    shouldCalculateForPaymentStatus(input.paymentStatus) &&
    daysOverdue > 0 &&
    calculationBaseAmount > 0 &&
    annualInterestPercent > 0;
  const interestAmount = canCalculate
    ? calculationBaseAmount * (annualInterestPercent / 100) * (daysOverdue / 365)
    : 0;

  return {
    enabled: Boolean(input.settings.latePaymentInterestEnabled),
    isOverdue: daysOverdue > 0 && shouldCalculateForPaymentStatus(input.paymentStatus),
    daysOverdue,
    annualInterestPercent,
    interestAmount: Number(interestAmount.toFixed(2)),
    dueDate: invoice.dueDate,
    calculationBaseAmount,
    debtorType,
  };
}
