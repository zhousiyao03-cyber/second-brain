/**
 * SSRF-safe fetch wrapper for user-supplied URLs.
 *
 * Threat model: an authenticated user submits an arbitrary URL string (e.g.
 * for `bookmarks.create`/`bookmarks.refetch`). The server then fetches it for
 * scraping. Without filtering, the user can point the server at:
 *
 *   - cloud metadata services (`169.254.169.254` on AWS/Hetzner local-IPv4)
 *   - same-host services (`127.0.0.1:11434` Ollama, k3s API, Drizzle Studio, …)
 *   - other private RFC1918 hosts on the cluster network
 *   - non-HTTP schemes (`file:`, `gopher:`, `data:`, `ftp:`, …)
 *
 * Defenses applied here:
 *
 *   1. Protocol allowlist: only `http:` and `https:` are accepted.
 *   2. DNS pre-resolution: every A/AAAA record is checked against private /
 *      loopback / link-local / metadata ranges before opening a socket.
 *   3. Redirect bounding: `redirect: "manual"` + a bounded chain (max 5 hops)
 *      where each hop's target URL is re-validated. This closes the
 *      "public host 302s to private host" bypass.
 *
 * What this does NOT close: a TOCTOU between DNS-lookup and connect (DNS
 * rebinding). For a stronger defense, install an undici Agent with a
 * `connect` callback that re-checks the resolved socket address. We're not
 * doing that here because the project does not currently take undici as a
 * direct dependency. Open as a follow-up if the threat actor model warrants.
 */

import { isIP } from "node:net";
import dns from "node:dns/promises";

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`Blocked outbound fetch: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

const MAX_REDIRECTS = 5;

/**
 * Returns true for IP addresses that must never be the target of a server-
 * side fetch driven by user input. Covers IPv4 + IPv6 forms of:
 *
 *   - loopback (127.0.0.0/8, ::1)
 *   - any/wildcard (0.0.0.0, ::)
 *   - link-local (169.254.0.0/16 incl. cloud metadata, fe80::/10)
 *   - RFC1918 private (10/8, 172.16/12, 192.168/16)
 *   - CGNAT shared (100.64/10) — also routed inside many private networks
 *   - unique-local IPv6 (fc00::/7)
 *   - IPv4-mapped IPv6 forms of all of the above
 */
export function isBlockedIp(address: string): boolean {
  const v = isIP(address);
  if (v === 4) return isBlockedIpv4(address);
  if (v === 6) return isBlockedIpv6(address);
  return true; // unparseable address — fail closed
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return true;
  const [a, b] = parts.map((p) => Number(p));
  if (Number.isNaN(a) || Number.isNaN(b)) return true;

  // 0.0.0.0/8 — "this network" wildcard
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC1918
  if (a === 10) return true;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local incl. cloud IMDS (169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — RFC1918
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmarking, often routable inside labs
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const lowered = address.toLowerCase();
  // ::1, ::, :: with zone id
  if (lowered === "::1" || lowered === "::" || lowered.startsWith("::1%")) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-validate as IPv4
  const mapped = lowered.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  // fe80::/10 link-local AND fec0::/10 deprecated site-local. Match the
  // whole fe80–feff range so anything in IPv6's reserved-private space is
  // refused.
  if (/^fe[89a-f][0-9a-f]:/i.test(lowered)) return true;
  // fc00::/7 unique-local
  if (/^f[cd][0-9a-f]{2}:/i.test(lowered)) return true;
  return false;
}

async function assertHostIsPublic(hostname: string): Promise<void> {
  // Hostnames may already be IP literals. dns.lookup accepts both.
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new SsrfBlockedError(`could not resolve host: ${hostname}`);
  }
  for (const r of records) {
    if (isBlockedIp(r.address)) {
      throw new SsrfBlockedError(
        `host ${hostname} resolves to private/loopback/metadata IP ${r.address}`
      );
    }
  }
}

function assertProtocolIsAllowed(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(
      `unsupported protocol "${url.protocol}" — only http(s) allowed`
    );
  }
}

/**
 * Runs the DNS + protocol checks on the parsed URL. Throws SsrfBlockedError
 * on rejection. Exported separately so callers can validate a URL without
 * issuing a fetch (e.g. cron jobs that pre-screen DB-stored URLs).
 */
export async function assertUrlIsSafeToFetch(url: URL): Promise<void> {
  assertProtocolIsAllowed(url);
  await assertHostIsPublic(url.hostname);
}

export interface SafeFetchOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Fetch wrapper that:
 *  1. validates the initial URL,
 *  2. issues fetch with `redirect: "manual"`,
 *  3. on 3xx, re-validates the Location target and refetches,
 *  4. caps redirects at MAX_REDIRECTS.
 *
 * Returns the final Response on the first non-redirect status. Throws
 * SsrfBlockedError at any hop that fails the validation. Other fetch errors
 * propagate.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`invalid URL: ${rawUrl}`);
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrlIsSafeToFetch(currentUrl);

    const response = await fetch(currentUrl, {
      signal: options.signal,
      headers: options.headers,
      redirect: "manual",
    });

    // Only follow 301/302/303/307/308 redirects. Other 3xx (304 etc.) are
    // returned as-is.
    const isRedirect =
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308;
    if (!isRedirect) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) return response;

    let next: URL;
    try {
      next = new URL(location, currentUrl);
    } catch {
      throw new SsrfBlockedError(`invalid redirect target: ${location}`);
    }
    currentUrl = next;
  }

  throw new SsrfBlockedError(`exceeded ${MAX_REDIRECTS} redirects`);
}
