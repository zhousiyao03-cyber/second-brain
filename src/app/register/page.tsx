import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { registerWithCredentials } from "./actions";

const errorMessages: Record<string, string> = {
  invalid: "请检查输入项后重试",
  "password-mismatch": "两次输入的密码不一致",
  "email-exists": "该邮箱已注册，请直接登录",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorMessage = errorCode ? errorMessages[errorCode] : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10 dark:bg-stone-950">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-stone-200 bg-white p-8 shadow-lg dark:border-stone-800 dark:bg-stone-900">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-stone-200 text-lg font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
            S
          </div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            创建 Second Brain 账号
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            先注册，再直接进入你的知识库
          </p>
        </div>

        <form action={registerWithCredentials} className="space-y-4">
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
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-stone-500"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-stone-700 dark:text-stone-200"
            >
              密码
            </label>
            <input
              id="password"
              name="password"
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
              确认密码
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

          {errorMessage ? (
            <p
              aria-live="polite"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
            >
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            创建账号
          </button>
        </form>

        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-stone-400 dark:text-stone-500">
            <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
            或者
            <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
          </div>

          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
            >
              使用 GitHub 继续
            </button>
          </form>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
            >
              使用 Google 继续
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-stone-500 dark:text-stone-400">
          已有账号？
          <Link
            href="/login"
            className="ml-1 font-medium text-stone-900 underline-offset-4 hover:underline dark:text-stone-100"
          >
            去登录
          </Link>
        </p>
      </div>
    </div>
  );
}
