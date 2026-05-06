import { NextResponse } from "next/server";
import { PATCH } from "@/app/api/customer-documents/[documentNumber]/payment/route";
import { requireAppAccess } from "@/lib/access/guards";
import { createActivityLogEntry } from "@/server/services/activity-log-service";
import {
  findStoredOfferRecordByNumber,
  updateStoredOfferRecordPaymentReference,
} from "@/server/services/offer-store-service";

jest.mock("@/lib/access/guards", () => ({
  requireAppAccess: jest.fn(),
}));

jest.mock("@/server/services/offer-store-service", () => ({
  findStoredOfferRecordByNumber: jest.fn(),
  updateStoredOfferRecordPaymentReference: jest.fn(),
}));

jest.mock("@/server/services/activity-log-service", () => ({
  createActivityLogEntry: jest.fn(),
}));

const requireAppAccessMock = jest.mocked(requireAppAccess);
const findStoredOfferRecordByNumberMock = jest.mocked(
  findStoredOfferRecordByNumber,
);
const updateStoredOfferRecordPaymentReferenceMock = jest.mocked(
  updateStoredOfferRecordPaymentReference,
);
const createActivityLogEntryMock = jest.mocked(createActivityLogEntry);

describe("PATCH /api/customer-documents/[documentNumber]/payment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes through auth guard failures", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Nicht eingeloggt." }, { status: 401 }),
    });

    const response = await PATCH(
      new Request("https://example.com/api/customer-documents/RE-2026-001/payment", {
        method: "PATCH",
        body: JSON.stringify({ paymentStatus: "paid" }),
      }),
      {
        params: Promise.resolve({ documentNumber: "RE-2026-001" }),
      },
    );

    expect(response.status).toBe(401);
    expect(findStoredOfferRecordByNumberMock).not.toHaveBeenCalled();
  });

  it("rejects payment updates for offers", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    findStoredOfferRecordByNumberMock.mockResolvedValue({
      offerNumber: "ANG-2026-001",
      documentType: "offer",
    } as never);

    const response = await PATCH(
      new Request(
        "https://example.com/api/customer-documents/ANG-2026-001/payment",
        {
          method: "PATCH",
          body: JSON.stringify({ paymentStatus: "paid" }),
        },
      ),
      {
        params: Promise.resolve({ documentNumber: "ANG-2026-001" }),
      },
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("nur für Rechnungen");
    expect(updateStoredOfferRecordPaymentReferenceMock).not.toHaveBeenCalled();
  });

  it("updates invoice payment status and does not fail when activity logging fails", async () => {
    requireAppAccessMock.mockResolvedValue({
      ok: true,
      supabase: {} as never,
      user: { id: "user-1", email: "user@example.com" } as never,
      access: {} as never,
    });
    findStoredOfferRecordByNumberMock.mockResolvedValue({
      offerNumber: "RE-2026-001",
      documentType: "invoice",
    } as never);
    updateStoredOfferRecordPaymentReferenceMock.mockResolvedValue({
      offerNumber: "RE-2026-001",
      payment: {
        status: "paid",
        provider: "manual",
        reference: "bank-transfer",
        paidAt: "2026-05-06T08:00:00.000Z",
        updatedAt: "2026-05-06T08:00:00.000Z",
      },
    } as never);
    createActivityLogEntryMock.mockRejectedValue(new Error("log failed"));

    const response = await PATCH(
      new Request("https://example.com/api/customer-documents/RE-2026-001/payment", {
        method: "PATCH",
        body: JSON.stringify({
          paymentStatus: "paid",
          paymentProvider: "manual",
          paymentReference: "bank-transfer",
          paidAt: "2026-05-06",
        }),
      }),
      {
        params: Promise.resolve({ documentNumber: "RE-2026-001" }),
      },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      paymentStatus?: string | null;
      documentNumber?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.documentNumber).toBe("RE-2026-001");
    expect(payload.paymentStatus).toBe("paid");
    expect(updateStoredOfferRecordPaymentReferenceMock).toHaveBeenCalledWith(
      "RE-2026-001",
      "user-1",
      expect.objectContaining({
        status: "paid",
        provider: "manual",
        reference: "bank-transfer",
      }),
    );
    expect(createActivityLogEntryMock).toHaveBeenCalledTimes(1);
  });
});
