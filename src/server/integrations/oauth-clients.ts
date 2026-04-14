import { eq } from "drizzle-orm";

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

export type OAuthClient = {
  clientId: string;
  displayName: string;
  allowedRedirectUris: string[];
  allowedScopes: OAuthScope[];
};

const STATIC_OAUTH_CLIENTS: Record<string, OAuthClient> = {
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

export function getStaticOAuthClient(clientId: string): OAuthClient | null {
  return STATIC_OAUTH_CLIENTS[clientId] ?? null;
}

async function getDynamicOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const { db } = await import("../db/index");
  const { oauthClients } = await import("../db/schema");

  const [row] = await (db as unknown as {
    select: (shape: unknown) => {
      from: (table: unknown) => {
        where: (clause: unknown) => {
          limit: (n: number) => Promise<
            Array<{
              clientId: string;
              clientName: string;
              redirectUris: string;
              allowedScopes: string;
            }>
          >;
        };
      };
    };
  })
    .select({
      clientId: oauthClients.clientId,
      clientName: oauthClients.clientName,
      redirectUris: oauthClients.redirectUris,
      allowedScopes: oauthClients.allowedScopes,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);

  if (!row) return null;

  return {
    clientId: row.clientId,
    displayName: row.clientName,
    allowedRedirectUris: JSON.parse(row.redirectUris) as string[],
    allowedScopes: normalizeOAuthScopes(row.allowedScopes),
  };
}

export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const staticClient = getStaticOAuthClient(clientId);
  if (staticClient) return staticClient;
  return getDynamicOAuthClient(clientId);
}

export async function isAllowedOAuthRedirectUri(
  clientId: string,
  redirectUri: string
): Promise<boolean> {
  const client = await getOAuthClient(clientId);
  if (!client) return false;
  return client.allowedRedirectUris.includes(redirectUri);
}

export async function assertOAuthClientScopeBoundary(
  clientId: string,
  scopes: readonly string[] | string | null | undefined
): Promise<OAuthScope[]> {
  const client = await getOAuthClient(clientId);
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
