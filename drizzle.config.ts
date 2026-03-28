import { defineConfig } from "drizzle-kit";

const isTurso = process.env.TURSO_DATABASE_URL?.startsWith("libsql://");

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  ...(isTurso
    ? {
        driver: "turso" as never,
        dbCredentials: {
          url: process.env.TURSO_DATABASE_URL!,
          authToken: process.env.TURSO_AUTH_TOKEN,
        },
      }
    : {
        dbCredentials: {
          url: process.env.TURSO_DATABASE_URL ?? "file:data/second-brain.db",
        },
      }),
});
