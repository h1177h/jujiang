import { describe, expect, it } from "vitest";
import { createAiSettingsSummary } from "../apiSettingsPresentation";

describe("AI settings presentation", () => {
  it("summarizes provider settings without exposing the API key", () => {
    const summary = createAiSettingsSummary({
      useApi: true,
      providerName: "DeepSeek",
      model: "deepseek-chat",
      hasApiKey: true
    });

    expect(summary.title).toBe("DeepSeek / deepseek-chat");
    expect(summary.status).toBe("Key 已保存");
    expect(JSON.stringify(summary)).not.toContain("sk-");
  });

  it("shows setup state when AI generation is disabled", () => {
    const summary = createAiSettingsSummary({
      useApi: false,
      providerName: "OpenAI-compatible",
      model: "gpt-4.1-mini",
      hasApiKey: false
    });

    expect(summary.title).toBe("AI 生成未启用");
    expect(summary.status).toBe("打开设置后启用");
  });
});
