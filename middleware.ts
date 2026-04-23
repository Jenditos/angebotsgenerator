import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { isAuthBypassEnabled } from "@/lib/access/auth-bypass";
import { isUserAccessSetupError, logUserAccessError } from "@/lib/access/access-errors";
import { canUseApp, readUserAccessRecord } from "@/lib/access/user-access";
import { getSupabasePublicConfig, isSupabaseConfigured } from "@/lib/supabase/config";

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

  if (isAuthRoute(pathname)) {
    return NextResponse.redirect(new URL(canOpenApp ? "/" : "/upgrade", request.url));
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

  return response;
}

export const config = {
  matcher: ["/", "/settings/:path*", "/auth/:path*", "/upgrade"],
};
