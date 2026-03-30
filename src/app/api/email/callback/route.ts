import { NextResponse } from "next/server";
import { handleEmailCallback } from "@/lib/email-oauth";

export async function GET(request: Request) {
  const result = await handleEmailCallback(request);
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
