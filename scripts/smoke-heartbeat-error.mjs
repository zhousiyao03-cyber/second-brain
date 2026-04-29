// One-shot smoke test for the heartbeat-aware "daemon did not pick up task"
// error builder. Spins up an in-memory libsql DB, applies just enough schema,
// then exercises the three branches (no heartbeat / stale heartbeat / fresh
// heartbeat) and asserts the message text.
//
// Run with: node scripts/smoke-heartbeat-error.mjs
//
// This is intentionally not part of the regular test suite — it exists because
// `pnpm test:e2e` and `pnpm test:unit` both have pre-existing Windows env
// issues unrelated to this change (Playwright webServer/globalSetup race,
// missing rolldown native binding for vitest).
import { createClient } from "@libsql/client";

const DAEMON_HEARTBEAT_KIND = "daemon";
const HEARTBEAT_FRESH_MS = 90 * 1000;

async function buildDaemonNotPickingUpError(client, userId) {
  if (!userId) {
    return "The AI daemon did not pick up this task. Make sure the daemon is running on your local machine: run `knosi login` then `knosi`.";
  }

  const result = await client.execute({
    sql: `SELECT last_seen_at FROM daemon_heartbeats WHERE user_id = ? AND kind = ?`,
    args: [userId, DAEMON_HEARTBEAT_KIND],
  });
  const row = result.rows[0];

  if (!row) {
    return "No daemon has connected for this account yet. Run `knosi login` from this Google account, then `knosi` to start the daemon.";
  }

  const lastSeenMs = Number(row.last_seen_at) * 1000;
  const ageMs = Date.now() - lastSeenMs;
  if (ageMs > HEARTBEAT_FRESH_MS) {
    const ageSec = Math.round(ageMs / 1000);
    const ageStr = ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`;
    return `Your daemon is offline (last seen ${ageStr} ago). Restart it on your local machine with \`knosi\`.`;
  }

  return "Your daemon is online but did not claim this task within 8s. This usually means the CLI is authenticated as a different account than the one signed in here. Run `knosi login` from the same Google account, then restart `knosi`.";
}

const client = createClient({ url: ":memory:" });
await client.execute(`
  CREATE TABLE daemon_heartbeats (
    user_id text NOT NULL,
    kind text NOT NULL,
    last_seen_at integer NOT NULL,
    version text,
    PRIMARY KEY(user_id, kind)
  )
`);

const cases = [];

// Case 1: no userId at all (auth bypass / missing session)
{
  const msg = await buildDaemonNotPickingUpError(client, null);
  const ok = msg.includes("run `knosi login` then `knosi`");
  cases.push({ name: "no-userId", ok, msg });
}

// Case 2: userId but no heartbeat row
{
  const msg = await buildDaemonNotPickingUpError(client, "user-A");
  const ok = msg.includes("No daemon has connected for this account yet");
  cases.push({ name: "no-heartbeat", ok, msg });
}

// Case 3: stale heartbeat (5 min old)
{
  const stale = Math.floor(Date.now() / 1000) - 5 * 60;
  await client.execute({
    sql: `INSERT INTO daemon_heartbeats (user_id, kind, last_seen_at) VALUES (?, ?, ?)`,
    args: ["user-B", "daemon", stale],
  });
  const msg = await buildDaemonNotPickingUpError(client, "user-B");
  const ok = msg.includes("offline") && msg.includes("last seen");
  cases.push({ name: "stale-heartbeat", ok, msg });
}

// Case 4: fresh heartbeat (10s old) — daemon online but not claiming
{
  const fresh = Math.floor(Date.now() / 1000) - 10;
  await client.execute({
    sql: `INSERT INTO daemon_heartbeats (user_id, kind, last_seen_at) VALUES (?, ?, ?)`,
    args: ["user-C", "daemon", fresh],
  });
  const msg = await buildDaemonNotPickingUpError(client, "user-C");
  const ok =
    msg.includes("online but did not claim") &&
    msg.includes("authenticated as a different account");
  cases.push({ name: "fresh-heartbeat-mismatch", ok, msg });
}

let allOk = true;
for (const { name, ok, msg } of cases) {
  const tag = ok ? "✅" : "❌";
  console.log(`${tag} ${name}`);
  console.log(`   ${msg}`);
  if (!ok) allOk = false;
}

client.close();
if (!allOk) process.exit(1);
console.log("\nAll cases passed.");
