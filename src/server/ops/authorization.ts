type OpsSessionLike = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

export type OpsOwnerAccess =
  | { allowed: true; reason: null }
  | {
      allowed: false;
      reason: "missing-session" | "missing-owner-config" | "not-owner";
    };

function readOwnerEmail() {
  const email = process.env.OPS_OWNER_EMAIL?.trim().toLowerCase() ?? "";
  return email.length > 0 ? email : null;
}

export function getOpsOwnerAccess(session: OpsSessionLike): OpsOwnerAccess {
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  if (!session?.user?.id || sessionEmail.length === 0) {
    return { allowed: false, reason: "missing-session" };
  }

  const ownerEmail = readOwnerEmail();
  if (!ownerEmail) {
    return { allowed: false, reason: "missing-owner-config" };
  }

  if (sessionEmail !== ownerEmail) {
    return { allowed: false, reason: "not-owner" };
  }

  return { allowed: true, reason: null };
}
