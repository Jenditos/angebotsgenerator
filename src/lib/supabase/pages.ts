import { createServerClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

type CookieOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
};

type CookieDescriptor = {
  name: string;
  value: string;
  options?: CookieOptions;
};

function normalizeSetCookieHeader(
  value: ReturnType<NextApiResponse["getHeader"]>,
): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  return [String(value)];
}

function serializeCookieHeader(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path || "/"}`);

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.expires instanceof Date && !Number.isNaN(options.expires.getTime())) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  const sameSite = options.sameSite;
  if (sameSite) {
    const normalizedSameSite =
      sameSite === true
        ? "Strict"
        : String(sameSite).charAt(0).toUpperCase() + String(sameSite).slice(1);
    parts.push(`SameSite=${normalizedSameSite}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function createSupabasePagesServerClient(
  req: NextApiRequest,
  res: NextApiResponse,
): SupabaseClient {
  const { url, anonKey } = getSupabasePublicConfig();
  let requestCookies = Object.entries(req.cookies || {}).map(([name, value]) => ({
    name,
    value: String(value ?? ""),
  }));

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return requestCookies;
      },
      setAll(cookiesToSet) {
        const nextSetCookieHeaders = normalizeSetCookieHeader(
          res.getHeader("Set-Cookie"),
        );

        cookiesToSet.forEach((cookie) => {
          const normalizedCookie = cookie as CookieDescriptor;
          requestCookies = requestCookies.filter(
            (entry) => entry.name !== normalizedCookie.name,
          );
          requestCookies.push({
            name: normalizedCookie.name,
            value: normalizedCookie.value,
          });
          nextSetCookieHeaders.push(
            serializeCookieHeader(
              normalizedCookie.name,
              normalizedCookie.value,
              normalizedCookie.options,
            ),
          );
        });

        if (nextSetCookieHeaders.length > 0) {
          res.setHeader("Set-Cookie", nextSetCookieHeaders);
        }
      },
    },
  });
}
