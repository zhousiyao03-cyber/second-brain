import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { hasTable } from "@/server/db/metadata";
import { userCredentials, users } from "@/server/db/schema";
import { updateAccountPassword, updateAccountProfile } from "./actions";

const profileErrorMessages: Record<string, string> = {
  invalid: "请检查昵称和邮箱后重试",
  "email-exists": "这个邮箱已经被其他账号使用",
};

const profileStatusMessages: Record<string, string> = {
  updated: "账号信息已更新",
};

const passwordErrorMessages: Record<string, string> = {
  invalid: "请检查密码输入后重试",
  "password-mismatch": "两次输入的新密码不一致",
  "current-password": "当前密码不正确",
  "email-missing": "当前账号缺少邮箱，暂时无法设置本地密码",
  unavailable: "当前环境暂未启用本地密码管理",
};

const passwordStatusMessages: Record<string, string> = {
  updated: "密码已更新",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();

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
  const hasPassword = credentialsTableAvailable && Boolean(userRecord.passwordHash);
  const passwordDescription = !credentialsTableAvailable
    ? "当前环境暂未启用本地密码管理，账号信息仍可正常维护。"
    : hasPassword
      ? "修改本地登录密码时，需要先验证当前密码。"
      : "当前账号还没有设置本地密码，保存后即可用邮箱 + 密码登录。";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">账号设置</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          在这里维护你的昵称、登录邮箱和本地密码。
        </p>
      </div>

      <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            账号信息
          </h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            昵称主要用于个性化展示；邮箱会作为本地登录账号。
          </p>
        </div>

        <form action={updateAccountProfile} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="name"
              className="text-sm font-medium text-stone-700 dark:text-stone-200"
            >
              昵称
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
              邮箱
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
            保存账号信息
          </button>
        </form>
      </section>

      <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">密码</h2>
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
                  当前密码
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
                新密码
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
                确认新密码
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
              更新密码
            </button>
          </form>
        ) : (
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
            当前环境暂未启用本地密码管理；如果这是生产环境，请同步最新数据库 schema 后再开启。
          </div>
        )}
      </section>
    </div>
  );
}
