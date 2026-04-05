import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  // E2E test bypass
  if (process.env.AUTH_BYPASS === "true") {
    return NextResponse.next();
  }

  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isPublicPath =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/focus/ingest") ||
    pathname.startsWith("/api/focus/status") ||
    pathname.startsWith("/api/focus/pair") ||
    pathname.startsWith("/api/usage") ||
    pathname.startsWith("/api/analysis") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon");

  if (!isLoggedIn && !isPublicPath) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
