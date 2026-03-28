"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hashPassword, normalizeEmail, verifyPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { userCredentials, users } from "@/server/db/schema";

const profileSchema = z.object({
  name: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().email(),
});

const passwordSchema = z.object({
  currentPassword: z.string().optional().default(""),
  newPassword: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
});

async function requireSessionUser() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return session.user.id;
}

export async function updateAccountProfile(formData: FormData) {
  const userId = await requireSessionUser();
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });

  if (!parsed.success) {
    redirect("/settings?profileError=invalid");
  }

  const email = normalizeEmail(parsed.data.email);
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, userId)))
    .limit(1);

  if (existingUser) {
    redirect("/settings?profileError=email-exists");
  }

  await db
    .update(users)
    .set({
      name: parsed.data.name || null,
      email,
    })
    .where(eq(users.id, userId));

  await db
    .update(userCredentials)
    .set({
      email,
      updatedAt: new Date(),
    })
    .where(eq(userCredentials.userId, userId));

  redirect("/settings?profileStatus=updated");
}

export async function updateAccountPassword(formData: FormData) {
  const userId = await requireSessionUser();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    redirect("/settings?passwordError=invalid");
  }

  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    redirect("/settings?passwordError=password-mismatch");
  }

  const [userRecord] = await db
    .select({
      email: users.email,
      passwordHash: userCredentials.passwordHash,
    })
    .from(users)
    .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRecord?.email) {
    redirect("/settings?passwordError=email-missing");
  }

  if (userRecord.passwordHash) {
    if (!parsed.data.currentPassword) {
      redirect("/settings?passwordError=current-password");
    }

    const isValid = await verifyPassword(
      parsed.data.currentPassword,
      userRecord.passwordHash
    );

    if (!isValid) {
      redirect("/settings?passwordError=current-password");
    }

    await db
      .update(userCredentials)
      .set({
        passwordHash: await hashPassword(parsed.data.newPassword),
        updatedAt: new Date(),
      })
      .where(eq(userCredentials.userId, userId));
  } else {
    await db.insert(userCredentials).values({
      userId,
      email: normalizeEmail(userRecord.email),
      passwordHash: await hashPassword(parsed.data.newPassword),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  redirect("/settings?passwordStatus=updated");
}
