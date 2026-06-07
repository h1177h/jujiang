import type { ScenePatch } from "./sceneEditor";
import type { ScreenplayYamlDiagnostic } from "./yaml";

export type EditorIssueTargetField = NonNullable<ScreenplayYamlDiagnostic["targetField"]>;

export interface ActiveEditorIssue {
  sceneId: string;
  label: string;
  detail: string;
  severity: "warning" | "risk" | "error";
  targetField: EditorIssueTargetField;
  actionHint: string;
}

export function patchTouchesEditorIssueField(
  patch: ScenePatch,
  targetField: EditorIssueTargetField
): boolean {
  if (targetField === "source") return false;
  return Object.prototype.hasOwnProperty.call(patch, targetField);
}

export function editorIssueFromYamlDiagnostic(
  issue: ScreenplayYamlDiagnostic
): ActiveEditorIssue | null {
  if (!issue.sceneId || !issue.targetField) return null;

  return {
    sceneId: issue.sceneId,
    label: issue.fieldLabel,
    detail: issue.suggestion,
    severity: "error",
    targetField: issue.targetField,
    actionHint: issue.actionHint
  };
}

export function firstEditorIssueFromYamlDiagnostics(
  issues?: ScreenplayYamlDiagnostic[]
): ActiveEditorIssue | null {
  for (const issue of issues ?? []) {
    const editorIssue = editorIssueFromYamlDiagnostic(issue);
    if (editorIssue && editorIssue.targetField !== "source") {
      return editorIssue;
    }
  }
  return null;
}
