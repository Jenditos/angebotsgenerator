import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/supabase/config";
import {
  allocateBusinessSequence,
  listBusinessRecords,
  shouldUseSupabaseBusinessStore,
  upsertBusinessRecord,
} from "./business-record-store";

jest.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: jest.fn(),
}));

jest.mock("@/lib/supabase/config", () => ({
  isSupabaseAdminConfigured: jest.fn(),
}));

const mockCreateSupabaseAdminClient = jest.mocked(createSupabaseAdminClient);
const mockIsSupabaseAdminConfigured = jest.mocked(isSupabaseAdminConfigured);

describe("business-record-store", () => {
  const originalProvider = process.env.BUSINESS_DATA_STORAGE_PROVIDER;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BUSINESS_DATA_STORAGE_PROVIDER;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    mockIsSupabaseAdminConfigured.mockReturnValue(false);
  });

  afterAll(() => {
    restoreEnv("BUSINESS_DATA_STORAGE_PROVIDER", originalProvider);
    restoreEnv("VERCEL", originalVercel);
    restoreEnv("VERCEL_ENV", originalVercelEnv);
  });

  it("uses local storage by default and when local paths override the provider", () => {
    mockIsSupabaseAdminConfigured.mockReturnValue(true);
    process.env.BUSINESS_DATA_STORAGE_PROVIDER = "supabase";

    expect(shouldUseSupabaseBusinessStore(true)).toBe(false);

    delete process.env.BUSINESS_DATA_STORAGE_PROVIDER;
    expect(shouldUseSupabaseBusinessStore()).toBe(false);
  });

  it("uses configured Supabase storage without opening a connection", () => {
    process.env.BUSINESS_DATA_STORAGE_PROVIDER = " SuPaBaSe ";
    mockIsSupabaseAdminConfigured.mockReturnValue(true);

    expect(shouldUseSupabaseBusinessStore()).toBe(true);
    expect(mockCreateSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("requires Supabase in Vercel production and rejects explicit local storage", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";

    expect(() => shouldUseSupabaseBusinessStore()).toThrow(
      "Supabase Admin ist nicht konfiguriert",
    );

    process.env.BUSINESS_DATA_STORAGE_PROVIDER = "local";
    expect(() => shouldUseSupabaseBusinessStore()).toThrow(
      "Lokale Geschäftsdaten-Speicherung ist in Vercel-Produktion nicht zulässig",
    );
    expect(() => shouldUseSupabaseBusinessStore(true)).toThrow(
      "Lokale Geschäftsdaten-Speicherung ist in Vercel-Produktion nicht zulässig",
    );
  });

  it("rejects unknown providers instead of silently selecting local storage", () => {
    process.env.BUSINESS_DATA_STORAGE_PROVIDER = "supabse";

    expect(() => shouldUseSupabaseBusinessStore()).toThrow(
      "Unbekannter Geschäftsdaten-Speicherprovider",
    );
  });

  it("allocates a sequence through the atomic RPC with normalized values", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 43, error: null });
    mockCreateSupabaseAdminClient.mockReturnValue({ rpc } as never);

    await expect(
      allocateBusinessSequence({
        userId: " user-id ",
        counterType: " invoice ",
        counterYear: 2026.9,
        floor: -5,
      }),
    ).resolves.toBe(43);

    expect(rpc).toHaveBeenCalledWith("allocate_business_sequence", {
      p_user_id: "user-id",
      p_counter_type: "invoice",
      p_counter_year: 2026,
      p_floor: 0,
    });
  });

  it("rejects unsafe sequence inputs before creating a Supabase client", async () => {
    await expect(
      allocateBusinessSequence({
        userId: "user-id",
        counterType: "invoice",
        floor: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toThrow("Mindestwert ist ungueltig");

    await expect(
      allocateBusinessSequence({
        userId: "user-id",
        counterType: "invoice",
        counterYear: Number.NaN,
      }),
    ).rejects.toThrow("Zaehlerjahr ist ungueltig");

    expect(mockCreateSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("preserves the Supabase error as cause without exposing its message", async () => {
    const supabaseError = {
      code: "42501",
      message: "sensitive database detail",
    };
    const rpc = jest.fn().mockResolvedValue({ data: null, error: supabaseError });
    mockCreateSupabaseAdminClient.mockReturnValue({ rpc } as never);

    const error = await allocateBusinessSequence({
      userId: "user-id",
      counterType: "invoice",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Geschaeftsnummer konnte nicht vergeben werden (42501).",
    );
    expect((error as Error).cause).toBe(supabaseError);
  });

  it("rejects invalid document metadata before creating a Supabase client", async () => {
    await expect(
      upsertBusinessRecord({
        userId: "user-id",
        entityType: "customer",
        entityKey: "customer-1",
        documentType: "invoice",
        payload: {},
      }),
    ).rejects.toThrow("nur fuer Dokumente zulaessig");

    await expect(
      upsertBusinessRecord({
        userId: "user-id",
        entityType: "document",
        entityKey: "invoice-1",
        idempotencyKey: "request-1",
        payload: {},
      }),
    ).rejects.toThrow("muss eine Dokumentart angegeben werden");

    expect(mockCreateSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("does not discard falsey JSON payloads when listing records", async () => {
    const query = {
      eq: jest.fn(),
      order: jest.fn().mockResolvedValue({
        data: [{ payload: false }, { payload: 0 }, { payload: "" }],
        error: null,
      }),
    };
    query.eq.mockReturnValue(query);
    const select = jest.fn().mockReturnValue(query);
    const from = jest.fn().mockReturnValue({ select });
    mockCreateSupabaseAdminClient.mockReturnValue({ from } as never);

    await expect(
      listBusinessRecords<boolean | number | string>(" user-id ", "activity"),
    ).resolves.toEqual([false, 0, ""]);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (typeof value === "undefined") {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
