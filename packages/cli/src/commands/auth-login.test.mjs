import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizationUrl, createPkceChallenge, getOpenCommand } from "./auth-login.mjs";

test("buildAuthorizationUrl encodes the Knosi CLI OAuth request", () => {
  const url = new URL(
    buildAuthorizationUrl({
      baseUrl: "https://www.knosi.xyz",
      codeChallenge: createPkceChallenge("a".repeat(43)),
      redirectUri: "http://127.0.0.1:6274/oauth/callback",
    })
  );

  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "knosi-cli");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("getOpenCommand selects the right opener per platform", () => {
  const url = "https://www.knosi.xyz/oauth/authorize?x=1";
  assert.deepEqual(getOpenCommand("win32", url), {
    command: "cmd",
    args: ["/c", "start", "", url],
  });
  assert.deepEqual(getOpenCommand("darwin", url), {
    command: "open",
    args: [url],
  });
  assert.deepEqual(getOpenCommand("linux", url), {
    command: "xdg-open",
    args: [url],
  });
});

test("getOpenCommand caret-escapes cmd metachars in Windows URLs", () => {
  // A realistic OAuth URL contains several `&` query separators that cmd would
  // otherwise treat as command separators, truncating the URL after the first one.
  const url =
    "https://www.knosi.xyz/oauth/authorize?response_type=code&client_id=knosi-cli&code_challenge_method=S256";
  const { command, args } = getOpenCommand("win32", url);
  assert.equal(command, "cmd");
  assert.equal(args[0], "/c");
  assert.equal(args[1], "start");
  assert.equal(args[2], "");
  assert.equal(
    args[3],
    "https://www.knosi.xyz/oauth/authorize?response_type=code^&client_id=knosi-cli^&code_challenge_method=S256"
  );
  // Non-cmd platforms must not be caret-escaped.
  assert.equal(getOpenCommand("darwin", url).args[0], url);
  assert.equal(getOpenCommand("linux", url).args[0], url);
});
