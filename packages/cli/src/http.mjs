import { loadConfig, saveConfig } from "./config.mjs";

async function refreshAccessToken(config) {
  if (!config?.refreshToken || !config?.baseUrl) {
    return null;
  }

  const response = await fetch(`${config.baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "knosi-cli",
      refresh_token: config.refreshToken,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.json();
  const nextConfig = {
    ...config,
    accessToken: body.access_token,
  };
  await saveConfig(nextConfig);
  return nextConfig;
}

export async function authorizedFetch(pathname, init = {}) {
  let config = await loadConfig();
  if (!config?.accessToken || !config?.baseUrl) {
    throw new Error("Not logged in. Run `knosi auth login` first.");
  }

  const makeRequest = async (token) =>
    fetch(`${config.baseUrl}${pathname}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

  let response = await makeRequest(config.accessToken);
  if (response.status !== 401) {
    return response;
  }

  config = await refreshAccessToken(config);
  if (!config?.accessToken) {
    return response;
  }

  response = await makeRequest(config.accessToken);
  return response;
}
