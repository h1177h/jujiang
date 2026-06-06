import { describe, expect, it } from "vitest";
import {
  completeGenerationRun,
  createGenerationRun,
  failGenerationRun,
  pushGenerationRunHistory,
  updateGenerationRunStage
} from "../generationRun";

describe("generation run tracking", () => {
  it("starts a visible run with source and connection stages", () => {
    const run = createGenerationRun({
      title: "雾港来信",
      model: "gpt-4.1-mini",
      chapterCount: 5,
      date: new Date("2026-06-06T00:00:00.000Z")
    });

    expect(run.status).toBe("running");
    expect(run.title).toBe("雾港来信");
    expect(run.model).toBe("gpt-4.1-mini");
    expect(run.chapterCount).toBe(5);
    expect(run.stages.map((stage) => stage.id)).toEqual(["source_check", "connection_check"]);
    expect(run.stages[0].status).toBe("running");
  });

  it("marks earlier stages done and adds AI progress stages", () => {
    const run = createGenerationRun({
      title: "雾港来信",
      model: "gpt-4.1-mini",
      chapterCount: 5,
      date: new Date("2026-06-06T00:00:00.000Z")
    });

    const next = updateGenerationRunStage(run, {
      stage: "chapter_event_extract",
      message: "正在抽取第 3 章事件",
      current: 3,
      total: 5,
      date: new Date("2026-06-06T00:00:03.000Z")
    });

    expect(next.stages.map((stage) => stage.id)).toContain("chapter_event_extract");
    expect(next.stages.find((stage) => stage.id === "source_check")?.status).toBe("done");
    expect(next.stages.find((stage) => stage.id === "chapter_event_extract")).toMatchObject({
      status: "running",
      current: 3,
      total: 5
    });
  });

  it("attaches stage artifacts to the active generation stage", () => {
    const run = createGenerationRun({
      title: "雾港来信",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:00:00.000Z")
    });

    const next = updateGenerationRunStage(run, {
      stage: "event_extract",
      message: "故事蓝图已生成",
      artifact: {
        kind: "story_blueprint",
        summary: "3 个章节事件组",
        detail: "角色 2 个，风险控制 2 条"
      },
      date: new Date("2026-06-06T00:00:03.000Z")
    });

    expect(next.stages.find((stage) => stage.id === "event_extract")?.artifacts).toEqual([
      {
        kind: "story_blueprint",
        summary: "3 个章节事件组",
        detail: "角色 2 个，风险控制 2 条",
        createdAt: "2026-06-06T00:00:03.000Z"
      }
    ]);
  });

  it("records failure on the active stage without losing prior context", () => {
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "雾港来信",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "screenplay_generate",
        message: "正在生成剧本",
        date: new Date("2026-06-06T00:00:02.000Z")
      }
    );

    const failed = failGenerationRun(run, "API 生成失败", new Date("2026-06-06T00:00:05.000Z"));

    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("API 生成失败");
    expect(failed.completedAt).toBe("2026-06-06T00:00:05.000Z");
    expect(failed.stages.find((stage) => stage.id === "screenplay_generate")?.status).toBe("failed");
  });

  it("marks retryable failures with a recovery hint", () => {
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "雾港来信",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "screenplay_generate",
        message: "正在生成剧本",
        date: new Date("2026-06-06T00:00:02.000Z")
      }
    );

    const failed = failGenerationRun(
      run,
      "screenplay_generate 阶段请求超时：HTTP 504。可重试。",
      new Date("2026-06-06T00:00:05.000Z")
    );

    expect(failed.canRetry).toBe(true);
    expect(failed.recoveryHint).toBe("可以保留当前原文、AI 配置和已保存的阶段记录后重试。");
  });

  it("completes the run and marks all stages done", () => {
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "雾港来信",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "screenplay_generate",
        message: "正在生成剧本",
        date: new Date("2026-06-06T00:00:02.000Z")
      }
    );

    const done = completeGenerationRun(run, new Date("2026-06-06T00:00:08.000Z"));

    expect(done.status).toBe("completed");
    expect(done.stages[done.stages.length - 1]).toMatchObject({
      id: "yaml_ready",
      status: "done"
    });
    expect(done.stages.every((stage) => stage.status === "done")).toBe(true);
  });

  it("keeps recent generation runs without duplicating the same run", () => {
    const first = completeGenerationRun(
      createGenerationRun({
        title: "雾港来信",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      new Date("2026-06-06T00:00:05.000Z")
    );
    const second = failGenerationRun(
      createGenerationRun({
        title: "长篇测试",
        model: "gpt-4.1",
        chapterCount: 8,
        date: new Date("2026-06-06T00:10:00.000Z")
      }),
      "AI 生成失败",
      new Date("2026-06-06T00:10:12.000Z")
    );

    const history = pushGenerationRunHistory(pushGenerationRunHistory([first], second), first, 2);

    expect(history.map((run) => run.id)).toEqual([first.id, second.id]);
    expect(history).toHaveLength(2);
  });
});
