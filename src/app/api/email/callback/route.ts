import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/access/guards";
import { handleEmailCallback } from "@/lib/email-oauth";

export async function GET(request: Request) {
  const accessResult = await requireAppAccess();
  if (!accessResult.ok) {
    return accessResult.response;
  }

  const result = await handleEmailCallback(request, accessResult.user.id);
  const response = NextResponse.redirect(new URL(result.redirectPath, request.url));
  if (result.clearCookieName) {
    response.cookies.set({
      name: result.clearCookieName,
      value: "",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
    });
  }
  return response;
}
