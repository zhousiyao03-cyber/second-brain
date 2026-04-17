import { getDefaultBaseUrl, loadConfig } from "../config.mjs";
import { runUsageSync } from "../usage-reporter.mjs";

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

export async function runUsageReport(args) {
  const config = await loadConfig();
  if (!config?.accessToken) {
    console.error("✗ Not authenticated. Run `knosi auth login` first.");
    process.exit(1);
  }
  const serverUrl = getArg(args, "--url") || config.baseUrl || getDefaultBaseUrl();

  console.log("🔍 Scanning local usage data...");
  try {
    const { count } = await runUsageSync(serverUrl, config.accessToken);
    if (count === 0) {
      console.log("  No usage data found.");
    } else {
      console.log(`✓ Synced ${count} records → ${serverUrl}`);
    }
  } catch (err) {
    if (err?.message === "AUTH_FAILED") {
      console.error("✗ Authentication failed. Run `knosi auth login` to re-authenticate.");
    } else {
      console.error(`✗ Sync failed: ${err?.message ?? err}`);
    }
    process.exit(1);
  }
}
