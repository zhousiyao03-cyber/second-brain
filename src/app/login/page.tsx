import Link from "next/link";
import { signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppBrand } from "@/components/layout/app-brand";
import {
  DEV_TEST_ACCOUNT,
  ensureDevTestAccount,
} from "@/server/auth/dev-test-account";
import { getRequestSession } from "@/server/auth/request-session";
import { loginWithCredentials } from "./actions";

const errorMessages: Record<string, string> = {
  invalid: "Enter a valid email and password.",
  credentials: "Incorrect email or password.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const session = await getRequestSession();
  if (session) {
    redirect("/dashboard");
  }

  await ensureDevTestAccount();

  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorMessage = errorCode ? errorMessages[errorCode] : null;
  const showDevTestAccount = process.env.NODE_ENV === "development";

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10 dark:bg-stone-950">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-stone-200 bg-white p-8 shadow-lg dark:border-stone-800 dark:bg-stone-900">
        <div className="text-center">
          <div className="mb-4 flex justify-center">
            <AppBrand compact />
          </div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            Knosi
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            Sign in to your knowledge base
          </p>
        </div>

        {showDevTestAccount ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="font-medium">Development TEST account</div>
            <div className="mt-1">Email: {DEV_TEST_ACCOUNT.email}</div>
            <div>Password: {DEV_TEST_ACCOUNT.password}</div>
          </div>
        ) : null}

        <form action={loginWithCredentials} className="space-y-4">
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
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:border-stone-500"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-stone-700 dark:text-stone-200"
            >
              Password
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
            Sign in with email
          </button>
        </form>

        <div className="flex items-center gap-3 text-xs text-stone-400 dark:text-stone-500">
          <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
          Or
          <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
        </div>

        <div className="space-y-3">
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/dashboard" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              Continue with GitHub
            </button>
          </form>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
            >
              Continue with Google
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-stone-500 dark:text-stone-400">
          No account?
          <Link
            href="/register"
            className="ml-1 font-medium text-stone-900 underline-offset-4 hover:underline dark:text-stone-100"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
