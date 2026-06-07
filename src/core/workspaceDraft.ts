import type { AiSettingsStorage } from "./apiSettings";
import type { AiGenerationArtifact, AiGenerationDiagnostic } from "./aiProvider";
import type { AdaptationStyle } from "./types";
import type { ScreenplayRevision } from "./revisionHistory";
import type { GenerationRun, GenerationRunStage } from "./generationRun";

export interface SavedWorkspaceDraft {
  title: string;
  style: AdaptationStyle;
  novelText: string;
  yamlText: string;
  selectedSceneId: string | null;
  revisionHistory: ScreenplayRevision[];
  generationRuns: GenerationRun[];
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
      (parsed.generationRuns !== undefined && !Array.isArray(parsed.generationRuns)) ||
      typeof parsed.updatedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.updatedAt))
    ) {
      return null;
    }

    const revisionHistory = parsed.revisionHistory.filter(isScreenplayRevision).slice(0, 8);
    const generationRuns = (parsed.generationRuns ?? []).filter(isGenerationRun).slice(0, 8);

    return {
      title: parsed.title,
      style: parsed.style,
      novelText: parsed.novelText,
      yamlText: parsed.yamlText,
      selectedSceneId: parsed.selectedSceneId,
      revisionHistory,
      generationRuns,
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
        generationRuns: draft.generationRuns.slice(0, 8),
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

function isGenerationRun(value: unknown): value is GenerationRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<GenerationRun>;
  return (
    typeof run.id === "string" &&
    typeof run.title === "string" &&
    typeof run.model === "string" &&
    typeof run.chapterCount === "number" &&
    isGenerationRunStatus(run.status) &&
    typeof run.startedAt === "string" &&
    (run.completedAt === undefined || typeof run.completedAt === "string") &&
    (run.error === undefined || typeof run.error === "string") &&
    (run.canRetry === undefined || typeof run.canRetry === "boolean") &&
    (run.recoveryHint === undefined || typeof run.recoveryHint === "string") &&
    Array.isArray(run.stages) &&
    run.stages.every(isGenerationRunStage)
  );
}

function isGenerationRunStage(value: unknown): value is GenerationRunStage {
  if (!value || typeof value !== "object") return false;
  const stage = value as Partial<GenerationRunStage>;
  return (
    typeof stage.id === "string" &&
    typeof stage.label === "string" &&
    isGenerationRunStageStatus(stage.status) &&
    typeof stage.message === "string" &&
    (stage.current === undefined || typeof stage.current === "number") &&
    (stage.total === undefined || typeof stage.total === "number") &&
    (stage.artifacts === undefined ||
      (Array.isArray(stage.artifacts) && stage.artifacts.every(isGenerationRunArtifact))) &&
    typeof stage.updatedAt === "string"
  );
}

function isGenerationRunArtifact(value: unknown): value is AiGenerationArtifact & { createdAt: string } {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<AiGenerationArtifact & { createdAt: string }>;
  return (
    typeof artifact.kind === "string" &&
    typeof artifact.summary === "string" &&
    (artifact.detail === undefined || typeof artifact.detail === "string") &&
    (artifact.diagnostic === undefined || isGenerationArtifactDiagnostic(artifact.diagnostic)) &&
    typeof artifact.createdAt === "string"
  );
}

function isGenerationArtifactDiagnostic(value: unknown): value is AiGenerationDiagnostic {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Partial<AiGenerationDiagnostic>;
  return (
    isOptionalStringArray(diagnostic.initialIssues) &&
    isOptionalStringArray(diagnostic.repairedIssues) &&
    (diagnostic.initialExcerpt === undefined || typeof diagnostic.initialExcerpt === "string") &&
    (diagnostic.repairedExcerpt === undefined || typeof diagnostic.repairedExcerpt === "string")
  );
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function isGenerationRunStatus(value: unknown): value is GenerationRun["status"] {
  return value === "idle" || value === "running" || value === "completed" || value === "failed";
}

function isGenerationRunStageStatus(value: unknown): value is GenerationRunStage["status"] {
  return value === "pending" || value === "running" || value === "done" || value === "failed";
}
