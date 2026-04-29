import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthBypassEnabled } from "./bypass";

/**
 * The bypass-in-production guard is the single most important property of
 * this helper — a false positive here turns the whole app into an open
 * data-exfil endpoint. Lock it down.
 */
describe("isAuthBypassEnabled — production guard", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthBypass = process.env.AUTH_BYPASS;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete (process.env as Record<string, string | undefined>).NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalAuthBypass === undefined) {
      delete process.env.AUTH_BYPASS;
    } else {
      process.env.AUTH_BYPASS = originalAuthBypass;
    }
  });

  beforeEach(() => {
    delete process.env.AUTH_BYPASS;
  });

  it("returns false in production even when AUTH_BYPASS=true", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_BYPASS = "true";
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("returns true in development when AUTH_BYPASS=true", () => {
    process.env.NODE_ENV = "development";
    process.env.AUTH_BYPASS = "true";
    expect(isAuthBypassEnabled()).toBe(true);
  });

  it("returns true in test (vitest, playwright) when AUTH_BYPASS=true", () => {
    process.env.NODE_ENV = "test";
    process.env.AUTH_BYPASS = "true";
    expect(isAuthBypassEnabled()).toBe(true);
  });

  it("returns false when AUTH_BYPASS is unset", () => {
    process.env.NODE_ENV = "development";
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("returns false when AUTH_BYPASS is anything other than the literal 'true'", () => {
    process.env.NODE_ENV = "development";
    process.env.AUTH_BYPASS = "1";
    expect(isAuthBypassEnabled()).toBe(false);
    process.env.AUTH_BYPASS = "yes";
    expect(isAuthBypassEnabled()).toBe(false);
    process.env.AUTH_BYPASS = "TRUE";
    expect(isAuthBypassEnabled()).toBe(false);
  });
});
