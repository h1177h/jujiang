import { describe, expect, it } from "vitest";
import type { StoryBlueprint } from "../types";
import {
  completeGenerationRun,
  createGenerationRun,
  cancelGenerationRun,
  failGenerationRun,
  failGenerationRunStage,
  failGenerationRunWithMessage,
  formatAiGenerationProgress,
  formatGenerationRunArtifactDiagnostics,
  formatGenerationRunRecoverySummary,
  formatGenerationRunRetryAction,
  formatGenerationRunResumeSummary,
  formatGenerationRunStatus,
  getGenerationRunResumeCheckpoint,
  pushGenerationRunHistory,
  selectVisibleGenerationArtifacts,
  updateActiveGenerationRun,
  updateGenerationRunHistory,
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

  it("ignores async updates from older generation runs", () => {
    const olderRun = createGenerationRun({
      title: "旧任务",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:00:00.000Z")
    });
    const activeRun = createGenerationRun({
      title: "新任务",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:01:00.000Z")
    });

    const staleUpdate = updateActiveGenerationRun(activeRun, olderRun.id, (run) =>
      updateGenerationRunStage(run, {
        stage: "screenplay_generate",
        message: "旧任务完成",
        date: new Date("2026-06-06T00:01:10.000Z")
      })
    );
    const currentUpdate = updateActiveGenerationRun(activeRun, activeRun.id, (run) =>
      updateGenerationRunStage(run, {
        stage: "screenplay_generate",
        message: "新任务完成",
        date: new Date("2026-06-06T00:01:11.000Z")
      })
    );

    expect(staleUpdate).toBe(activeRun);
    expect(currentUpdate?.stages.find((stage) => stage.id === "screenplay_generate")?.message).toBe("新任务完成");
  });

  it("updates active generation runs inside history by id", () => {
    const olderRun = createGenerationRun({
      title: "Old run",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:00:00.000Z")
    });
    const activeRun = createGenerationRun({
      title: "Active run",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:01:00.000Z")
    });

    const updated = updateGenerationRunHistory([olderRun, activeRun], activeRun.id, (run) =>
      updateGenerationRunStage(run, {
        stage: "screenplay_generate",
        message: "Active run progressed",
        date: new Date("2026-06-06T00:01:10.000Z")
      })
    );
    const stale = updateGenerationRunHistory(updated, "missing-run", (run) => failGenerationRun(run, "stale"));

    const activeRunStages = updated.find((run) => run.id === activeRun.id)?.stages;
    expect(activeRunStages?.[activeRunStages.length - 1]?.message).toBe("Active run progressed");
    expect(updated.find((run) => run.id === olderRun.id)).toBe(olderRun);
    expect(stale).toBe(updated);
  });

  it("marks cancelled runs without offering retry or resume actions", () => {
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

    const cancelled = cancelGenerationRun(run, "用户已停止本次生成。", new Date("2026-06-06T00:00:05.000Z"));

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.error).toBe("用户已停止本次生成。");
    expect(cancelled.canRetry).toBe(false);
    expect(cancelled.recoveryHint).toBeUndefined();
    expect(cancelled.completedAt).toBe("2026-06-06T00:00:05.000Z");
    expect(cancelled.stages.find((stage) => stage.id === "screenplay_generate")).toMatchObject({
      status: "cancelled",
      message: "用户已停止本次生成。"
    });
    expect(formatGenerationRunStatus("cancelled")).toBe("已停止");
    expect(formatGenerationRunRetryAction(cancelled)).toBeNull();
    expect(formatGenerationRunRecoverySummary(cancelled)).toBeNull();
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

  it("seeds resume checkpoints on new retry runs before provider work starts", () => {
    const resumeFrom = {
      chapterEvents: [makeChapterEventGroup(1), makeChapterEventGroup(2)]
    };

    const run = createGenerationRun({
      title: "Checkpoint Story",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      resumeFrom,
      date: new Date("2026-06-06T00:00:00.000Z")
    });

    const sourceStage = run.stages.find((stage) => stage.id === "source_check");

    expect(sourceStage?.artifacts).toEqual([
      {
        kind: "chapter_events",
        summary: "继承 2 个章节事件组",
        detail: "来自上次失败任务的续跑检查点。",
        checkpoint: resumeFrom,
        createdAt: "2026-06-06T00:00:00.000Z"
      }
    ]);
    expect(getGenerationRunResumeCheckpoint(run)?.chapterEvents?.map((group) => group.chapterIndex)).toEqual([1, 2]);
  });

  it("formats repair diagnostic artifacts for the task panel", () => {
    expect(
      formatGenerationRunArtifactDiagnostics({
        kind: "repair",
        summary: "Schema repair failed",
        diagnostic: {
          initialIssues: ["scenes.0.goal", "characters.0.name"],
          repairedIssues: ["chapterMappings.1.sceneIds.0", "storyDiagnostics.strongestConflictSceneId"],
          initialExcerpt: "{\"scenes\":[],\"characters\":[{}]}",
          repairedExcerpt: "{\"scenes\":[],\"validationHints\":[]}"
        },
        createdAt: "2026-06-06T00:00:03.000Z"
      })
    ).toEqual([
      "初次返回仍有 2 个结构问题：第 1 场 goal；第 1 个角色 name",
      "修复后仍有 2 个结构问题：第 2 个章节映射 sceneIds.0；故事诊断 strongestConflictSceneId",
      "初次返回片段：{\"scenes\":[],\"characters\":[{}]}",
      "修复返回片段：{\"scenes\":[],\"validationHints\":[]}"
    ]);
  });

  it("keeps diagnostic artifacts visible when a stage has many artifacts", () => {
    const artifacts = [
      {
        kind: "story_blueprint",
        summary: "Provider schema failed",
        diagnostic: {
          initialExcerpt: "{\"chapterEvents\":[]}"
        },
        createdAt: "2026-06-06T00:00:01.000Z"
      },
      {
        kind: "chapter_events",
        summary: "Chapter 1 saved",
        createdAt: "2026-06-06T00:00:02.000Z"
      },
      {
        kind: "chapter_events",
        summary: "Chapter 2 saved",
        createdAt: "2026-06-06T00:00:03.000Z"
      },
      {
        kind: "chapter_events",
        summary: "Chapter 3 saved",
        createdAt: "2026-06-06T00:00:04.000Z"
      },
      {
        kind: "chapter_events",
        summary: "Chapter 4 saved",
        createdAt: "2026-06-06T00:00:05.000Z"
      }
    ] as const;

    expect(selectVisibleGenerationArtifacts(artifacts)).toEqual([
      artifacts[0],
      artifacts[3],
      artifacts[4]
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

  it("ignores saved checkpoints that no longer pass schema", () => {
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "Broken Checkpoint Story",
        model: "gpt-4.1-mini",
        chapterCount: 2,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "chapter_event_extract",
        message: "Saved malformed chapter events",
        artifact: {
          kind: "chapter_events",
          summary: "1 malformed chapter event group",
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
                      chapterIndex: 2,
                      chapterTitle: "Chapter 1",
                      paragraphIndexes: [1],
                      lineStart: 1,
                      lineEnd: 2,
                      excerpt: "Lin finds the clue."
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

    expect(getGenerationRunResumeCheckpoint(run)).toBeNull();
    expect(formatGenerationRunResumeSummary(run)).toBeNull();
  });

  it("ignores saved checkpoints outside the current source chapter range", () => {
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "Outdated Checkpoint Story",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "chapter_event_extract",
        message: "Saved outdated chapter events",
        artifact: {
          kind: "chapter_events",
          summary: "1 outdated chapter event group",
          checkpoint: {
            chapterEvents: [
              {
                chapterIndex: 4,
                chapterTitle: "Chapter 4",
                chapterGoal: "Use the old clue",
                events: [
                  {
                    id: "event-4",
                    summary: "Lin uses the old clue.",
                    characters: ["Lin"],
                    location: "Archive",
                    conflict: "The clue may be stale.",
                    emotionalTurn: "Resolve falters.",
                    source: {
                      chapterIndex: 4,
                      chapterTitle: "Chapter 4",
                      paragraphIndexes: [1],
                      lineStart: 8,
                      lineEnd: 9,
                      excerpt: "Lin uses the old clue."
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

    expect(getGenerationRunResumeCheckpoint(run)).toBeNull();
    expect(formatGenerationRunResumeSummary(run)).toBeNull();
  });

  it("falls back to partial chapter events when a saved story blueprint does not cover the current run", () => {
    const partialBlueprint: StoryBlueprint = {
      chapterEvents: [makeChapterEventGroup(1), makeChapterEventGroup(2)],
      storyBible: {
        worldview: "A coastal city hides old evidence.",
        coreConflict: "Lin must expose the hidden ledger before it disappears.",
        timeline: ["Lin finds the coded note.", "Shen hides the clue."],
        characterArcs: [
          {
            character: "Lin",
            arc: "From suspicion to resolve.",
            firstEventId: "event-1",
            lastEventId: "event-2"
          }
        ]
      },
      adaptationStrategy: {
        format: "short drama",
        pacing: "steady escalation",
        sceneRules: ["Anchor each scene to an extracted event."],
        riskControls: ["Do not invent missing source evidence."]
      }
    };
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "Partial Blueprint Story",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "story_bible_generate",
        message: "Saved partial story blueprint",
        artifact: {
          kind: "story_blueprint",
          summary: "2 chapter event groups",
          checkpoint: {
            storyBlueprint: partialBlueprint,
            chapterEvents: partialBlueprint.chapterEvents
          }
        },
        date: new Date("2026-06-06T00:00:03.000Z")
      }
    );

    const checkpoint = getGenerationRunResumeCheckpoint(run);

    expect(checkpoint?.storyBlueprint).toBeUndefined();
    expect(checkpoint?.chapterEvents?.map((group) => group.chapterIndex)).toEqual([1, 2]);
  });

  it("returns a cleaned story blueprint checkpoint when old chapters are outside the current run", () => {
    const savedStoryBlueprint: StoryBlueprint = {
      chapterEvents: [
        makeChapterEventGroup(1),
        makeChapterEventGroup(2),
        makeChapterEventGroup(3),
        makeChapterEventGroup(9)
      ],
      storyBible: {
        worldview: "A coastal city hides old evidence.",
        coreConflict: "Lin must expose the hidden ledger before it disappears.",
        timeline: ["Lin finds the coded note.", "Shen hides the clue.", "The bell tower reveals the traitor."],
        characterArcs: [
          {
            character: "Lin",
            arc: "From suspicion to resolve.",
            firstEventId: "event-1",
            lastEventId: "event-3"
          }
        ]
      },
      adaptationStrategy: {
        format: "short drama",
        pacing: "steady escalation",
        sceneRules: ["Anchor each scene to an extracted event."],
        riskControls: ["Do not invent missing source evidence."]
      }
    };
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "Clean Blueprint Story",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "story_bible_generate",
        message: "Saved story blueprint with stale chapters",
        artifact: {
          kind: "story_blueprint",
          summary: "4 chapter event groups",
          checkpoint: {
            storyBlueprint: savedStoryBlueprint,
            chapterEvents: savedStoryBlueprint.chapterEvents
          }
        },
        date: new Date("2026-06-06T00:00:03.000Z")
      }
    );

    const checkpoint = getGenerationRunResumeCheckpoint(run);

    expect(checkpoint?.storyBlueprint?.chapterEvents.map((group) => group.chapterIndex)).toEqual([1, 2, 3]);
    expect(checkpoint?.chapterEvents?.map((group) => group.chapterIndex)).toEqual([1, 2, 3]);
  });

  it("summarizes saved checkpoints before retrying a failed run", () => {
    const run = failGenerationRun(
      updateGenerationRunStage(
        createGenerationRun({
          title: "Checkpoint Story",
          model: "gpt-4.1-mini",
          chapterCount: 3,
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
                  chapterIndex: 3,
                  chapterTitle: "Chapter 3",
                  chapterGoal: "Use the clue",
                  events: [
                    {
                      id: "event-3",
                      summary: "Lin uses the clue.",
                      characters: ["Lin"],
                      location: "Archive",
                      conflict: "The clue may be false.",
                      emotionalTurn: "Resolve hardens.",
                      source: {
                        chapterIndex: 3,
                        chapterTitle: "Chapter 3",
                        paragraphIndexes: [1],
                        lineStart: 8,
                        lineEnd: 9,
                        excerpt: "Lin uses the clue."
                      }
                    }
                  ]
                }
              ]
            }
          },
          date: new Date("2026-06-06T00:00:03.000Z")
        }
      ),
      "screenplay_generate HTTP 504",
      new Date("2026-06-06T00:00:05.000Z")
    );

    expect(formatGenerationRunResumeSummary(run)).toBe("已保存 2 章 / 2 个事件：第 1、3 章，可从阶段产物继续");
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

  it("records missing AI configuration on the connection stage", () => {
    const run = createGenerationRun({
      title: "Mist Harbor",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:00:00.000Z")
    });

    const failed = failGenerationRunWithMessage(
      run,
      "请先配置 AI 生成。剧匠不会用本地规则伪造剧情理解。",
      new Date("2026-06-06T00:00:05.000Z")
    );

    expect(failed.status).toBe("failed");
    expect(failed.stages.find((stage) => stage.id === "source_check")).toMatchObject({
      status: "done"
    });
    expect(failed.stages.find((stage) => stage.id === "connection_check")).toMatchObject({
      status: "failed",
      message: "请先配置 AI 生成。剧匠不会用本地规则伪造剧情理解。"
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
    const toolCallFailed = failGenerationRun(
      run,
      "event_extract 阶段返回了工具调用而不是文本 JSON。finish_reason=tool_calls。工具：make_screenplay。",
      new Date("2026-06-06T00:00:07.000Z")
    );

    expect(schemaFailed.canRetry).toBe(true);
    expect(parseFailed.canRetry).toBe(true);
    expect(toolCallFailed.canRetry).toBe(true);
    expect(schemaFailed.recoveryHint).toBe("可以保留当前原文、AI 配置和已保存的阶段记录后重试。");
  });

  it("formats retry actions only when the failed run can retry", () => {
    const baseRun = createGenerationRun({
      title: "雾港来信",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:00:00.000Z")
    });
    const nonRetryable = failGenerationRun(baseRun, "请先输入小说正文，再调用 AI 生成剧本。");
    const retryable = failGenerationRun(
      baseRun,
      "screenplay_generate 阶段请求超时：HTTP 504。可重试。"
    );
    const checkpointedRun = updateGenerationRunStage(baseRun, {
      stage: "chapter_event_extract",
      message: "Saved chapter events",
      artifact: {
        kind: "chapter_events",
        summary: "1 chapter event group",
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
            }
          ]
        }
      }
    });
    const nonRetryableWithCheckpoint = failGenerationRun(
      checkpointedRun,
      "请先输入小说正文，再调用 AI 生成剧本。"
    );
    const resumable = failGenerationRun(
      checkpointedRun,
      "screenplay_generate 阶段请求超时：HTTP 504。可重试。"
    );

    expect(formatGenerationRunRetryAction(nonRetryable)).toBeNull();
    expect(formatGenerationRunRetryAction(nonRetryableWithCheckpoint)).toBeNull();
    expect(formatGenerationRunRecoverySummary(nonRetryableWithCheckpoint)).toBeNull();
    expect(formatGenerationRunRetryAction(retryable)).toEqual({
      label: "重试",
      title: "重新调用当前 AI 配置"
    });
    expect(formatGenerationRunRecoverySummary(retryable)).toBeNull();
    expect(formatGenerationRunRetryAction(resumable)).toEqual({
      label: "续跑",
      title: "从已保存阶段继续调用当前 AI 配置"
    });
    expect(formatGenerationRunRecoverySummary(resumable)).toBe(
      "已保存 1 章 / 1 个事件：第 1 章，可从阶段产物继续"
    );
  });

  it("keeps raw checkpoint summaries available for diagnostics", () => {
    const baseRun = createGenerationRun({
      title: "雾港来信",
      model: "gpt-4.1-mini",
      chapterCount: 3,
      date: new Date("2026-06-06T00:00:00.000Z")
    });
    const checkpointedRun = updateGenerationRunStage(baseRun, {
        stage: "chapter_event_extract",
        message: "Saved chapter events",
        artifact: {
          kind: "chapter_events",
          summary: "1 chapter event group",
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
              }
            ]
          }
        }
      });

    expect(formatGenerationRunResumeSummary(checkpointedRun)).toBe(
      "已保存 1 章 / 1 个事件：第 1 章，可从阶段产物继续"
    );
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

function makeChapterEventGroup(chapterIndex: number): StoryBlueprint["chapterEvents"][number] {
  return {
    chapterIndex,
    chapterTitle: `Chapter ${chapterIndex}`,
    chapterGoal: `Track clue ${chapterIndex}`,
    events: [
      {
        id: `event-${chapterIndex}`,
        summary: `Event ${chapterIndex} moves the clue forward.`,
        characters: chapterIndex === 1 ? ["Lin"] : ["Shen"],
        location: chapterIndex === 1 ? "Pier" : "Archive",
        conflict: "The clue may be lost.",
        emotionalTurn: "Suspicion sharpens.",
        source: {
          chapterIndex,
          chapterTitle: `Chapter ${chapterIndex}`,
          paragraphIndexes: [1],
          lineStart: chapterIndex,
          lineEnd: chapterIndex + 1,
          excerpt: `Chapter ${chapterIndex} clue excerpt.`
        }
      }
    ]
  };
}
