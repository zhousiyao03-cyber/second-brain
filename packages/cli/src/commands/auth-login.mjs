import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { getDefaultBaseUrl, saveConfig } from "../config.mjs";

export function createPkceVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

export function createPkceChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizationUrl({
  baseUrl,
  codeChallenge,
  redirectUri,
}) {
  const url = new URL("/oauth/authorize", baseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", "knosi-cli");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "knowledge:read knowledge:write_inbox");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function getOpenCommand(platform, url) {
  if (platform === "win32") {
    // cmd's `start` builtin: first quoted arg is the window title, so pass "" then the URL.
    // Caret-escape cmd metachars in the URL — libuv's Windows arg-quoter does not quote args
    // for `&|<>^`, so an OAuth URL with `?a=1&b=2` would otherwise get split at the `&`.
    return { command: "cmd", args: ["/c", "start", "", escapeForCmd(url)] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

function escapeForCmd(value) {
  return value.replace(/[&|<>^]/g, "^$&");
}

function openUrl(url) {
  const { command, args } = getOpenCommand(process.platform, url);
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    // spawn emits ENOENT asynchronously via 'error' — without this listener it crashes the process.
    child.once("error", () => {
      console.log("Could not open browser automatically. Open this URL manually:");
      console.log(url);
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function waitForCallback(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error ? `Login failed: ${error}\n` : "Knosi CLI login complete. You can return to Claude Code.\n");
      server.close();

      if (error) {
        reject(new Error(`OAuth login failed: ${error}`));
      } else if (!code) {
        reject(new Error("OAuth callback did not include a code."));
      } else {
        resolve(code);
      }
    });

    server.listen(port, "127.0.0.1");
  });
}

export async function runAuthLogin(args) {
  const baseUrl = args[0] && args[0].startsWith("http") ? args[0] : getDefaultBaseUrl();
  const port = 6274;
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
  const verifier = createPkceVerifier();
  const challenge = createPkceChallenge(verifier);
  const authorizationUrl = buildAuthorizationUrl({
    baseUrl,
    codeChallenge: challenge,
    redirectUri,
  });

  console.log(`Opening browser for Knosi login at ${baseUrl} ...`);
  if (!openUrl(authorizationUrl)) {
    console.log("Open this URL manually:");
    console.log(authorizationUrl);
  }

  const code = await waitForCallback(port);
  const response = await fetch(`${baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "knosi-cli",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: ${await response.text()}`);
  }

  const body = await response.json();
  await saveConfig({
    baseUrl,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    clientId: "knosi-cli",
  });

  console.log("✓ Saved Knosi CLI credentials.");
}
