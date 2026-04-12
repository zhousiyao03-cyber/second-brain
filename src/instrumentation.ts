import { registerOTel } from "@vercel/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";

export function register() {
  registerOTel({
    serviceName: "second-brain",
    spanProcessors: [new LangfuseSpanProcessor()],
  });
}
