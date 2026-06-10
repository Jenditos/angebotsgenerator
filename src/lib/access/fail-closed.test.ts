import { readFileSync } from "node:fs";
import path from "node:path";

describe("access control fail-closed contract", () => {
  it("does not grant transient access when access storage is unavailable", () => {
    const files = [
      "middleware.ts",
      "src/lib/access/guards.ts",
      "src/app/api/access/status/route.ts",
      "src/app/api/access/bootstrap/route.ts",
      "src/pages/api/pdf/generate-offer.ts",
      "src/app/auth/callback/route.ts",
    ];

    const source = files
      .map((file) => readFileSync(path.join(process.cwd(), file), "utf8"))
      .join("\n");

    expect(source).not.toContain("buildTransientTrialAccessRecord");
    expect(source).not.toContain("transient setup fallback");
    expect(source).not.toContain("setupWarning");
  });

  it("prevents authenticated users from updating their own subscription state", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/202606100002_user_access_security.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      "revoke update, delete on table public.user_access from authenticated",
    );
    expect(migration).toContain("subscription_status = 'trial'");
    expect(migration).toContain("plan = 'trial'");
    expect(migration).not.toContain('create policy "user_access_update_own"');
  });
});
