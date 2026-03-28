import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { getDatabaseUrl } from "./path";
import * as schema from "./schema";

const databaseUrl = getDatabaseUrl();

const client = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
