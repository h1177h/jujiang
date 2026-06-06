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
      updatedAt: "2026-06-06T00:05:00.000Z"
    });
  });

  it("ignores corrupted workspace drafts", () => {
    const storage = createMemoryStorage();
    storage.setItem(workspaceDraftStorageKey, JSON.stringify({ title: "bad", style: "unknown" }));

    expect(loadSavedWorkspaceDraft(storage)).toBeNull();
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
        revisionHistory: []
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
          revisionHistory: []
        },
        storage
      )
    ).not.toThrow();
  });
});
