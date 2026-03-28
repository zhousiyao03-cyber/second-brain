import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { userCredentials, users } from "@/server/db/schema";
import { hashPassword, normalizeEmail, verifyPassword } from "./password";

export const DEV_TEST_ACCOUNT = {
  name: "TEST",
  email: "test@secondbrain.local",
  password: "test123456",
} as const;

let ensurePromise: Promise<typeof DEV_TEST_ACCOUNT | null> | null = null;

async function ensureDevTestAccountInner() {
  const email = normalizeEmail(DEV_TEST_ACCOUNT.email);
  const [existingUser] = await db
    .select({
      id: users.id,
      name: users.name,
      passwordHash: userCredentials.passwordHash,
    })
    .from(users)
    .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(eq(users.email, email))
    .limit(1);

  if (!existingUser) {
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(DEV_TEST_ACCOUNT.password);

    await db.insert(users).values({
      id: userId,
      name: DEV_TEST_ACCOUNT.name,
      email,
    });

    await db.insert(userCredentials).values({
      userId,
      email,
      passwordHash,
    });

    return DEV_TEST_ACCOUNT;
  }

  if (existingUser.name !== DEV_TEST_ACCOUNT.name) {
    await db
      .update(users)
      .set({ name: DEV_TEST_ACCOUNT.name })
      .where(eq(users.id, existingUser.id));
  }

  if (!existingUser.passwordHash) {
    await db.insert(userCredentials).values({
      userId: existingUser.id,
      email,
      passwordHash: await hashPassword(DEV_TEST_ACCOUNT.password),
    });

    return DEV_TEST_ACCOUNT;
  }

  const matchesExpectedPassword = await verifyPassword(
    DEV_TEST_ACCOUNT.password,
    existingUser.passwordHash
  );

  if (!matchesExpectedPassword) {
    await db
      .update(userCredentials)
      .set({
        email,
        passwordHash: await hashPassword(DEV_TEST_ACCOUNT.password),
        updatedAt: new Date(),
      })
      .where(eq(userCredentials.userId, existingUser.id));
  }

  return DEV_TEST_ACCOUNT;
}

export async function ensureDevTestAccount() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  ensurePromise ??= ensureDevTestAccountInner().finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}
