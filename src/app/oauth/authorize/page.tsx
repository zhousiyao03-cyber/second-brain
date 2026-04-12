import { redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import {
  getOAuthClient,
  isAllowedOAuthRedirectUri,
  normalizeOAuthScopes,
} from "@/server/integrations/oauth-clients";
import {
  approveOauthAuthorization,
  denyOauthAuthorization,
} from "./actions";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clientId = firstParam(params.client_id) ?? "";
  const redirectUri = firstParam(params.redirect_uri) ?? "";
  const scope = firstParam(params.scope) ?? "";
  const state = firstParam(params.state) ?? "";
  const responseType = firstParam(params.response_type) ?? "code";
  const codeChallenge = firstParam(params.code_challenge) ?? "";
  const codeChallengeMethod = firstParam(params.code_challenge_method) ?? "S256";
  const session = await getRequestSession();

  const currentQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const entry of value) currentQuery.append(key, entry);
    } else if (value) {
      currentQuery.set(key, value);
    }
  }

  if (!session?.user?.id) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${currentQuery.toString()}`)}`);
  }

  const client = getOAuthClient(clientId);
  const isValidRequest =
    responseType === "code" &&
    codeChallengeMethod === "S256" &&
    Boolean(client) &&
    Boolean(codeChallenge) &&
    isAllowedOAuthRedirectUri(clientId, redirectUri);

  const requestedScopes = isValidRequest
    ? normalizeOAuthScopes(scope)
    : [];
  const clientDisplayName = client?.displayName ?? "Unknown client";

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-12">
      <div className="w-full rounded-[28px] border border-stone-200 bg-white/95 p-8 shadow-[0_30px_120px_-80px_rgba(15,23,42,0.65)] dark:border-stone-800 dark:bg-stone-950/92">
        <p className="text-sm font-medium text-stone-500 dark:text-stone-400">
          Knosi OAuth
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
          {isValidRequest ? `Connect ${clientDisplayName}` : "Invalid authorization request"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-300">
          {isValidRequest
            ? `${clientDisplayName} wants permission to read your knowledge base and save explicit AI captures into your AI Inbox.`
            : "This connector request is missing required OAuth fields or uses an unsupported redirect URI."}
        </p>

        {isValidRequest ? (
          <>
            <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
              <div>
                <span className="font-medium text-stone-900 dark:text-stone-100">Signed in as:</span>{" "}
                {session.user?.email ?? session.user?.name ?? session.user?.id}
              </div>
              <div className="mt-2">
                <span className="font-medium text-stone-900 dark:text-stone-100">Redirect URI:</span>{" "}
                <span className="break-all">{redirectUri}</span>
              </div>
              <div className="mt-3">
                <span className="font-medium text-stone-900 dark:text-stone-100">Requested scopes:</span>
                <ul className="mt-2 space-y-1">
                  {requestedScopes.map((requestedScope) => (
                    <li key={requestedScope}>{requestedScope}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <form action={approveOauthAuthorization} className="flex-1">
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="redirectUri" value={redirectUri} />
                <input type="hidden" name="scope" value={scope} />
                <input type="hidden" name="state" value={state} />
                <input type="hidden" name="codeChallenge" value={codeChallenge} />
                <input type="hidden" name="codeChallengeMethod" value={codeChallengeMethod} />
                <button
                  type="submit"
                  className="w-full rounded-xl border border-stone-200 bg-stone-900 px-4 py-3 text-sm font-medium text-white hover:bg-stone-800 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
                >
                  Allow access
                </button>
              </form>

              <form action={denyOauthAuthorization} className="flex-1">
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="redirectUri" value={redirectUri} />
                <input type="hidden" name="scope" value={scope} />
                <input type="hidden" name="state" value={state} />
                <input type="hidden" name="codeChallenge" value={codeChallenge} />
                <input type="hidden" name="codeChallengeMethod" value={codeChallengeMethod} />
                <button
                  type="submit"
                  className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  Deny
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100">
            Check `client_id`, `redirect_uri`, `code_challenge`, and `code_challenge_method=S256`, then retry the authorization flow.
          </div>
        )}
      </div>
    </div>
  );
}
