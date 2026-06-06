import type { GenerationRun } from "./generationRun";
import type { ScreenplayRevision } from "./revisionHistory";
import type { AdaptationStyle } from "./types";
import type { SavedWorkspaceDraft } from "./workspaceDraft";

export interface InitialWorkspaceState {
  title: string;
  style: AdaptationStyle;
  novelText: string;
  yamlText: string;
  selectedSceneId: string | null;
  revisionHistory: ScreenplayRevision[];
  generationRuns: GenerationRun[];
}

export function createBlankWorkspaceState(): InitialWorkspaceState {
  return {
    title: "",
    style: "cinematic",
    novelText: "",
    yamlText: "",
    selectedSceneId: null,
    revisionHistory: [],
    generationRuns: []
  };
}

export function createInitialWorkspaceState(
  draft: SavedWorkspaceDraft | null
): InitialWorkspaceState {
  if (!draft) return createBlankWorkspaceState();

  return {
    title: draft.title,
    style: draft.style,
    novelText: draft.novelText,
    yamlText: draft.yamlText,
    selectedSceneId: draft.selectedSceneId,
    revisionHistory: draft.revisionHistory,
    generationRuns: draft.generationRuns
  };
}

export function hasWorkspaceContent(state: InitialWorkspaceState): boolean {
  return Boolean(
    state.title.trim() ||
      state.novelText.trim() ||
      state.yamlText.trim() ||
      state.selectedSceneId ||
      state.revisionHistory.length ||
      state.generationRuns.length
  );
}
