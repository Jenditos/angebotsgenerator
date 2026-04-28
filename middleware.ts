import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { isAuthBypassEnabled } from "@/lib/access/auth-bypass";
import { isUserAccessSetupError, logUserAccessError } from "@/lib/access/access-errors";
import { canUseApp, readUserAccessRecord } from "@/lib/access/user-access";
import { getSupabasePublicConfig, isSupabaseConfigured } from "@/lib/supabase/config";

const SETTINGS_SETUP_ERROR_CODES = new Set([
  "42P01",
  "42501",
  "3F000",
  "PGRST204",
  "PGRST205",
]);

function isAuthRoute(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

function isAuthFlowRoute(pathname: string): boolean {
  return (
    pathname === "/auth/callback" ||
    pathname.startsWith("/auth/callback/") ||
    pathname === "/auth/reset"
  );
}

function isProtectedAppRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/settings" || pathname.startsWith("/settings/");
}

function isOnboardingRoute(pathname: string): boolean {
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}

function asLowerString(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function asUpperString(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isUserSettingsSetupError(error: unknown): boolean {
  const direct = asObject(error);
  const cause = asObject(direct?.cause);

  const codeCandidates = [
    asUpperString(direct?.code),
    asUpperString(cause?.code),
  ].filter(Boolean);
  if (codeCandidates.some((code) => SETTINGS_SETUP_ERROR_CODES.has(code))) {
    return true;
  }

  const haystack = [
    asLowerString(direct?.message),
    asLowerString(cause?.message),
    asLowerString(cause?.details),
    asLowerString(cause?.hint),
  ]
    .filter(Boolean)
    .join(" | ");

  if (!haystack) {
    return false;
  }

  return (
    haystack.includes("user_settings") ||
    haystack.includes("could not find the table") ||
    haystack.includes("schema cache") ||
    haystack.includes("permission denied")
  );
}

export async function middleware(request: NextRequest) {
  if (isAuthBypassEnabled()) {
    return NextResponse.next();
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }

  const { url, anonKey } = getSupabasePublicConfig();
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const pathname = request.nextUrl.pathname;
  if (isAuthFlowRoute(pathname)) {
    return response;
  }

  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    if (isAuthRoute(pathname)) {
      return response;
    }
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  let canOpenApp = true;
  try {
    const accessRecord = await readUserAccessRecord(supabase, user.id);
    if (accessRecord) {
      canOpenApp = canUseApp(accessRecord);
    }
  } catch (error) {
    if (isUserAccessSetupError(error)) {
      logUserAccessError("middleware.readUserAccessRecord transient setup fallback", error, {
        userId: user.id,
        pathname,
      });
      canOpenApp = true;
    } else {
      logUserAccessError("middleware.readUserAccessRecord", error, {
        userId: user.id,
        pathname,
      });
      canOpenApp = false;
    }
  }

  let hasCompletedOnboarding = true;
  if (canOpenApp) {
    try {
      const { data, error } = await supabase
        .from("user_settings")
        .select("onboarding_completed")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        if (isUserSettingsSetupError(error)) {
          console.warn(
            "[middleware] user_settings onboarding status unavailable; allowing app access fallback",
            {
              userId: user.id,
              pathname,
              error,
            },
          );
          hasCompletedOnboarding = true;
        } else {
          console.error("[middleware] failed to read onboarding status", {
            userId: user.id,
            pathname,
            error,
          });
          hasCompletedOnboarding = true;
        }
      } else {
        hasCompletedOnboarding = Boolean(
          (data as { onboarding_completed?: unknown } | null)?.onboarding_completed,
        );
      }
    } catch (error) {
      console.error("[middleware] onboarding status read failed unexpectedly", {
        userId: user.id,
        pathname,
        error,
      });
      hasCompletedOnboarding = true;
    }
  }

  if (isAuthRoute(pathname)) {
    if (!canOpenApp) {
      return NextResponse.redirect(new URL("/upgrade", request.url));
    }

    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname === "/upgrade") {
    if (canOpenApp) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return response;
  }

  if (isProtectedAppRoute(pathname) && !canOpenApp) {
    return NextResponse.redirect(new URL("/upgrade", request.url));
  }

  if (!canOpenApp && isOnboardingRoute(pathname)) {
    return NextResponse.redirect(new URL("/upgrade", request.url));
  }

  if (canOpenApp && hasCompletedOnboarding && isOnboardingRoute(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/", "/settings/:path*", "/onboarding/:path*", "/auth/:path*", "/upgrade"],
};
