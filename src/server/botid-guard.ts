import { checkBotId } from "botid/server";

/**
 * BotID 基础校验。E2E/AUTH_BYPASS 环境直接放行,避免测试误伤。
 * 返回 null = 通过;返回 Response = 已拦截,调用方直接 return。
 */
export async function guardBot(): Promise<Response | null> {
  if (process.env.AUTH_BYPASS === "true") return null;

  try {
    const verification = await checkBotId();
    if (verification.isBot) {
      return Response.json(
        { error: "Request blocked" },
        { status: 403 }
      );
    }
  } catch {
    // BotID 本身异常时不阻断请求,避免服务因为第三方校验挂掉
    return null;
  }

  return null;
}
