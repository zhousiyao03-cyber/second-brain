import { auth } from "@/lib/auth";
import { isAuthBypassEnabled } from "./bypass";

export { isAuthBypassEnabled };

export type RequestSession = {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  };
} | null;

function buildBypassSession(): RequestSession {
  return {
    user: {
      id: process.env.AUTH_BYPASS_USER_ID ?? "test-user",
      name: process.env.AUTH_BYPASS_NAME ?? "E2E Test User",
      email: process.env.AUTH_BYPASS_EMAIL ?? "e2e@test.local",
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } as RequestSession;
}

export async function getRequestSession(): Promise<RequestSession> {
  if (isAuthBypassEnabled()) {
    return buildBypassSession();
  }

  return (await auth()) as RequestSession;
}
