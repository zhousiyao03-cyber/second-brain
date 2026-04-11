import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["better-sqlite3", "@libsql/client"],
  transpilePackages: ["@excalidraw/excalidraw"],
};

export default withBotId(nextConfig);
