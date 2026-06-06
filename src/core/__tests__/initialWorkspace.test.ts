import { describe, expect, it } from "vitest";
import { createInitialWorkspaceState } from "../initialWorkspace";
import type { SavedWorkspaceDraft } from "../workspaceDraft";

describe("initial workspace state", () => {
  it("starts from a blank user workspace when no saved draft exists", () => {
    const state = createInitialWorkspaceState(null);

    expect(state.title).toBe("");
    expect(state.novelText).toBe("");
    expect(state.yamlText).toBe("");
    expect(state.revisionHistory).toEqual([]);
    expect(state.selectedSceneId).toBeNull();
    expect(state.generationRuns).toEqual([]);
  });

  it("restores the saved draft instead of replacing it with examples", () => {
    const draft: SavedWorkspaceDraft = {
      title: "我的小说",
      style: "short_drama",
      novelText: "第一章\n正文",
      yamlText: "work:\n  title: 我的小说\n",
      selectedSceneId: "scene-01",
      revisionHistory: [
        {
          id: "rev-1",
          label: "手动保存",
          yamlText: "work:\n  title: 我的小说\n",
          createdAt: "2026-06-06T00:00:00.000Z"
        }
      ],
      generationRuns: [],
      updatedAt: "2026-06-06T00:00:00.000Z"
    };

    const state = createInitialWorkspaceState(draft);

    expect(state.title).toBe("我的小说");
    expect(state.style).toBe("short_drama");
    expect(state.novelText).toBe("第一章\n正文");
    expect(state.yamlText).toBe("work:\n  title: 我的小说\n");
    expect(state.revisionHistory).toHaveLength(1);
    expect(state.selectedSceneId).toBe("scene-01");
  });
});
