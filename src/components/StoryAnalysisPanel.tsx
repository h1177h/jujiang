import type { CSSProperties } from "react";
import type { ActiveEditorIssue } from "../core/editorIssues";
import {
  formatStoryAnalysisPanelLabels,
  type SceneQualityIssue,
  type StoryAnalysis
} from "../core/storyAnalysis";

export function StoryAnalysisPanel({
  analysis,
  selectedSceneId,
  activeEditorIssue,
  onSelectScene,
  onSelectIssue
}: {
  analysis: StoryAnalysis;
  selectedSceneId: string;
  activeEditorIssue: ActiveEditorIssue | null;
  onSelectScene: (sceneId: string) => void;
  onSelectIssue: (issue: SceneQualityIssue) => void;
}) {
  const labels = formatStoryAnalysisPanelLabels(analysis);

  return (
    <div className="analysis-board" aria-label="故事分析区">
      <article className="analysis-card chapter-map">
        <div className="analysis-card-head">
          <h3>章节到场景</h3>
          <span>{labels.sourceCoverage}</span>
        </div>
        <div className="chapter-map-list">
          {analysis.chapterCoverage.map((chapter) => (
            <div key={chapter.chapterIndex} className="chapter-map-row">
              <div>
                <strong>
                  第 {chapter.chapterIndex} 章：{chapter.title}
                </strong>
                <p>{chapter.coverageLabel}</p>
              </div>
              <div className="scene-chip-list">
                {chapter.sceneIds.map((sceneId) => (
                  <button
                    key={sceneId}
                    className={sceneId === selectedSceneId ? "scene-chip active" : "scene-chip"}
                    type="button"
                    onClick={() => onSelectScene(sceneId)}
                  >
                    {sceneId}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="analysis-card conflict-curve">
        <div className="analysis-card-head">
          <h3>冲突曲线</h3>
          <span>{labels.readyScenes}</span>
        </div>
        <div className="curve-bars">
          {analysis.conflictCurve.map((point) => (
            <button
              key={point.sceneId}
              className={point.sceneId === selectedSceneId ? "curve-bar active" : "curve-bar"}
              style={{ "--level": point.level } as CSSProperties}
              type="button"
              onClick={() => onSelectScene(point.sceneId)}
              title={`${point.sceneId} / ${point.pacing} / 冲突 ${point.level}`}
            >
              <span>{point.level}</span>
              <small>{point.sceneId.replace("scene-", "")}</small>
            </button>
          ))}
        </div>
      </article>

      <article className="analysis-card quality-list">
        <div className="analysis-card-head">
          <h3>质量检查</h3>
          <span>{labels.qualityIssues}</span>
        </div>
        {analysis.qualityIssues.length > 0 ? (
          <div className="quality-items">
            {analysis.qualityIssues.slice(0, 6).map((issue) => (
              <button
                key={`${issue.sceneId}-${issue.label}`}
                className={`quality-item ${issue.severity} ${
                  activeEditorIssue?.sceneId === issue.sceneId && activeEditorIssue.label === issue.label
                    ? "active"
                    : ""
                }`}
                type="button"
                onClick={() => onSelectIssue(issue)}
              >
                <strong>
                  {issue.sceneId} / {issue.label}
                </strong>
                <span>{issue.detail}</span>
                <small>{issue.actionHint}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="quality-empty">当前场景结构完整，可以进入下一轮文字打磨。</p>
        )}
      </article>
    </div>
  );
}
