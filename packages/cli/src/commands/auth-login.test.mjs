import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizationUrl, createPkceChallenge } from "./auth-login.mjs";

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
