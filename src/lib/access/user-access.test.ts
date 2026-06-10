import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  buildAccessState,
  ensureEffectiveUserAccessRecord,
  INTERNAL_TESTER_PLAN_ID,
  isInternalTester,
  readEffectiveUserAccessRecord,
} from "@/lib/access/user-access";

const originalTesterEmails = process.env.APP_TESTER_EMAILS;
const originalTesterUserIds = process.env.APP_TESTER_USER_IDS;

const testerUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "Tester@Example.com",
  created_at: "2026-01-01T00:00:00.000Z",
} as User;

describe("internal tester access", () => {
  beforeEach(() => {
    delete process.env.APP_TESTER_EMAILS;
    delete process.env.APP_TESTER_USER_IDS;
  });

  afterAll(() => {
    restoreEnv("APP_TESTER_EMAILS", originalTesterEmails);
    restoreEnv("APP_TESTER_USER_IDS", originalTesterUserIds);
  });

  it("matches exact emails case-insensitively and exact user ids", () => {
    process.env.APP_TESTER_EMAILS = " other@example.com, tester@example.com ";
    expect(isInternalTester(testerUser)).toBe(true);

    delete process.env.APP_TESTER_EMAILS;
    process.env.APP_TESTER_USER_IDS =
      "00000000-0000-4000-8000-000000000001";
    expect(isInternalTester(testerUser)).toBe(true);

    process.env.APP_TESTER_USER_IDS = "00000000-0000-4000-8000-000000000002";
    expect(isInternalTester(testerUser)).toBe(false);
  });

  it("grants an active synthetic record without querying access storage", async () => {
    process.env.APP_TESTER_EMAILS = "tester@example.com";
    const supabase = {
      from: jest.fn(() => {
        throw new Error("database must not be queried for internal testers");
      }),
    } as unknown as SupabaseClient;

    const ensured = await ensureEffectiveUserAccessRecord(supabase, testerUser);
    const read = await readEffectiveUserAccessRecord(supabase, testerUser);

    expect(ensured.plan).toBe(INTERNAL_TESTER_PLAN_ID);
    expect(read).toEqual(ensured);
    expect(buildAccessState(ensured).canUseApp).toBe(true);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (typeof value === "undefined") {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
