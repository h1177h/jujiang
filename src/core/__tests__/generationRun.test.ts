import { describe, expect, it } from "vitest";
import {
  buildGenerationRunDiagnostic,
  cancelGenerationRun,
  completeGenerationRun,
  createGenerationRun,
  failGenerationRun,
  mergeRecoveredGenerationTasks,
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

  it("marks cancellation on the active stage without treating it as provider failure", () => {
    const run = updateGenerationRunStage(
      createGenerationRun({
        title: "雾港来信",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      {
        stage: "chapter_event_extract",
        message: "正在抽取第 1 章事件",
        current: 1,
        total: 3,
        date: new Date("2026-06-06T00:00:03.000Z")
      }
    );

    const cancelled = cancelGenerationRun(run, new Date("2026-06-06T00:00:04.000Z"));

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.error).toBe("生成任务已取消");
    expect(cancelled.completedAt).toBe("2026-06-06T00:00:04.000Z");
    expect(cancelled.stages.find((stage) => stage.id === "chapter_event_extract")?.status).toBe("failed");
    expect(cancelled.stages.find((stage) => stage.id === "chapter_event_extract")?.message).toBe("生成任务已取消");
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

  it("builds a copyable diagnostic summary for failed runs", () => {
    const run = failGenerationRun(
      updateGenerationRunStage(
        createGenerationRun({
          title: "三章失败",
          model: "gpt-4.1-mini",
          chapterCount: 3,
          date: new Date("2026-06-06T00:00:00.000Z")
        }),
        {
          stage: "chapter_event_extract",
          message: "正在抽取第 1 章事件",
          current: 1,
          total: 3,
          date: new Date("2026-06-06T00:00:03.000Z")
        }
      ),
      "chapter_event_extract 阶段请求失败：HTTP 504，已重试 2 次",
      new Date("2026-06-06T00:02:00.000Z")
    );

    expect(buildGenerationRunDiagnostic(run)).toContain("Title: 三章失败");
    expect(buildGenerationRunDiagnostic(run)).toContain("Model: gpt-4.1-mini");
    expect(buildGenerationRunDiagnostic(run)).toContain("Chapters: 3");
    expect(buildGenerationRunDiagnostic(run)).toContain("Failed stage: 逐章事件");
    expect(buildGenerationRunDiagnostic(run)).toContain("Error: chapter_event_extract 阶段请求失败：HTTP 504，已重试 2 次");
  });

  it("includes local task snapshots in diagnostics", () => {
    const run = failGenerationRun(
      {
        ...createGenerationRun({
          title: "任务恢复",
          model: "gpt-4.1-mini",
          chapterCount: 3,
          date: new Date("2026-06-06T00:00:00.000Z")
        }),
        localTasks: [
          {
            taskId: "task-abc",
            requestId: "jj-abc",
            status: "failed",
            updatedAt: "2026-06-06T00:00:05.000Z",
            upstreamStatus: 504,
            message: "上游 AI 服务返回 HTTP 504"
          }
        ]
      },
      "screenplay_generate 阶段请求失败：HTTP 504",
      new Date("2026-06-06T00:00:06.000Z")
    );

    const diagnostic = buildGenerationRunDiagnostic(run);

    expect(diagnostic).toContain("Local tasks:");
    expect(diagnostic).toContain("task-abc / jj-abc / failed / HTTP 504 / 上游 AI 服务返回 HTTP 504");
  });

  it("merges recovered local task status back into saved generation runs", () => {
    const run = {
      ...createGenerationRun({
        title: "恢复测试",
        model: "gpt-4.1-mini",
        chapterCount: 3,
        date: new Date("2026-06-06T00:00:00.000Z")
      }),
      localTasks: [
        {
          taskId: "task-recover",
          requestId: "jj-recover",
          status: "running" as const,
          updatedAt: "2026-06-06T00:00:03.000Z"
        }
      ]
    };

    const [recovered] = mergeRecoveredGenerationTasks(
      [run],
      [
        {
          taskId: "task-recover",
          requestId: "jj-recover",
          status: "failed",
          upstreamStatus: 504,
          message: "上游 AI 服务返回 HTTP 504",
          updatedAt: "2026-06-06T00:00:10.000Z"
        }
      ],
      new Date("2026-06-06T00:00:11.000Z")
    );

    expect(recovered.status).toBe("failed");
    expect(recovered.error).toBe("本地生成任务恢复失败：上游 AI 服务返回 HTTP 504");
    expect(recovered.localTasks?.[0]).toMatchObject({
      taskId: "task-recover",
      status: "failed",
      upstreamStatus: 504
    });
  });
});
