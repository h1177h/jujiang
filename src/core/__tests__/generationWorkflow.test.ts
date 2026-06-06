import { describe, expect, it, vi } from "vitest";
import type { ScreenplayYaml } from "../types";
import { generateWorkspaceDraft } from "../generationWorkflow";

describe("generation workflow", () => {
  it("does not fabricate a screenplay when the API request fails", async () => {
    const apiGenerator = vi.fn<() => Promise<ScreenplayYaml>>(async () => {
      throw new Error("network offline");
    });

    const result = await generateWorkspaceDraft(
      {
        title: "雨夜来信",
        style: "cinematic",
        novelText: "第一章 雨夜\n林砚推开旧书店的门，说：“我来取那封信。”",
        useApi: true,
        apiReady: true,
        model: "test-model"
      },
      apiGenerator
    );

    expect(apiGenerator).toHaveBeenCalledOnce();
    expect(result.source).toBe("error");
    expect(result.status).toBe("AI 生成失败：network offline。请检查 API key、代理或稍后重试。");
    expect(result.screenplay).toBeNull();
  });

  it("does not bury app service diagnostics under a generic hint", async () => {
    const apiGenerator = vi.fn<() => Promise<ScreenplayYaml>>(async () => {
      throw new Error("应用内 AI 服务没有启动：请用 npm run dev:app 启动完整应用后再生成。");
    });

    const result = await generateWorkspaceDraft(
      {
        title: "雨夜来信",
        style: "cinematic",
        novelText: "第一章 雨夜\n林砚推开旧书店的门，说：“我来取那封信。”",
        useApi: true,
        apiReady: true,
        model: "test-model"
      },
      apiGenerator
    );

    expect(result.status).toBe(
      "AI 生成失败：应用内 AI 服务没有启动：请用 npm run dev:app 启动完整应用后再生成。"
    );
  });

  it("keeps staged provider diagnostics instead of turning 504 into a key hint", async () => {
    const apiGenerator = vi.fn<() => Promise<ScreenplayYaml>>(async () => {
      throw new Error("chapter_event_extract 阶段请求失败：HTTP 504，已重试 2 次，耗时 120003ms，请求 4096 bytes");
    });

    const result = await generateWorkspaceDraft(
      {
        title: "雨夜来信",
        style: "cinematic",
        novelText: "第一章 雨夜\n林砚推开旧书店的门，说：“我来取那封信。”",
        useApi: true,
        apiReady: true,
        model: "test-model"
      },
      apiGenerator
    );

    expect(result.status).toBe(
      "AI 生成失败：chapter_event_extract 阶段请求失败：HTTP 504，已重试 2 次，耗时 120003ms，请求 4096 bytes"
    );
  });

  it("keeps user cancellation separate from provider or key failures", async () => {
    const apiGenerator = vi.fn<() => Promise<ScreenplayYaml>>(async () => {
      throw new Error("生成任务已取消");
    });

    const result = await generateWorkspaceDraft(
      {
        title: "雾港来信",
        style: "cinematic",
        novelText: "第一章 雾港\n林砚推开旧书店的门。",
        useApi: true,
        apiReady: true,
        model: "test-model"
      },
      apiGenerator
    );

    expect(result.status).toBe("AI 生成失败：生成任务已取消");
  });

  it("requires AI configuration instead of generating a local plot", async () => {
    const apiGenerator = vi.fn<() => Promise<ScreenplayYaml>>();

    const result = await generateWorkspaceDraft(
      {
        title: "雨夜来信",
        style: "cinematic",
        novelText: "第一章 雨夜\n林砚推开旧书店的门，说：“我来取那封信。”",
        useApi: false,
        apiReady: false,
        model: "test-model"
      },
      apiGenerator
    );

    expect(apiGenerator).not.toHaveBeenCalled();
    expect(result.source).toBe("error");
    expect(result.status).toBe("请先配置 AI 生成。剧匠不会用本地规则伪造剧情理解。");
    expect(result.screenplay).toBeNull();
  });

  it("returns a clear empty-input error before calling API", async () => {
    const apiGenerator = vi.fn<() => Promise<ScreenplayYaml>>();

    const result = await generateWorkspaceDraft(
      {
        title: "空白",
        style: "balanced",
        novelText: "",
        useApi: true,
        apiReady: true,
        model: "test-model"
      },
      apiGenerator
    );

    expect(apiGenerator).not.toHaveBeenCalled();
    expect(result.source).toBe("error");
    expect(result.status).toBe("请先输入小说正文，再调用 AI 生成剧本。");
  });
});
