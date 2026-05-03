import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const env = readFileSync("/Users/bytedance/knosi/.env.turso-prod.local", "utf8");
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1]?.trim();
const token = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1]?.trim();

const c = createClient({ url, authToken: token });

const sql = process.argv[2];
const r = await c.execute(sql);
console.log(JSON.stringify({ rows: r.rows, columns: r.columns }, null, 2));
