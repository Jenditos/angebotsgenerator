import { SupabaseClient, User } from "@supabase/supabase-js";

export const ACCESS_TABLE = "user_access";
export const TRIAL_DURATION_DAYS = 30;
export const MONTHLY_PLAN_ID = "monthly_49_90";
export const TRIAL_PLAN_ID = "trial";
export const TRIAL_STATUS = "trial";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export type UserAccessRecord = {
  user_id: string;
  email: string;
  created_at: string;
  trial_start: string;
  trial_end: string;
  subscription_status: string;
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  const normalized = asString(value).trim();
  return normalized || null;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeAccessRecord(row: Record<string, unknown>): UserAccessRecord {
  return {
    user_id: asString(row.user_id),
    email: asString(row.email),
    created_at: asString(row.created_at),
    trial_start: asString(row.trial_start),
    trial_end: asString(row.trial_end),
    subscription_status: asString(row.subscription_status),
    plan: asString(row.plan),
    stripe_customer_id: asNullableString(row.stripe_customer_id),
    stripe_subscription_id: asNullableString(row.stripe_subscription_id),
  };
}

export function hasActiveSubscription(record: UserAccessRecord): boolean {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(record.subscription_status.trim());
}

export function isTrialActive(record: UserAccessRecord, now = new Date()): boolean {
  const trialEnd = new Date(record.trial_end);
  if (Number.isNaN(trialEnd.getTime())) {
    return false;
  }
  return trialEnd.getTime() > now.getTime();
}

export function canUseApp(record: UserAccessRecord, now = new Date()): boolean {
  return isTrialActive(record, now) || hasActiveSubscription(record);
}

export async function readUserAccessRecord(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserAccessRecord | null> {
  const { data, error } = await supabase
    .from(ACCESS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  return normalizeAccessRecord(data as Record<string, unknown>);
}

export async function ensureUserAccessRecord(
  supabase: SupabaseClient,
  user: User,
): Promise<UserAccessRecord> {
  const existing = await readUserAccessRecord(supabase, user.id);
  if (existing) {
    return existing;
  }

  const now = new Date();
  const trialEnd = addDays(now, TRIAL_DURATION_DAYS);

  const payload = {
    user_id: user.id,
    email: user.email?.trim() ?? "",
    trial_start: now.toISOString(),
    trial_end: trialEnd.toISOString(),
    subscription_status: TRIAL_STATUS,
    plan: TRIAL_PLAN_ID,
    stripe_customer_id: null,
    stripe_subscription_id: null,
  };

  const { data, error } = await supabase
    .from(ACCESS_TABLE)
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      const recovered = await readUserAccessRecord(supabase, user.id);
      if (recovered) {
        return recovered;
      }
    }
    throw error;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Zugriffsdatensatz konnte nicht erstellt werden.");
  }

  return normalizeAccessRecord(data as Record<string, unknown>);
}

export function buildAccessState(record: UserAccessRecord) {
  const trialActive = isTrialActive(record);
  const hasSubscription = hasActiveSubscription(record);
  return {
    trialActive,
    hasSubscription,
    canUseApp: trialActive || hasSubscription,
  };
}

