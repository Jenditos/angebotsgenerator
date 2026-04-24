import { SupabaseClient, User } from "@supabase/supabase-js";
import { TRIAL_PLAN_ID, TRIAL_STATUS, UserAccessRecord } from "@/lib/access/user-access";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Keep the hard bypass disabled in production and tests. In local development
// without Supabase ENV values, the app uses the same isolated local user so
// UI/API checks stay testable instead of returning setup 500s.
const TEMP_DISABLE_LOGIN_BLOCKADE = false;

const BYPASS_USER_ID = "11111111-1111-1111-1111-111111111111";
const BYPASS_EMAIL = "bypass@local.test";

export function isAuthBypassEnabled(): boolean {
  return (
    TEMP_DISABLE_LOGIN_BLOCKADE ||
    (process.env.NODE_ENV === "development" && !isSupabaseConfigured())
  );
}

export function buildBypassSupabaseClient(): SupabaseClient {
  return {} as SupabaseClient;
}

export function buildBypassUser(): User {
  return {
    id: BYPASS_USER_ID,
    email: BYPASS_EMAIL,
    app_metadata: {
      provider: "email",
      providers: ["email"],
    },
    user_metadata: {
      full_name: "Bypass User",
    },
    aud: "authenticated",
    created_at: new Date(0).toISOString(),
  } as User;
}

export function buildBypassAccessRecord(): UserAccessRecord {
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000);

  return {
    user_id: BYPASS_USER_ID,
    email: BYPASS_EMAIL,
    created_at: now.toISOString(),
    trial_start: now.toISOString(),
    trial_end: trialEnd.toISOString(),
    subscription_status: TRIAL_STATUS,
    plan: TRIAL_PLAN_ID,
    stripe_customer_id: null,
    stripe_subscription_id: null,
  };
}
