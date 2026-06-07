import { PencilLine } from "lucide-react";
import type { ActiveEditorIssue, EditorIssueTargetField } from "../core/editorIssues";
import {
  parseDialogueInput,
  parseListInput,
  serializeDialogueInput,
  type ScenePatch
} from "../core/sceneEditor";
import { buildSourceTrace } from "../core/sourceTrace";
import type { Scene } from "../core/types";

export function SceneInspector({
  scene,
  novelText,
  activeEditorIssue,
  onPatch,
  onRegenerate
}: {
  scene: Scene;
  novelText: string;
  activeEditorIssue: ActiveEditorIssue | null;
  onPatch: (patch: ScenePatch) => void;
  onRegenerate: () => void;
}) {
  const highlightClass = (targetField: EditorIssueTargetField) =>
    activeEditorIssue?.targetField === targetField ? "inspector-field highlighted" : "inspector-field";
  const sourceTrace = buildSourceTrace(scene.source, novelText);

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

      <label className={highlightClass("title")}>
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
        <label className={highlightClass("location")}>
          地点
          <input value={scene.location} onChange={(event) => onPatch({ location: event.target.value })} />
        </label>
        <label className={highlightClass("time")}>
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
        <label className={highlightClass("pacing")}>
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
      <label className={highlightClass("action")}>
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
      <label className={highlightClass("narrationOrTransition")}>
        旁白 / 转场
        <textarea
          className="compact-editor"
          value={scene.narrationOrTransition}
          onChange={(event) => onPatch({ narrationOrTransition: event.target.value })}
        />
      </label>
      <label className={highlightClass("emotion")}>
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
          {sourceTrace.locationLabel}
        </p>
        <div className="source-trace-lines" aria-label="原文行号追溯">
          {sourceTrace.lines.map((line) => (
            <div className={line.isMatched ? "source-trace-line matched" : "source-trace-line"} key={line.lineNumber}>
              <span>{line.lineNumber}</span>
              <p>{line.text || "（空行）"}</p>
            </div>
          ))}
        </div>
        {sourceTrace.matchedLineCount === 0 ? (
          <p className="source-warning">当前原文中没有找到摘录原句，请核对 YAML source 或重新生成带来源的版本。</p>
        ) : null}
        <blockquote className="source-excerpt">{sourceTrace.excerpt}</blockquote>
      </div>
    </section>
  );
}
