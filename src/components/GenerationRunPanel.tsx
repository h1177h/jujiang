import { Clock3, RefreshCw, TriangleAlert } from "lucide-react";
import { formatGenerationRunStatus, type GenerationRun } from "../core/generationRun";

export function GenerationRunPanel({
  run,
  history,
  onRetry,
  onSelectRun
}: {
  run: GenerationRun | null;
  history: GenerationRun[];
  onRetry: () => void;
  onSelectRun: (run: GenerationRun) => void;
}) {
  const activeRun = run ?? history[0] ?? null;
  if (!activeRun) return null;

  const statusLabel =
    activeRun.status === "completed" ? "已完成" : activeRun.status === "failed" ? "需要处理" : "进行中";
  const elapsedSeconds = Math.max(
    0,
    Math.round(
      ((activeRun.completedAt ? new Date(activeRun.completedAt).getTime() : Date.now()) -
        new Date(activeRun.startedAt).getTime()) /
        1000
    )
  );
  const recentRuns = history.slice(0, 4);

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
          {activeRun.status === "failed" ? (
            <button type="button" onClick={onRetry} title="重新调用当前 AI 配置">
              <RefreshCw size={13} />
              重试
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
                  {stage.artifacts.slice(-3).map((artifact) => (
                    <span key={`${artifact.kind}-${artifact.createdAt}`}>
                      {artifact.summary}
                      {artifact.detail ? <small>{artifact.detail}</small> : null}
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
            {activeRun.canRetry
              ? activeRun.recoveryHint
              : "请先处理当前阶段提示的问题，再重新生成。"}
          </p>
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
