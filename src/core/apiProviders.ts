export interface AiProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
}

export const apiProviderPresets: AiProviderPreset[] = [
  {
    id: "openai-compatible",
    name: "OpenAI-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini"]
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4o"]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"]
  },
  {
    id: "qwen",
    name: "Qwen compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"]
  },
  {
    id: "doubao",
    name: "Doubao / Volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1-5-pro-32k-250115",
    models: ["doubao-1-5-pro-32k-250115", "deepseek-v3-250324"]
  }
];

export function findApiProviderPreset(providerId: string | undefined): AiProviderPreset {
  return apiProviderPresets.find((provider) => provider.id === providerId) || apiProviderPresets[0];
}
