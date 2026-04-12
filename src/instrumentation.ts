import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export const langfuseSpanProcessor = new LangfuseSpanProcessor();

export async function register() {
  const provider = new NodeTracerProvider({
    spanProcessors: [langfuseSpanProcessor],
  });
  provider.register();
}
