import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clipboard, Download, RefreshCw, TriangleAlert } from "lucide-react";
import {
  compareRevisionToCurrent,
  type RevisionDiffItem,
  type ScreenplayRevision
} from "../core/revisionHistory";
import type { ScreenplayYamlDiagnostic } from "../core/yaml";

interface ScreenplayYamlValidation {
  ok: boolean;
  errors: string[];
  issues?: ScreenplayYamlDiagnostic[];
}

export function DeliveryPanel({
  copyLabel,
  revisionHistory,
  validation,
  yamlText,
  onCopy,
  onDownload,
  onGenerate,
  onRestoreRevision,
  onSaveRevision,
  onSelectYamlIssue,
  onYamlChange
}: {
  copyLabel: string;
  revisionHistory: ScreenplayRevision[];
  validation: ScreenplayYamlValidation;
  yamlText: string;
  onCopy: () => void;
  onDownload: () => void;
  onGenerate: () => void;
  onRestoreRevision: (revision: ScreenplayRevision) => void;
  onSaveRevision: () => void;
  onSelectYamlIssue: (issue: ScreenplayYamlDiagnostic) => void;
  onYamlChange: (yamlText: string) => void;
}) {
  return (
    <section className="panel output-panel">
      <div className="panel-header">
        <div>
          <p className="section-kicker">Delivery</p>
          <h2>YAML 交付</h2>
        </div>
        <div className="toolbar">
          <button className="icon-button" type="button" onClick={onGenerate} title="重新生成">
            <RefreshCw size={18} />
          </button>
          <button className="icon-button text-button" type="button" onClick={onCopy} title="复制 YAML">
            <Clipboard size={18} />
            {copyLabel}
          </button>
          <button className="icon-button text-button" type="button" onClick={onDownload} title="下载 YAML">
            <Download size={18} />
            下载
          </button>
          <button className="icon-button text-button" type="button" onClick={onSaveRevision} title="保存当前版本">
            保存
          </button>
        </div>
      </div>

      <textarea
        className="yaml-editor"
        value={yamlText}
        onChange={(event) => onYamlChange(event.target.value)}
        spellCheck={false}
      />

      <div className={validation.ok ? "validation-box ok" : "validation-box error"}>
        {validation.ok ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
        <div>
          <strong>{validation.ok ? "Schema 校验通过" : "Schema 校验失败"}</strong>
          {validation.ok ? (
            <p>当前 YAML 可复制、下载和继续改写。</p>
          ) : validation.issues?.length ? (
            <ul className="validation-issue-list">
              {validation.issues.slice(0, 3).map((issue) => (
                <li key={`${issue.path}-${issue.message}`}>
                  {issue.sceneId && issue.targetField ? (
                    <button type="button" onClick={() => onSelectYamlIssue(issue)}>
                      {issue.sceneId} / {issue.fieldLabel}
                    </button>
                  ) : (
                    <span>
                      {issue.sceneId ? `${issue.sceneId} / ` : ""}
                      {issue.fieldLabel}
                    </span>
                  )}
                  <p>{issue.suggestion}</p>
                  <small>{issue.actionHint}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>{validation.errors.slice(0, 3).join("；")}</p>
          )}
        </div>
      </div>

      <RevisionHistoryPanel
        currentYaml={yamlText}
        history={revisionHistory}
        onRestore={onRestoreRevision}
      />
    </section>
  );
}

function RevisionHistoryPanel({
  currentYaml,
  history,
  onRestore
}: {
  currentYaml: string;
  history: ScreenplayRevision[];
  onRestore: (revision: ScreenplayRevision) => void;
}) {
  const [selectedRevisionId, setSelectedRevisionId] = useState(history[0]?.id ?? "");
  const selectedRevision = history.find((revision) => revision.id === selectedRevisionId) ?? history[0] ?? null;
  useEffect(() => {
    if (history.length && !history.some((revision) => revision.id === selectedRevisionId)) {
      setSelectedRevisionId(history[0].id);
    }
  }, [history, selectedRevisionId]);
  const diff = useMemo(
    () => (selectedRevision ? compareRevisionToCurrent(selectedRevision, currentYaml) : null),
    [currentYaml, selectedRevision]
  );
  const visibleDiffItems = diff?.items.filter((item) => item.kind !== "unchanged").slice(0, 6) ?? [];

  return (
    <div className="revision-history">
      <div className="analysis-card-head">
        <h3>版本历史</h3>
        <span>{history.length} 个版本</span>
      </div>
      <div className="revision-list">
        {history.map((revision) => (
          <article className={revision.id === selectedRevision?.id ? "selected" : ""} key={revision.id}>
            <button type="button" onClick={() => setSelectedRevisionId(revision.id)}>
              <strong>{revision.label}</strong>
              <span>{new Date(revision.createdAt).toLocaleString()}</span>
            </button>
            <button className="restore-revision" type="button" onClick={() => onRestore(revision)}>
              恢复
            </button>
          </article>
        ))}
      </div>
      {diff ? (
        <div className="revision-diff">
          <div className="revision-diff-head">
            <strong>与当前 YAML 对比</strong>
            <span>
              +{diff.summary.added} / -{diff.summary.removed} / 改 {diff.summary.changed}
            </span>
          </div>
          {visibleDiffItems.length ? (
            <div className="revision-diff-list">
              {visibleDiffItems.map((item, index) => (
                <RevisionDiffRow item={item} key={`${item.kind}-${item.lineNumber}-${index}`} />
              ))}
            </div>
          ) : (
            <p className="revision-diff-empty">当前 YAML 和这个版本没有内容差异。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RevisionDiffRow({ item }: { item: RevisionDiffItem }) {
  const label = item.kind === "added" ? "新增" : item.kind === "removed" ? "删除" : "变更";

  return (
    <div className={`revision-diff-row ${item.kind}`}>
      <span>{label}</span>
      <code>{item.kind === "added" ? item.after : item.kind === "removed" ? item.before : item.after}</code>
      {item.kind === "changed" ? <small>原：{item.before}</small> : null}
    </div>
  );
}
