import type { AiGenerationProgress } from "./aiProvider";

export type GenerationRunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type GenerationRunStageId =
  | "source_check"
  | "connection_check"
  | AiGenerationProgress["stage"]
  | "yaml_ready";

export interface GenerationRunStage {
  id: GenerationRunStageId;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  message: string;
  current?: number;
  total?: number;
  updatedAt: string;
}

export interface GenerationRun {
  id: string;
  title: string;
  model: string;
  chapterCount: number;
  status: GenerationRunStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  stages: GenerationRunStage[];
}

export function createGenerationRun({
  title,
  model,
  chapterCount,
  date = new Date()
}: {
  title: string;
  model: string;
  chapterCount: number;
  date?: Date;
}): GenerationRun {
  const now = date.toISOString();
  return {
    id: `${now}-${slug(title || "untitled")}`,
    title: title || "未命名作品",
    model,
    chapterCount,
    status: "running",
    startedAt: now,
    stages: [
      createStage("source_check", "解析原文", "正在检查原文和章节结构", "running", now),
      createStage("connection_check", "连接 AI", "等待连接检查", "pending", now)
    ]
  };
}

export function updateGenerationRunStage(
  run: GenerationRun,
  event: AiGenerationProgress & { date?: Date }
): GenerationRun {
  const now = (event.date ?? new Date()).toISOString();
  const stageId = event.stage;
  const existingIndex = run.stages.findIndex((stage) => stage.id === stageId);
  const stages = run.stages.map((stage) =>
    stage.status === "running" ? { ...stage, status: "done" as const, updatedAt: now } : stage
  );
  const nextStage: GenerationRunStage = {
    ...(existingIndex >= 0
      ? stages[existingIndex]
      : createStage(stageId, labelStage(stageId), event.message, "running", now)),
    status: "running",
    message: event.message,
    current: event.current,
    total: event.total,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    stages[existingIndex] = nextStage;
  } else {
    stages.push(nextStage);
  }

  return {
    ...run,
    stages
  };
}

export function markGenerationRunConnection(run: GenerationRun, message: string, date = new Date()): GenerationRun {
  const now = date.toISOString();
  return {
    ...run,
    stages: run.stages.map((stage) => {
      if (stage.id === "source_check") {
        return { ...stage, status: "done", updatedAt: now };
      }
      if (stage.id === "connection_check") {
        return { ...stage, status: "running", message, updatedAt: now };
      }
      return stage;
    })
  };
}

export function completeGenerationRun(run: GenerationRun, date = new Date()): GenerationRun {
  const now = date.toISOString();
  const stages = run.stages.map((stage) => ({
    ...stage,
    status: "done" as const,
    updatedAt: stage.status === "running" ? now : stage.updatedAt
  }));
  const hasYamlReady = stages.some((stage) => stage.id === "yaml_ready");

  return {
    ...run,
    status: "completed",
    completedAt: now,
    stages: [
      ...stages,
      ...(hasYamlReady ? [] : [createStage("yaml_ready", "写入 YAML", "剧本已同步到可编辑 YAML", "done", now)])
    ]
  };
}

export function failGenerationRun(run: GenerationRun, error: string, date = new Date()): GenerationRun {
  const now = date.toISOString();
  let marked = false;
  const stages = run.stages.map((stage) => {
    if (stage.status === "running") {
      marked = true;
      return { ...stage, status: "failed" as const, message: error, updatedAt: now };
    }
    return stage;
  });

  return {
    ...run,
    status: "failed",
    error,
    completedAt: now,
    stages: marked ? stages : [...stages, createStage("yaml_ready", "写入 YAML", error, "failed", now)]
  };
}

export function cancelGenerationRun(run: GenerationRun, date = new Date()): GenerationRun {
  const now = date.toISOString();
  let marked = false;
  const stages = run.stages.map((stage) => {
    if (stage.status === "running") {
      marked = true;
      return { ...stage, status: "failed" as const, message: "生成任务已取消", updatedAt: now };
    }
    return stage;
  });

  return {
    ...run,
    status: "cancelled",
    error: "生成任务已取消",
    completedAt: now,
    stages: marked ? stages : [...stages, createStage("yaml_ready", "写入 YAML", "生成任务已取消", "failed", now)]
  };
}

export function pushGenerationRunHistory(
  history: GenerationRun[],
  run: GenerationRun,
  limit = 8
): GenerationRun[] {
  return [run, ...history.filter((item) => item.id !== run.id)].slice(0, limit);
}

export function buildGenerationRunDiagnostic(run: GenerationRun): string {
  const failedStage = run.stages.find((stage) => stage.status === "failed");
  const lines = [
    `Title: ${run.title}`,
    `Model: ${run.model}`,
    `Chapters: ${run.chapterCount}`,
    `Status: ${run.status}`,
    failedStage ? `Failed stage: ${failedStage.label}` : null,
    run.error ? `Error: ${run.error}` : null,
    `Run id: ${run.id}`,
    `Started: ${run.startedAt}`,
    run.completedAt ? `Completed: ${run.completedAt}` : null
  ];

  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function createStage(
  id: GenerationRunStageId,
  label: string,
  message: string,
  status: GenerationRunStage["status"],
  updatedAt: string
): GenerationRunStage {
  return {
    id,
    label,
    status,
    message,
    updatedAt
  };
}

function labelStage(stage: GenerationRunStageId): string {
  const labels: Record<GenerationRunStageId, string> = {
    source_check: "解析原文",
    connection_check: "连接 AI",
    event_extract: "抽取事件",
    chapter_event_extract: "逐章事件",
    story_bible_generate: "合并故事圣经",
    screenplay_generate: "生成剧本",
    schema_repair: "修复结构",
    yaml_ready: "写入 YAML"
  };
  return labels[stage];
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
      .slice(0, 32) || "run"
  );
}
