export interface AiSettingsSummaryInput {
  useApi: boolean;
  providerName: string;
  model: string;
  hasApiKey: boolean;
}

export interface AiSettingsSummary {
  title: string;
  status: string;
}

export function createAiSettingsSummary(input: AiSettingsSummaryInput): AiSettingsSummary {
  if (!input.useApi) {
    return {
      title: "AI 生成未启用",
      status: "打开设置后启用"
    };
  }

  return {
    title: `${input.providerName} / ${input.model || "未选择模型"}`,
    status: input.hasApiKey ? "Key 已保存" : "未填写 Key"
  };
}
