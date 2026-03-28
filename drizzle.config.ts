import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl, isTursoDatabaseUrl } from "./src/server/db/path";

const databaseUrl = getDatabaseUrl();
const isTurso = isTursoDatabaseUrl(databaseUrl);

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  ...(isTurso
    ? {
        driver: "turso" as never,
        dbCredentials: {
          url: databaseUrl,
          authToken: process.env.TURSO_AUTH_TOKEN,
        },
      }
    : {
        dbCredentials: {
          url: databaseUrl,
        },
      }),
});
