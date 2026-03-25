export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(isSupabaseConfigured() && SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabasePublicConfig(): { url: string; anonKey: string } {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase ist nicht konfiguriert. Bitte NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY setzen.",
    );
  }

  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
  };
}

export function getSupabaseAdminConfig(): {
  url: string;
  serviceRoleKey: string;
} {
  if (!isSupabaseAdminConfigured()) {
    throw new Error(
      "Supabase Admin ist nicht konfiguriert. Bitte SUPABASE_SERVICE_ROLE_KEY setzen.",
    );
  }

  return {
    url: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  };
}
