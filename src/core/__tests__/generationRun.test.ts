import { describe, expect, it } from "vitest";
import {
  completeGenerationRun,
  createGenerationRun,
  failGenerationRun,
  failGenerationRunStage,
  formatAiGenerationProgress,
  formatGenerationRunArtifactDiagnostics,
  formatGenerationRunStatus,
  getGenerationRunResumeCheckpoint,
  pushGenerationRunHistory,
  updateGenerationRunStage
} from "../generationRun";

describe("generation run tracking", () => {
  it("formats progress and status labels for the visible task panel", () => {
    expect(
      formatAiGenerationProgress(
        {
          stage: "chapter_event_extract",
          message: "正在抽取章节事件",
          current: 2,
          total: 5
        },
        "gpt-4.1-mini"
      )
    ).toBe("正在用 gpt-4.1-mini 抽取章节事件：2/5");
    expect(
      formatAiGenerationProgress(
        {
          stage: "schema_repair",
          message: "正在修复结构"
        },
        "gpt-4.1-mini"
      )
    ).toBe("正在用 gpt-4.1-mini 修复剧本结构");
    expect(formatGenerationRunStatus("completed")).toBe("完成");
    expect(formatGenerationRunStatus("failed")).toBe("失败");
    expect(formatGenerationRunStatus("running")).toBe("运行中");
    expect(formatGenerationRunStatus("idle")).toBe("待开始");
  });

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

  it("formats repair diagnostic artifacts for the task panel", () => {
    expect(
      formatGenerationRunArtifactDiagnostics({
        kind: "repair",
        summary: "Schema repair failed",
        diagnostic: {
          initialIssues: ["scenes", "characters.0.name"],
          repairedIssues: ["scenes"],
          initialExcerpt: "{\"scenes\":[],\"characters\":[{}]}",
          repairedExcerpt: "{\"scenes\":[],\"validationHints\":[]}"
        },
        createdAt: "2026-06-06T00:00:03.000Z"
      })
    ).toEqual([
      "初次问题：scenes, characters.0.name",
      "修复后问题：scenes",
      "初次返回：{\"scenes\":[],\"characters\":[{}]}",
      "修复返回：{\"scenes\":[],\"validationHints\":[]}"
    ]);
  });

  it("extracts resumable checkpoints from saved stage artifacts", () => {
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "Checkpoint Story",
        model: "gpt-4.1-mini",
        chapterCount: 2,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "chapter_event_extract",
        message: "Saved chapter events",
        artifact: {
          kind: "chapter_events",
          summary: "2 chapter event groups",
          checkpoint: {
            chapterEvents: [
              {
                chapterIndex: 1,
                chapterTitle: "Chapter 1",
                chapterGoal: "Find the clue",
                events: [
                  {
                    id: "event-1",
                    summary: "Lin finds the clue.",
                    characters: ["Lin"],
                    location: "Pier",
                    conflict: "The clue is hidden.",
                    emotionalTurn: "Suspicion rises.",
                    source: {
                      chapterIndex: 1,
                      chapterTitle: "Chapter 1",
                      paragraphIndexes: [1],
                      lineStart: 1,
                      lineEnd: 2,
                      excerpt: "Lin finds the clue."
                    }
                  }
                ]
              },
              {
                chapterIndex: 2,
                chapterTitle: "Chapter 2",
                chapterGoal: "Keep the clue safe",
                events: [
                  {
                    id: "event-2",
                    summary: "Shen hides the clue.",
                    characters: ["Shen"],
                    location: "Archive",
                    conflict: "Someone is watching.",
                    emotionalTurn: "Fear sharpens.",
                    source: {
                      chapterIndex: 2,
                      chapterTitle: "Chapter 2",
                      paragraphIndexes: [1],
                      lineStart: 3,
                      lineEnd: 4,
                      excerpt: "Shen hides the clue."
                    }
                  }
                ]
              }
            ]
          }
        },
        date: new Date("2026-06-06T00:00:03.000Z")
      }
    );

    const checkpoint = getGenerationRunResumeCheckpoint(run);

    expect(checkpoint?.chapterEvents?.map((group) => group.chapterIndex)).toEqual([1, 2]);
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

  it("records connection failures on the connection stage after source checks pass", () => {
    const run = createGenerationRun({
      title: "Mist Harbor",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:00:00.000Z")
    });

    const failed = failGenerationRunStage(
      run,
      "connection_check",
      "AI connection probe returned HTTP 504",
      new Date("2026-06-06T00:00:05.000Z")
    );

    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("AI connection probe returned HTTP 504");
    expect(failed.canRetry).toBe(true);
    expect(failed.stages.find((stage) => stage.id === "source_check")).toMatchObject({
      status: "done"
    });
    expect(failed.stages.find((stage) => stage.id === "connection_check")).toMatchObject({
      status: "failed",
      message: "AI connection probe returned HTTP 504",
      updatedAt: "2026-06-06T00:00:05.000Z"
    });
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

  it("marks provider format and schema failures as retryable", () => {
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "雾港来信",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "event_extract",
        message: "正在抽取事件",
        date: new Date("2026-06-06T00:00:02.000Z")
      }
    );

    const schemaFailed = failGenerationRun(
      run,
      "event_extract 阶段故事蓝图未通过 Schema：storyBible。Provider 返回摘要：{\"chapterEvents\":[]}",
      new Date("2026-06-06T00:00:05.000Z")
    );
    const parseFailed = failGenerationRun(
      run,
      "event_extract 阶段返回内容不是可解析 JSON。Provider 返回：我先分析一下故事。",
      new Date("2026-06-06T00:00:06.000Z")
    );

    expect(schemaFailed.canRetry).toBe(true);
    expect(parseFailed.canRetry).toBe(true);
    expect(schemaFailed.recoveryHint).toBe("可以保留当前原文、AI 配置和已保存的阶段记录后重试。");
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
