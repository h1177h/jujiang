import { describe, expect, it, vi } from "vitest";
import type { ScreenplayYaml } from "../types";
import { generateScreenplayYamlModel } from "../generator";
import { generateWorkspaceDraft } from "../generationWorkflow";

describe("generation workflow", () => {
  it("falls back to a local draft when the API request fails", async () => {
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
    expect(result.source).toBe("local-draft");
    expect(result.status).toContain("已生成本地草稿");
    expect(result.screenplay).not.toBeNull();
    if (!result.screenplay) return;
    expect(result.screenplay.work.title).toBe("雨夜来信");
  });

  it("returns a clear empty-input error before calling API or local generation", async () => {
    const apiGenerator = vi.fn<() => Promise<ScreenplayYaml>>(async () =>
      generateScreenplayYamlModel("第一章 雨夜\n正文")
    );

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
    expect(result.status).toBe("请先输入小说正文，再生成剧本草稿。");
  });
});
