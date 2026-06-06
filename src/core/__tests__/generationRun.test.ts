import { describe, expect, it } from "vitest";
import {
  completeGenerationRun,
  createGenerationRun,
  failGenerationRun,
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
});
