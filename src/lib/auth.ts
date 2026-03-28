import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, userCredentials, users } from "@/server/db/schema";
import { normalizeEmail, verifyPassword } from "@/server/auth/password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
  }),
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID ?? "github-client-id",
      clientSecret: process.env.AUTH_GITHUB_SECRET ?? "github-client-secret",
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "google-client-id",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "google-client-secret",
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = normalizeEmail(String(credentials?.email ?? ""));
        const password = String(credentials?.password ?? "");

        if (!email || !password) {
          return null;
        }

        const [userRecord] = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            image: users.image,
            passwordHash: userCredentials.passwordHash,
          })
          .from(userCredentials)
          .innerJoin(users, eq(users.id, userCredentials.userId))
          .where(eq(userCredentials.email, email))
          .limit(1);

        if (!userRecord) {
          return null;
        }

        const isValid = await verifyPassword(password, userRecord.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: userRecord.id,
          name: userRecord.name,
          email: userRecord.email,
          image: userRecord.image,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
