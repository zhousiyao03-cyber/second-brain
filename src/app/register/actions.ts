"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import { hashPassword, normalizeEmail } from "@/server/auth/password";
import { db } from "@/server/db";
import { userCredentials, users } from "@/server/db/schema";

const registerSchema = z.object({
  name: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
});

export async function registerWithCredentials(formData: FormData) {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    redirect("/register?error=invalid");
  }

  if (parsed.data.password !== parsed.data.confirmPassword) {
    redirect("/register?error=password-mismatch");
  }

  const email = normalizeEmail(parsed.data.email);
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingUser) {
    redirect("/register?error=email-exists");
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(parsed.data.password);

  await db.insert(users).values({
    id: userId,
    name: parsed.data.name || null,
    email,
  });

  await db.insert(userCredentials).values({
    userId,
    email,
    passwordHash,
  });

  await signIn("credentials", {
    email,
    password: parsed.data.password,
    redirectTo: "/",
  });

  redirect("/");
}
