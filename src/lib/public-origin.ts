/**
 * Derive the public-facing origin (scheme + host) for the current request.
 *
 * Inside the k3s pod the Next.js listener binds to `http://0.0.0.0:3000`, so
 * `request.nextUrl.origin` leaks that internal address into any URL we build
 * from it (OAuth discovery metadata, WWW-Authenticate challenges, etc.). The
 * public-facing origin lives in one of three places:
 *
 *   1. `X-Forwarded-Proto` + `X-Forwarded-Host` — Caddy + Traefik both set
 *      these automatically, so this is the most accurate signal at runtime.
 *   2. `AUTH_URL` env var — already configured for NextAuth; canonical.
 *   3. `request.nextUrl.origin` — last-resort dev fallback.
 */
export function getPublicOrigin(request: Request): string {
  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");

  if (forwardedHost && forwardedProto) {
    const proto = forwardedProto.split(",")[0]!.trim();
    const host = forwardedHost.split(",")[0]!.trim();
    if (proto && host) {
      return `${proto}://${host}`;
    }
  }

  const authUrl = process.env.AUTH_URL;
  if (authUrl) {
    try {
      return new URL(authUrl).origin;
    } catch {
      // fall through to request origin
    }
  }

  return new URL(request.url).origin;
}
