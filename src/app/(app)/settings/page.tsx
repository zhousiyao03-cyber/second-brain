import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import { db } from "@/server/db";
import { hasTable } from "@/server/db/metadata";
import {
  oauthAccessTokens,
  oauthRefreshTokens,
  userCredentials,
  users,
} from "@/server/db/schema";
import { updateAccountPassword, updateAccountProfile } from "./actions";
import { AnalysisPromptsSection } from "./analysis-prompts-section";
import { ConnectedAiClientsSection } from "./connected-ai-clients-section";

const profileErrorMessages: Record<string, string> = {
  invalid: "Check your name and email, then try again.",
  "email-exists": "This email is already being used by another account.",
};

const profileStatusMessages: Record<string, string> = {
  updated: "Account details updated.",
};

const passwordErrorMessages: Record<string, string> = {
  invalid: "Check your password inputs and try again.",
  "password-mismatch": "The new passwords do not match.",
  "current-password": "Your current password is incorrect.",
  "email-missing": "This account has no email, so local password setup is unavailable.",
  unavailable: "Local password management is not enabled in this environment.",
};

const passwordStatusMessages: Record<string, string> = {
  updated: "Password updated.",
};

const aiClientStatusMessages: Record<string, string> = {
  revoked: "AI client access revoked.",
  invalid: "Could not revoke that AI client credential.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getRequestSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const credentialsTableAvailable = await hasTable("user_credentials");
  const [userRecord] = credentialsTableAvailable
    ? await db
        .select({
          name: users.name,
          email: users.email,
          passwordHash: userCredentials.passwordHash,
        })
        .from(users)
        .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
        .where(eq(users.id, session.user.id))
        .limit(1)
    : await db
        .select({
          name: users.name,
          email: users.email,
          passwordHash: sql<string | null>`null`,
        })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

  if (!userRecord) {
    redirect("/login");
  }

  const params = await searchParams;
  const getParam = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const profileMessage =
    profileStatusMessages[getParam("profileStatus") ?? ""] ??
    profileErrorMessages[getParam("profileError") ?? ""] ??
    null;
  const passwordMessage =
    passwordStatusMessages[getParam("passwordStatus") ?? ""] ??
    passwordErrorMessages[getParam("passwordError") ?? ""] ??
    null;
  const aiClientsMessage =
    aiClientStatusMessages[getParam("aiClientsStatus") ?? ""] ?? null;
  const hasPassword = credentialsTableAvailable && Boolean(userRecord.passwordHash);
  const aiClientTablesAvailable =
    (await hasTable("oauth_access_tokens")) &&
    (await hasTable("oauth_refresh_tokens"));
  const [accessTokenRows, refreshTokenRows] = aiClientTablesAvailable
    ? await Promise.all([
        db
          .select({
            id: oauthAccessTokens.id,
            clientId: oauthAccessTokens.clientId,
            tokenPreview: oauthAccessTokens.tokenPreview,
            scopes: oauthAccessTokens.scopes,
            createdAt: oauthAccessTokens.createdAt,
            revokedAt: oauthAccessTokens.revokedAt,
          })
          .from(oauthAccessTokens)
          .where(eq(oauthAccessTokens.userId, session.user.id)),
        db
          .select({
            id: oauthRefreshTokens.id,
            clientId: oauthRefreshTokens.clientId,
            tokenPreview: oauthRefreshTokens.tokenPreview,
            scopes: oauthRefreshTokens.scopes,
            createdAt: oauthRefreshTokens.createdAt,
            revokedAt: oauthRefreshTokens.revokedAt,
          })
          .from(oauthRefreshTokens)
          .where(eq(oauthRefreshTokens.userId, session.user.id)),
      ])
    : [[], []];
  const passwordDescription = !credentialsTableAvailable
    ? "Local password management is not enabled here, but you can still update your account details."
    : hasPassword
      ? "Enter your current password before setting a new local password."
      : "This account does not have a local password yet. Save one to sign in with email and password.";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Account settings</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Update your name, sign-in email, and local password here.
        </p>
      </div>

      <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            Profile
          </h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Your name is used for personalization, and your email is used for local sign-in.
          </p>
        </div>

        <form action={updateAccountProfile} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="name"
              className="text-sm font-medium text-stone-700 dark:text-stone-200"
            >
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={userRecord.name ?? ""}
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-stone-500"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium text-stone-700 dark:text-stone-200"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              defaultValue={userRecord.email ?? ""}
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-stone-500"
            />
          </div>

          {profileMessage ? (
            <p
              aria-live="polite"
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"
            >
              {profileMessage}
            </p>
          ) : null}

          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            Save profile
          </button>
        </form>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Password</h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            {passwordDescription}
          </p>
        </div>

        {credentialsTableAvailable ? (
          <form action={updateAccountPassword} className="space-y-4">
            {hasPassword ? (
              <div className="space-y-2">
                <label
                  htmlFor="currentPassword"
                  className="text-sm font-medium text-stone-700 dark:text-stone-200"
                >
                  Current password
                </label>
                <input
                  id="currentPassword"
                  name="currentPassword"
                  type="password"
                  minLength={8}
                  required
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-stone-500"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <label
                htmlFor="newPassword"
                className="text-sm font-medium text-stone-700 dark:text-stone-200"
              >
                New password
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                minLength={8}
                required
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-stone-500"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="text-sm font-medium text-stone-700 dark:text-stone-200"
              >
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                minLength={8}
                required
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-stone-500"
              />
            </div>

            {passwordMessage ? (
              <p
                aria-live="polite"
                className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"
              >
                {passwordMessage}
              </p>
            ) : null}

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              Update password
            </button>
          </form>
        ) : (
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
            Local password management is not enabled in this environment. If this is production, sync the latest database schema first.
          </div>
        )}
      </section>

      <ConnectedAiClientsSection
        schemaAvailable={aiClientTablesAvailable}
        statusMessage={aiClientsMessage}
        connections={[
          ...refreshTokenRows.map((row) => ({
            ...row,
            tokenType: "refresh" as const,
          })),
          ...accessTokenRows.map((row) => ({
            ...row,
            tokenType: "access" as const,
          })),
        ].sort(
          (left, right) =>
            (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0)
        )}
      />

      <AnalysisPromptsSection />
    </div>
  );
}
