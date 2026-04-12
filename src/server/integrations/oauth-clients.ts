export const OAUTH_SCOPES = {
  knowledgeRead: "knowledge:read",
  knowledgeWriteInbox: "knowledge:write_inbox",
} as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[keyof typeof OAUTH_SCOPES];

const KNOSI_SCOPE_VALUES = Object.values(OAUTH_SCOPES);

function normalizeList(input: readonly string[] | string | null | undefined) {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\s,]+/)
      : [];

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function normalizeOAuthScopes(
  input: readonly string[] | string | null | undefined
) {
  const normalized = normalizeList(input);
  for (const scope of normalized) {
    if (!KNOSI_SCOPE_VALUES.includes(scope as OAuthScope)) {
      throw new Error(`Unsupported OAuth scope: ${scope}`);
    }
  }

  return normalized as OAuthScope[];
}

export function serializeOAuthScopes(
  input: readonly string[] | string | null | undefined
) {
  return normalizeOAuthScopes(input).join(" ");
}

export function parseOAuthScopes(input: string | null | undefined) {
  return normalizeOAuthScopes(input ?? "");
}

export type OAuthClientId = "anthropic-connector" | "knosi-cli";

export type OAuthClient = {
  clientId: OAuthClientId;
  displayName: string;
  allowedRedirectUris: string[];
  allowedScopes: OAuthScope[];
};

export const OAUTH_CLIENTS: Record<OAuthClientId, OAuthClient> = {
  "anthropic-connector": {
    clientId: "anthropic-connector",
    displayName: "Claude Web Connector",
    allowedRedirectUris: [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
    ],
    allowedScopes: [
      OAUTH_SCOPES.knowledgeRead,
      OAUTH_SCOPES.knowledgeWriteInbox,
    ],
  },
  "knosi-cli": {
    clientId: "knosi-cli",
    displayName: "Knosi CLI",
    allowedRedirectUris: [
      "http://localhost:6274/oauth/callback",
      "http://127.0.0.1:6274/oauth/callback",
    ],
    allowedScopes: [
      OAUTH_SCOPES.knowledgeRead,
      OAUTH_SCOPES.knowledgeWriteInbox,
    ],
  },
};

export function getOAuthClient(clientId: string): OAuthClient | null {
  return (OAUTH_CLIENTS as Record<string, OAuthClient>)[clientId] ?? null;
}

export function isAllowedOAuthRedirectUri(
  clientId: string,
  redirectUri: string
) {
  const client = getOAuthClient(clientId);
  if (!client) return false;
  return client.allowedRedirectUris.includes(redirectUri);
}

export function assertOAuthClientScopeBoundary(
  clientId: string,
  scopes: readonly string[] | string | null | undefined
) {
  const client = getOAuthClient(clientId);
  if (!client) {
    throw new Error(`Unknown OAuth client: ${clientId}`);
  }

  const normalizedScopes = normalizeOAuthScopes(scopes);
  const allowedScopes = new Set(client.allowedScopes);
  const disallowed = normalizedScopes.filter((scope) => !allowedScopes.has(scope));

  if (disallowed.length > 0) {
    throw new Error(
      `Client ${clientId} is not allowed to request scopes: ${disallowed.join(", ")}`
    );
  }

  return normalizedScopes;
}
