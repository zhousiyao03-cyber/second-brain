"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import { normalizeEmail } from "@/server/auth/password";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  next: z.string().trim().optional().default(""),
});

export async function loginWithCredentials(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid");
  }

  const redirectTo = parsed.data.next || "/dashboard";

  try {
    await signIn("credentials", {
      email: normalizeEmail(parsed.data.email),
      password: parsed.data.password,
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError && error.type === "CredentialsSignin") {
      const nextQuery = parsed.data.next
        ? `&next=${encodeURIComponent(parsed.data.next)}`
        : "";
      redirect(`/login?error=credentials${nextQuery}`);
    }

    throw error;
  }

  redirect(redirectTo);
}
