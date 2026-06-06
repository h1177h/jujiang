import { PencilLine } from "lucide-react";
import type { ActiveEditorIssue, EditorIssueTargetField } from "../core/editorIssues";
import {
  parseDialogueInput,
  parseListInput,
  serializeDialogueInput,
  type ScenePatch
} from "../core/sceneEditor";
import type { Scene } from "../core/types";

export function SceneInspector({
  scene,
  activeEditorIssue,
  onPatch,
  onRegenerate
}: {
  scene: Scene;
  activeEditorIssue: ActiveEditorIssue | null;
  onPatch: (patch: ScenePatch) => void;
  onRegenerate: () => void;
}) {
  const highlightClass = (targetField: EditorIssueTargetField) =>
    activeEditorIssue?.targetField === targetField ? "inspector-field highlighted" : "inspector-field";

  return (
    <section className="scene-inspector">
      <div className="scene-card-top">
        <span>{scene.id}</span>
        <strong>{scene.pacing}</strong>
      </div>
      <div className="editor-heading">
        <PencilLine size={18} />
        <h3>场景编辑器</h3>
        <button className="secondary-action compact" type="button" onClick={onRegenerate}>
          AI 补强
        </button>
      </div>
      <p className="sync-note">修改会立即同步到 YAML，并触发 Schema 校验。</p>
      {activeEditorIssue ? (
        <div className={`active-quality-callout ${activeEditorIssue.severity}`}>
          <strong>{activeEditorIssue.label}</strong>
          <p>{activeEditorIssue.detail}</p>
          <span>{activeEditorIssue.actionHint}</span>
        </div>
      ) : null}

      <label className="inspector-field">
        场景标题
        <input value={scene.title} onChange={(event) => onPatch({ title: event.target.value })} />
      </label>
      <label className={highlightClass("goal")}>
        场景目标
        <textarea
          className="compact-editor"
          value={scene.goal}
          onChange={(event) => onPatch({ goal: event.target.value })}
        />
      </label>
      <div className="inspector-grid">
        <label className="inspector-field">
          地点
          <input value={scene.location} onChange={(event) => onPatch({ location: event.target.value })} />
        </label>
        <label className="inspector-field">
          时间
          <input value={scene.time} onChange={(event) => onPatch({ time: event.target.value })} />
        </label>
      </div>
      <div className="inspector-grid">
        <label className={highlightClass("conflict")}>
          冲突等级
          <select
            value={scene.conflict.level}
            onChange={(event) =>
              onPatch({
                conflict: {
                  ...scene.conflict,
                  level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5
                }
              })
            }
          >
            {[1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="inspector-field">
          节奏
          <select
            value={scene.pacing}
            onChange={(event) => onPatch({ pacing: event.target.value as ScenePatch["pacing"] })}
          >
            <option value="quiet">quiet</option>
            <option value="steady">steady</option>
            <option value="tense">tense</option>
            <option value="cliffhanger">cliffhanger</option>
          </select>
        </label>
      </div>
      <label className={highlightClass("conflict")}>
        冲突说明
        <textarea
          className="compact-editor"
          value={scene.conflict.reason}
          onChange={(event) =>
            onPatch({
              conflict: {
                ...scene.conflict,
                reason: event.target.value
              }
            })
          }
        />
      </label>
      <label className={highlightClass("characters")}>
        出场人物
        <textarea
          className="compact-editor"
          value={scene.characters.join("\n")}
          onChange={(event) => onPatch({ characters: parseListInput(event.target.value) })}
        />
      </label>
      <label className="inspector-field">
        动作描写
        <textarea
          className="compact-editor tall"
          value={scene.action.join("\n")}
          onChange={(event) => onPatch({ action: parseListInput(event.target.value) })}
        />
      </label>
      <label className={highlightClass("dialogue")}>
        对白
        <textarea
          className="compact-editor tall"
          value={serializeDialogueInput(scene.dialogue)}
          onChange={(event) => onPatch({ dialogue: parseDialogueInput(event.target.value, scene) })}
        />
      </label>
      <label className="inspector-field">
        旁白 / 转场
        <textarea
          className="compact-editor"
          value={scene.narrationOrTransition}
          onChange={(event) => onPatch({ narrationOrTransition: event.target.value })}
        />
      </label>
      <label className="inspector-field">
        情绪
        <input value={scene.emotion} onChange={(event) => onPatch({ emotion: event.target.value })} />
      </label>
      <label className={highlightClass("revisionNotes")}>
        修订建议
        <textarea
          className="compact-editor tall"
          value={scene.revisionNotes.join("\n")}
          onChange={(event) => onPatch({ revisionNotes: parseListInput(event.target.value) })}
        />
      </label>
      <div className={highlightClass("source")}>
        <h4>原文依据</h4>
        <p className="source-note">
          第 {scene.source.chapterIndex} 章，段落 {scene.source.paragraphIndexes.join("、")}，行 {scene.source.lineStart}-
          {scene.source.lineEnd}
        </p>
        <blockquote className="source-excerpt">{scene.source.excerpt}</blockquote>
      </div>
    </section>
  );
}
