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
