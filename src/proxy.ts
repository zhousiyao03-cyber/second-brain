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
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/pricing" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/oauth/authorize") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon") ||
    pathname.startsWith("/149e9513-01fa-4fb0-aad4-566afd725d1b/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/oauth/") ||
    pathname === "/api/mcp" ||
    pathname === "/api/integrations/ai-captures" ||
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname.startsWith("/api/focus/ingest") ||
    pathname.startsWith("/api/focus/status") ||
    pathname.startsWith("/api/focus/pair") ||
    pathname.startsWith("/api/cli/auth/") ||
    pathname.startsWith("/api/usage") ||
    pathname.startsWith("/api/analysis") ||
    pathname.startsWith("/api/daemon/") ||
    pathname === "/api/chat/claim" ||
    pathname === "/api/chat/progress" ||
    pathname === "/api/chat/complete" ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/jobs/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon");

  if (!isLoggedIn && !isPublicPath) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    const next = `${pathname}${req.nextUrl.search}`;
    if (next && next !== "/login") {
      loginUrl.searchParams.set("next", next);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|webmanifest)$).*)",
  ],
};
