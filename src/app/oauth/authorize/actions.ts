"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getRequestSession } from "@/server/auth/request-session";
import {
  approveAuthorizationCode,
  issueAuthorizationCode,
} from "@/server/integrations/oauth";
import {
  getOAuthClient,
  normalizeOAuthScopes,
} from "@/server/integrations/oauth-clients";

const authorizeSchema = z.object({
  clientId: z.string().trim().min(1),
  redirectUri: z.string().trim().url(),
  scope: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
  codeChallenge: z.string().trim().min(1),
  codeChallengeMethod: z.literal("S256").default("S256"),
});

function appendAuthorizeResult(
  redirectUri: string,
  values: Record<string, string | undefined>
) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function requireAuthorizeSession() {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user.id;
}

export async function approveOauthAuthorization(formData: FormData) {
  const parsed = authorizeSchema.safeParse({
    clientId: formData.get("clientId"),
    redirectUri: formData.get("redirectUri"),
    scope: formData.get("scope"),
    state: formData.get("state"),
    codeChallenge: formData.get("codeChallenge"),
    codeChallengeMethod: formData.get("codeChallengeMethod"),
  });

  if (!parsed.success) {
    redirect("/login");
  }

  const client = await getOAuthClient(parsed.data.clientId);
  if (!client) {
    redirect("/login");
  }

  const userId = await requireAuthorizeSession();
  const issued = await issueAuthorizationCode({
    clientId: parsed.data.clientId,
    redirectUri: parsed.data.redirectUri,
    scopes: normalizeOAuthScopes(parsed.data.scope),
    codeChallenge: parsed.data.codeChallenge,
    codeChallengeMethod: parsed.data.codeChallengeMethod,
  });

  await approveAuthorizationCode({
    authorizationCode: issued.authorizationCode,
    userId,
  });

  redirect(
    appendAuthorizeResult(parsed.data.redirectUri, {
      code: issued.authorizationCode,
      state: parsed.data.state || undefined,
    })
  );
}

export async function denyOauthAuthorization(formData: FormData) {
  const parsed = authorizeSchema.safeParse({
    clientId: formData.get("clientId"),
    redirectUri: formData.get("redirectUri"),
    scope: formData.get("scope"),
    state: formData.get("state"),
    codeChallenge: formData.get("codeChallenge"),
    codeChallengeMethod: formData.get("codeChallengeMethod"),
  });

  if (!parsed.success) {
    redirect("/dashboard");
  }

  redirect(
    appendAuthorizeResult(parsed.data.redirectUri, {
      error: "access_denied",
      state: parsed.data.state || undefined,
    })
  );
}
