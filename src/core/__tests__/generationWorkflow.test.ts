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

  it("does not bury connection diagnostics under a generic hint", async () => {
    const apiGenerator = vi.fn<() => Promise<ScreenplayYaml>>(async () => {
      throw new Error("浏览器直连失败：这通常是 CORS、系统代理或网络拦截导致。请勾选“本地 proxy”，运行 npm run proxy 后再生成。");
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
      "AI 生成失败：浏览器直连失败：这通常是 CORS、系统代理或网络拦截导致。请勾选“本地 proxy”，运行 npm run proxy 后再生成。"
    );
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
