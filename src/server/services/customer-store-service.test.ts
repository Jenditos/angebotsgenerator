import {
  listStoredCustomers,
  removeStoredCustomer,
  upsertStoredCustomer,
} from "./customer-store-service";
import {
  allocateBusinessSequence,
  listBusinessRecords,
  removeBusinessRecord,
  shouldUseSupabaseBusinessStore,
  upsertBusinessRecord,
} from "./business-record-store";

jest.mock("./business-record-store", () => ({
  allocateBusinessSequence: jest.fn(),
  listBusinessRecords: jest.fn(),
  removeBusinessRecord: jest.fn(),
  shouldUseSupabaseBusinessStore: jest.fn(),
  upsertBusinessRecord: jest.fn(),
}));

const mockAllocateBusinessSequence = jest.mocked(allocateBusinessSequence);
const mockListBusinessRecords = jest.mocked(listBusinessRecords);
const mockRemoveBusinessRecord = jest.mocked(removeBusinessRecord);
const mockShouldUseSupabaseBusinessStore = jest.mocked(
  shouldUseSupabaseBusinessStore,
);
const mockUpsertBusinessRecord = jest.mocked(upsertBusinessRecord);

const TEST_USER_ID = "user-test-1";

function createSampleInput(seed: string) {
  return {
    userId: TEST_USER_ID,
    customerType: "company" as const,
    companyName: `Kunde ${seed} GmbH`,
    salutation: "herr" as const,
    firstName: "Max",
    lastName: `Beispiel${seed}`,
    street: `${seed} Testweg 1`,
    postalCode: "40210",
    city: "Duesseldorf",
    customerName: `Kunde ${seed} GmbH`,
    customerAddress: `${seed} Testweg 1, 40210 Duesseldorf`,
    customerEmail: `kunde-${seed}@example.com`,
  };
}

describe("customer-store-service Supabase storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldUseSupabaseBusinessStore.mockImplementation(
      (hasLocalPathOverrides) => !hasLocalPathOverrides,
    );
  });

  it("lists sanitized business records for the requested user", async () => {
    mockListBusinessRecords.mockResolvedValue([
      {
        ...createSampleInput("1"),
        userId: "other-payload-user",
        customerNumber: "1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    ]);

    const customers = await listStoredCustomers(TEST_USER_ID);

    expect(mockListBusinessRecords).toHaveBeenCalledWith(TEST_USER_ID, "customer");
    expect(customers[0]).toMatchObject({
      userId: TEST_USER_ID,
      customerNumber: "KDN-000001",
    });
  });

  it("allocates a customer number atomically and stores the new record", async () => {
    mockListBusinessRecords.mockResolvedValue([
      {
        ...createSampleInput("old"),
        customerNumber: "KDN-000004",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    mockAllocateBusinessSequence.mockResolvedValue(5);

    const created = await upsertStoredCustomer(createSampleInput("new"));

    expect(mockAllocateBusinessSequence).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      counterType: "customer",
      floor: 4,
    });
    expect(mockUpsertBusinessRecord).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      entityType: "customer",
      entityKey: "KDN-000005",
      payload: created,
    });
    expect(created.customerNumber).toBe("KDN-000005");
  });

  it("reuses matching logic for updates and removes by user", async () => {
    mockListBusinessRecords.mockResolvedValue([
      {
        ...createSampleInput("1"),
        customerNumber: "KDN-000003",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    mockRemoveBusinessRecord.mockResolvedValue(true);

    const updated = await upsertStoredCustomer({
      ...createSampleInput("1"),
      customerName: "Aktualisierter Kunde",
    });
    const removed = await removeStoredCustomer(TEST_USER_ID, "KDN-000003");

    expect(mockAllocateBusinessSequence).not.toHaveBeenCalled();
    expect(mockUpsertBusinessRecord).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      entityType: "customer",
      entityKey: "KDN-000003",
      payload: updated,
    });
    expect(mockRemoveBusinessRecord).toHaveBeenCalledWith(
      TEST_USER_ID,
      "customer",
      "KDN-000003",
    );
    expect(removed).toBe(true);
  });
});
