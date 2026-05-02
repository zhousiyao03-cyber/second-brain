/**
 * Static presets used by Settings UI. Adding a new OpenAI-compatible
 * service here = zero code changes elsewhere.
 *
 * `models` is a fallback list. Settings UI also fetches `/v1/models`
 * (see probe.ts) and merges with these — presets just give first-time
 * users something to pick before they hit Refresh.
 */
export type OpenAiCompatiblePreset = {
  id: string;
  label: string;
  baseUrl: string;
  models: readonly string[];
};

export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAiCompatiblePreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-5.4", "o1-mini", "text-embedding-3-small", "text-embedding-3-large"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "moonshot",
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V2.5"],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
  },
] as const;

export const LOCAL_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
export const LOCAL_PRESET_MODELS: readonly string[] = [
  "qwen2.5:14b",
  "llama3.2",
  "mistral-nemo",
  "nomic-embed-text",
];

export const DAEMON_PRESET_MODELS: readonly string[] = [
  "opus",
  "sonnet",
];

export const TRANSFORMERS_DEFAULT_MODEL = "Xenova/multilingual-e5-small";
export const TRANSFORMERS_PRESET_MODELS: readonly string[] = [
  TRANSFORMERS_DEFAULT_MODEL,
];
