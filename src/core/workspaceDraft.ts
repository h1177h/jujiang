import type { AiSettingsStorage } from "./apiSettings";
import type { AdaptationStyle } from "./types";
import type { ScreenplayRevision } from "./revisionHistory";

export interface SavedWorkspaceDraft {
  title: string;
  style: AdaptationStyle;
  novelText: string;
  yamlText: string;
  selectedSceneId: string | null;
  revisionHistory: ScreenplayRevision[];
  updatedAt: string;
}

export const workspaceDraftStorageKey = "jujiang.workspaceDraft";

export function loadSavedWorkspaceDraft(storage: AiSettingsStorage | null): SavedWorkspaceDraft | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(workspaceDraftStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedWorkspaceDraft>;

    if (
      typeof parsed.title !== "string" ||
      !isAdaptationStyle(parsed.style) ||
      typeof parsed.novelText !== "string" ||
      typeof parsed.yamlText !== "string" ||
      !isNullableString(parsed.selectedSceneId) ||
      !Array.isArray(parsed.revisionHistory) ||
      typeof parsed.updatedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.updatedAt))
    ) {
      return null;
    }

    const revisionHistory = parsed.revisionHistory.filter(isScreenplayRevision).slice(0, 8);

    return {
      title: parsed.title,
      style: parsed.style,
      novelText: parsed.novelText,
      yamlText: parsed.yamlText,
      selectedSceneId: parsed.selectedSceneId,
      revisionHistory,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceDraft(
  draft: Omit<SavedWorkspaceDraft, "updatedAt">,
  storage: AiSettingsStorage | null,
  date = new Date()
): void {
  if (!storage) return;
  try {
    storage.setItem(
      workspaceDraftStorageKey,
      JSON.stringify({
        ...draft,
        revisionHistory: draft.revisionHistory.slice(0, 8),
        updatedAt: date.toISOString()
      })
    );
  } catch {
    // Draft persistence is a convenience layer; writing failure must not block editing.
  }
}

export function clearSavedWorkspaceDraft(storage: AiSettingsStorage | null): void {
  if (!storage) return;
  storage.removeItem(workspaceDraftStorageKey);
}

function isAdaptationStyle(value: unknown): value is AdaptationStyle {
  return value === "balanced" || value === "cinematic" || value === "stage" || value === "short_drama";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isScreenplayRevision(value: unknown): value is ScreenplayRevision {
  if (!value || typeof value !== "object") return false;
  const revision = value as Partial<ScreenplayRevision>;
  return (
    typeof revision.id === "string" &&
    typeof revision.label === "string" &&
    typeof revision.yamlText === "string" &&
    typeof revision.createdAt === "string"
  );
}
