import { createHash, randomBytes } from "node:crypto";

const DEVICE_TOKEN_PREFIX = "fct";

export function createFocusDeviceToken() {
  return `${DEVICE_TOKEN_PREFIX}_${randomBytes(24).toString("hex")}`;
}

export function hashFocusDeviceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getFocusDeviceTokenPreview(token: string) {
  return token.slice(-6);
}

export async function resolveIngestUserId(options: {
  authorization: string | null;
  deviceId: string;
  authBypassEnabled?: boolean;
  authBypassUserId?: string | null;
  configuredApiKey?: string | null;
  configuredUserId?: string | null;
  getSessionUserId: () => Promise<string | null>;
  findDeviceUserId: (input: {
    deviceId: string;
    tokenHash: string;
  }) => Promise<string | null>;
}) {
  if (options.authBypassEnabled) {
    return options.authBypassUserId ?? "test-user";
  }

  const bearerToken = options.authorization?.startsWith("Bearer ")
    ? options.authorization.slice("Bearer ".length).trim()
    : "";

  if (!bearerToken) {
    return options.getSessionUserId();
  }

  const configuredApiKey = options.configuredApiKey?.trim();
  const configuredUserId = options.configuredUserId?.trim();
  if (
    configuredApiKey &&
    configuredUserId &&
    bearerToken === configuredApiKey
  ) {
    return configuredUserId;
  }

  return options.findDeviceUserId({
    deviceId: options.deviceId,
    tokenHash: hashFocusDeviceToken(bearerToken),
  });
}
