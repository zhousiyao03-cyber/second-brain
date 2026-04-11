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
      console.warn("[botid] blocked", JSON.stringify(verification));
      return Response.json(
        { error: "Request blocked" },
        { status: 403 }
      );
    }
  } catch (err) {
    console.warn("[botid] check threw", err);
    return null;
  }

  return null;
}
