import { describe, expect, it } from "vitest";
import type { AiSettingsStorage } from "../apiSettings";
import {
  clearSavedWorkspaceDraft,
  loadSavedWorkspaceDraft,
  saveWorkspaceDraft,
  workspaceDraftStorageKey
} from "../workspaceDraft";

function createMemoryStorage(): AiSettingsStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

describe("workspace draft persistence", () => {
  it("saves and loads the current creative workspace", () => {
    const storage = createMemoryStorage();

    saveWorkspaceDraft(
      {
        title: "雾港来信",
        style: "cinematic",
        novelText: "第一章\n正文",
        yamlText: "work:\n  title: 雾港来信\n",
        selectedSceneId: "scene-02",
        revisionHistory: [
          {
            id: "rev-1",
            label: "手动保存",
            yamlText: "work:\n  title: 雾港来信\n",
            createdAt: "2026-06-06T00:00:00.000Z"
          }
        ],
        generationRuns: [
          {
            id: "run-1",
            title: "雾港来信",
            model: "gpt-4.1-mini",
            chapterCount: 3,
            status: "failed",
            startedAt: "2026-06-06T00:03:00.000Z",
            completedAt: "2026-06-06T00:03:12.000Z",
            error: "AI 生成失败",
            canRetry: true,
            recoveryHint: "可以保留当前原文、AI 配置和已保存的阶段记录后重试。",
            stages: [
              {
                id: "connection_check",
                label: "连接 AI",
                status: "failed",
                message: "AI 生成失败",
                artifacts: [
                  {
                    kind: "story_blueprint",
                    summary: "3 个章节事件组",
                    detail: "6 个事件",
                    createdAt: "2026-06-06T00:03:08.000Z"
                  }
                ],
                updatedAt: "2026-06-06T00:03:12.000Z"
              }
            ]
          }
        ]
      },
      storage,
      new Date("2026-06-06T00:05:00.000Z")
    );

    expect(loadSavedWorkspaceDraft(storage)).toEqual({
      title: "雾港来信",
      style: "cinematic",
      novelText: "第一章\n正文",
      yamlText: "work:\n  title: 雾港来信\n",
      selectedSceneId: "scene-02",
      revisionHistory: [
        {
          id: "rev-1",
          label: "手动保存",
          yamlText: "work:\n  title: 雾港来信\n",
          createdAt: "2026-06-06T00:00:00.000Z"
          }
        ],
        generationRuns: [
          {
            id: "run-1",
            title: "雾港来信",
            model: "gpt-4.1-mini",
            chapterCount: 3,
            status: "failed",
            startedAt: "2026-06-06T00:03:00.000Z",
            completedAt: "2026-06-06T00:03:12.000Z",
            error: "AI 生成失败",
            canRetry: true,
            recoveryHint: "可以保留当前原文、AI 配置和已保存的阶段记录后重试。",
            stages: [
              {
                id: "connection_check",
                label: "连接 AI",
                status: "failed",
                message: "AI 生成失败",
                artifacts: [
                  {
                    kind: "story_blueprint",
                    summary: "3 个章节事件组",
                    detail: "6 个事件",
                    createdAt: "2026-06-06T00:03:08.000Z"
                  }
                ],
                updatedAt: "2026-06-06T00:03:12.000Z"
              }
            ]
          }
        ],
      updatedAt: "2026-06-06T00:05:00.000Z"
    });
  });

  it("ignores corrupted workspace drafts", () => {
    const storage = createMemoryStorage();
    storage.setItem(workspaceDraftStorageKey, JSON.stringify({ title: "bad", style: "unknown" }));

    expect(loadSavedWorkspaceDraft(storage)).toBeNull();
  });

  it("ignores saved generation runs with malformed artifact diagnostics", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      workspaceDraftStorageKey,
      JSON.stringify({
        title: "Artifact Draft",
        style: "cinematic",
        novelText: "Chapter 1\nText",
        yamlText: "work:\n  title: Artifact Draft\n",
        selectedSceneId: null,
        revisionHistory: [],
        generationRuns: [
          {
            id: "run-1",
            title: "Artifact Draft",
            model: "gpt-4.1-mini",
            chapterCount: 1,
            status: "failed",
            startedAt: "2026-06-06T00:03:00.000Z",
            stages: [
              {
                id: "schema_repair",
                label: "Schema repair",
                status: "failed",
                message: "Repair failed",
                artifacts: [
                  {
                    kind: "repair",
                    summary: "Repair failed",
                    createdAt: "2026-06-06T00:03:08.000Z",
                    diagnostic: {
                      initialIssues: "scenes"
                    }
                  }
                ],
                updatedAt: "2026-06-06T00:03:12.000Z"
              }
            ]
          }
        ],
        updatedAt: "2026-06-06T00:05:00.000Z"
      })
    );

    expect(loadSavedWorkspaceDraft(storage)?.generationRuns).toEqual([]);
  });

  it("restores cancelled generation runs from the workspace draft", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      workspaceDraftStorageKey,
      JSON.stringify({
        title: "Cancelled Draft",
        style: "cinematic",
        novelText: "Chapter 1\nText",
        yamlText: "work:\n  title: Cancelled Draft\n",
        selectedSceneId: null,
        revisionHistory: [],
        generationRuns: [
          {
            id: "run-cancelled",
            title: "Cancelled Draft",
            model: "gpt-4.1-mini",
            chapterCount: 1,
            status: "cancelled",
            startedAt: "2026-06-06T00:03:00.000Z",
            completedAt: "2026-06-06T00:03:12.000Z",
            error: "用户已停止本次生成。",
            canRetry: false,
            stages: [
              {
                id: "screenplay_generate",
                label: "生成剧本",
                status: "cancelled",
                message: "用户已停止本次生成。",
                updatedAt: "2026-06-06T00:03:12.000Z"
              }
            ]
          }
        ],
        updatedAt: "2026-06-06T00:05:00.000Z"
      })
    );

    expect(loadSavedWorkspaceDraft(storage)?.generationRuns[0]?.status).toBe("cancelled");
    expect(loadSavedWorkspaceDraft(storage)?.generationRuns[0]?.stages[0]?.status).toBe("cancelled");
  });

  it("marks interrupted running generation runs as failed and retryable on load", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      workspaceDraftStorageKey,
      JSON.stringify({
        title: "Interrupted Draft",
        style: "cinematic",
        novelText: "Chapter 1\nText",
        yamlText: "work:\n  title: Interrupted Draft\n",
        selectedSceneId: null,
        revisionHistory: [],
        generationRuns: [
          {
            id: "run-running",
            title: "Interrupted Draft",
            model: "gpt-4.1-mini",
            chapterCount: 2,
            status: "running",
            startedAt: "2026-06-06T00:03:00.000Z",
            stages: [
              {
                id: "chapter_event_extract",
                label: "逐章事件",
                status: "running",
                message: "正在抽取第 1 章事件",
                artifacts: [
                  {
                    kind: "chapter_events",
                    summary: "第 1 章事件已保存",
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
                    },
                    createdAt: "2026-06-06T00:03:08.000Z"
                  }
                ],
                updatedAt: "2026-06-06T00:03:08.000Z"
              }
            ]
          }
        ],
        updatedAt: "2026-06-06T00:05:00.000Z"
      })
    );

    const restored = loadSavedWorkspaceDraft(storage)?.generationRuns[0];

    expect(restored).toMatchObject({
      id: "run-running",
      status: "failed",
      canRetry: true,
      error: "上次生成在页面关闭或刷新时中断，可从已保存阶段继续。",
      completedAt: "2026-06-06T00:05:00.000Z"
    });
    expect(restored?.stages[0]).toMatchObject({
      id: "chapter_event_extract",
      status: "failed",
      message: "上次生成在页面关闭或刷新时中断，可从已保存阶段继续。"
    });
    expect(restored?.stages[0]?.artifacts?.[0]?.checkpoint).toBeTruthy();
  });

  it("restores interrupted generation runs without checkpoints as retry-only failures", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      workspaceDraftStorageKey,
      JSON.stringify({
        title: "Interrupted Before Checkpoint",
        style: "cinematic",
        novelText: "Chapter 1\nText",
        yamlText: "work:\n  title: Interrupted Before Checkpoint\n",
        selectedSceneId: null,
        revisionHistory: [],
        generationRuns: [
          {
            id: "run-before-checkpoint",
            title: "Interrupted Before Checkpoint",
            model: "gpt-4.1-mini",
            chapterCount: 2,
            status: "running",
            startedAt: "2026-06-06T00:03:00.000Z",
            stages: [
              {
                id: "connection_check",
                label: "连接 AI",
                status: "running",
                message: "正在检查 provider",
                updatedAt: "2026-06-06T00:03:08.000Z"
              }
            ]
          }
        ],
        updatedAt: "2026-06-06T00:05:00.000Z"
      })
    );

    const restored = loadSavedWorkspaceDraft(storage)?.generationRuns[0];

    expect(restored).toMatchObject({
      id: "run-before-checkpoint",
      status: "failed",
      canRetry: true,
      error: "上次生成在页面关闭或刷新时中断，请重新调用当前 AI 配置。",
      recoveryHint: "还没有保存可续跑的阶段产物，可用当前 AI 配置重新生成。",
      completedAt: "2026-06-06T00:05:00.000Z"
    });
    expect(restored?.stages[0]).toMatchObject({
      id: "connection_check",
      status: "failed",
      message: "上次生成在页面关闭或刷新时中断，请重新调用当前 AI 配置。"
    });
  });

  it("clears the saved workspace draft", () => {
    const storage = createMemoryStorage();
    saveWorkspaceDraft(
      {
        title: "雾港来信",
        style: "cinematic",
        novelText: "正文",
        yamlText: "work: {}",
        selectedSceneId: null,
        revisionHistory: [],
        generationRuns: []
      },
      storage
    );

    clearSavedWorkspaceDraft(storage);

    expect(loadSavedWorkspaceDraft(storage)).toBeNull();
  });

  it("does not crash when browser storage rejects a large draft", () => {
    const storage: AiSettingsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined
    };

    expect(() =>
      saveWorkspaceDraft(
        {
          title: "长篇",
          style: "cinematic",
          novelText: "正文".repeat(1000),
          yamlText: "work: {}",
          selectedSceneId: null,
          revisionHistory: [],
          generationRuns: []
        },
        storage
      )
    ).not.toThrow();
  });
});
