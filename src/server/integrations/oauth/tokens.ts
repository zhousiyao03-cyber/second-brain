import crypto from "node:crypto";
import { OAuthError } from "./types";

const AUTHORIZATION_CODE_PREFIX = "koa";
const ACCESS_TOKEN_PREFIX = "kat";
const REFRESH_TOKEN_PREFIX = "krt";

function getTokenValue(prefix: string, randomBytes: typeof crypto.randomBytes) {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

export function createOAuthAuthorizationCode(
  randomBytes: typeof crypto.randomBytes = crypto.randomBytes
) {
  return getTokenValue(AUTHORIZATION_CODE_PREFIX, randomBytes);
}

export function createOAuthAccessToken(
  randomBytes: typeof crypto.randomBytes = crypto.randomBytes
) {
  return getTokenValue(ACCESS_TOKEN_PREFIX, randomBytes);
}

export function createOAuthRefreshToken(
  randomBytes: typeof crypto.randomBytes = crypto.randomBytes
) {
  return getTokenValue(REFRESH_TOKEN_PREFIX, randomBytes);
}

export function hashOAuthToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getOAuthTokenPreview(token: string) {
  return token.slice(-6);
}

export function parseBearerToken(authorization: string | null | undefined) {
  const value = authorization?.trim();
  if (!value || !value.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return value.slice("bearer ".length).trim() || null;
}

function isPkceVerifier(verifier: string) {
  return /^[A-Za-z0-9-._~]{43,128}$/.test(verifier);
}

export function createPkceCodeChallenge(verifier: string) {
  const trimmed = verifier.trim();
  if (!isPkceVerifier(trimmed)) {
    throw new OAuthError(
      "invalid_pkce_verifier",
      "PKCE code verifier must be 43-128 characters using the unreserved charset."
    );
  }

  return crypto.createHash("sha256").update(trimmed).digest("base64url");
}

export function verifyPkceCodeVerifier(verifier: string, challenge: string) {
  return createPkceCodeChallenge(verifier) === challenge;
}
