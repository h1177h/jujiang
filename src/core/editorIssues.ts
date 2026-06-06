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
