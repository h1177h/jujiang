import { Clock3, FilePenLine, RefreshCw, Square, TriangleAlert } from "lucide-react";
import {
  formatGenerationRunArtifactDiagnostics,
  formatGenerationRunRecoverySummary,
  formatGenerationRunRetryAction,
  formatGenerationRunStatus,
  selectVisibleGenerationArtifacts,
  type GenerationRun
} from "../core/generationRun";

export function GenerationRunPanel({
  run,
  history,
  onCancel,
  onRetry,
  onSelectRun,
  onUseYamlDraft
}: {
  run: GenerationRun | null;
  history: GenerationRun[];
  onCancel: (run: GenerationRun) => void;
  onRetry: (run: GenerationRun) => void;
  onSelectRun: (run: GenerationRun) => void;
  onUseYamlDraft: (yamlText: string, label: string) => void;
}) {
  const activeRun = run ?? history[0] ?? null;
  if (!activeRun) {
    return (
      <div className="generation-run idle">
        <div className="generation-run-head">
          <div>
            <strong>生成任务</strong>
            <span>等待提交小说原文和 AI 配置</span>
          </div>
          <div className="generation-run-actions">
            <em>待启动</em>
          </div>
        </div>
        <div className="generation-stages">
          {["连接测试", "长文本解析", "结构修复", "YAML 写入"].map((label) => (
            <div className="generation-stage" key={label}>
              <span className="stage-dot" />
              <div>
                <strong>{label}</strong>
                <p>开始生成后会记录阶段状态、产物和失败诊断。</p>
              </div>
            </div>
          ))}
        </div>
        <p className="generation-meta">
          <Clock3 size={14} />
          任务运行后可在这里查看 provider、耗时、阶段产物、错误原文和可重试建议。
        </p>
      </div>
    );
  }

  const statusLabel =
    activeRun.status === "completed"
      ? "已完成"
      : activeRun.status === "failed"
        ? "需要处理"
        : activeRun.status === "cancelled"
          ? "已停止"
          : "进行中";
  const elapsedSeconds = Math.max(
    0,
    Math.round(
      ((activeRun.completedAt ? new Date(activeRun.completedAt).getTime() : Date.now()) -
        new Date(activeRun.startedAt).getTime()) /
        1000
    )
  );
  const recentRuns = history.slice(0, 4);
  const retryAction = formatGenerationRunRetryAction(activeRun);
  const recoverySummary = formatGenerationRunRecoverySummary(activeRun);

  return (
    <div className={`generation-run ${activeRun.status}`}>
      <div className="generation-run-head">
        <div>
          <strong>生成任务</strong>
          <span>
            {activeRun.model} · {activeRun.chapterCount} 章 · {elapsedSeconds}s
          </span>
        </div>
        <div className="generation-run-actions">
          {activeRun.status === "running" ? (
            <button
              className="cancel-action"
              type="button"
              onClick={() => onCancel(activeRun)}
              title="停止当前 AI 生成请求"
            >
              <Square size={12} />
              停止
            </button>
          ) : null}
          {retryAction ? (
            <button
              type="button"
              onClick={() => onRetry(activeRun)}
              title={retryAction.title}
            >
              <RefreshCw size={13} />
              {retryAction.label}
            </button>
          ) : null}
          <em>{statusLabel}</em>
        </div>
      </div>
      <div className="generation-stages">
        {activeRun.stages.map((stage) => (
          <div className={`generation-stage ${stage.status}`} key={stage.id}>
            <span className="stage-dot" />
            <div>
              <strong>{stage.label}</strong>
              <p>
                {stage.message}
                {stage.total ? ` · ${stage.current ?? 0}/${stage.total}` : ""}
              </p>
              {stage.artifacts?.length ? (
                <div className="stage-artifacts">
                  {selectVisibleGenerationArtifacts(stage.artifacts).map((artifact) => (
                    <span key={`${artifact.kind}-${artifact.createdAt}`}>
                      {artifact.summary}
                      {artifact.detail ? <small>{artifact.detail}</small> : null}
                      {formatGenerationRunArtifactDiagnostics(artifact).map((line) => (
                        <small key={line}>{line}</small>
                      ))}
                      {artifact.yamlDraft ? (
                        <button
                          className="artifact-action"
                          type="button"
                          onClick={() => onUseYamlDraft(artifact.yamlDraft ?? "", artifact.summary)}
                          title="把这份阶段草稿写入右侧 YAML，继续校验和编辑"
                        >
                          <FilePenLine size={12} />
                          接管草稿
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {activeRun.error ? (
        <div className="generation-error-block">
          <p className="generation-error">
            <TriangleAlert size={14} />
            {activeRun.error}
          </p>
          <p>
            {activeRun.status === "cancelled"
              ? "可以调整原文或配置后重新生成。"
              : activeRun.canRetry
                ? activeRun.recoveryHint
                : "请先处理当前阶段提示的问题，再重新生成。"}
          </p>
          {recoverySummary ? <p>{recoverySummary}</p> : null}
        </div>
      ) : (
        <p className="generation-meta">
          <Clock3 size={14} />
          阶段记录会保留本次调用路径，便于判断卡在连接、事件抽取、结构修复还是 YAML 写入。
        </p>
      )}
      {recentRuns.length > 1 ? (
        <div className="generation-history">
          <div className="generation-history-head">
            <strong>最近生成</strong>
            <span>{recentRuns.length} 条</span>
          </div>
          <div className="generation-history-list">
            {recentRuns.map((item) => (
              <button
                key={item.id}
                className={item.id === activeRun.id ? "selected" : ""}
                type="button"
                onClick={() => onSelectRun(item)}
              >
                <span className={`history-status ${item.status}`} />
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.model} · {new Date(item.startedAt).toLocaleTimeString()}
                  </span>
                </div>
                <em>{formatGenerationRunStatus(item.status)}</em>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
