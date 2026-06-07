import type { AiGenerationArtifact, AiGenerationProgress, AiGenerationResumeCheckpoint } from "./aiProvider";
import { chapterEventsSchema, validateStoryBlueprint } from "./schema";

export type GenerationRunStatus = "idle" | "running" | "completed" | "failed";

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
  artifacts?: GenerationRunArtifact[];
  updatedAt: string;
}

export interface GenerationRunArtifact extends AiGenerationArtifact {
  createdAt: string;
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
  canRetry?: boolean;
  recoveryHint?: string;
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
    artifacts: event.artifact
      ? [
          ...((existingIndex >= 0 ? stages[existingIndex].artifacts : undefined) ?? []),
          {
            ...event.artifact,
            createdAt: now
          }
        ]
      : existingIndex >= 0
        ? stages[existingIndex].artifacts
        : undefined,
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
  const canRetry = isRetryableGenerationError(error);
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
    canRetry,
    recoveryHint: canRetry ? "可以保留当前原文、AI 配置和已保存的阶段记录后重试。" : undefined,
    completedAt: now,
    stages: marked ? stages : [...stages, createStage("yaml_ready", "写入 YAML", error, "failed", now)]
  };
}

export function failGenerationRunWithMessage(
  run: GenerationRun,
  error: string,
  date = new Date()
): GenerationRun {
  if (isAiConfigurationError(error)) {
    return failGenerationRunStage(run, "connection_check", error, date);
  }

  return failGenerationRun(run, error, date);
}

export function failGenerationRunStage(
  run: GenerationRun,
  stageId: GenerationRunStageId,
  error: string,
  date = new Date()
): GenerationRun {
  const now = date.toISOString();
  let reachedFailedStage = false;
  let marked = false;
  const stages = run.stages.map((stage) => {
    if (stage.id === stageId) {
      reachedFailedStage = true;
      marked = true;
      return { ...stage, status: "failed" as const, message: error, updatedAt: now };
    }

    if (!reachedFailedStage && stage.status === "running") {
      return { ...stage, status: "done" as const, updatedAt: now };
    }

    return stage;
  });
  const failedRun = failGenerationRun({ ...run, stages: [] }, error, date);

  return {
    ...failedRun,
    stages: marked ? stages : [...stages, createStage(stageId, labelStage(stageId), error, "failed", now)]
  };
}

export function pushGenerationRunHistory(
  history: GenerationRun[],
  run: GenerationRun,
  limit = 8
): GenerationRun[] {
  return [run, ...history.filter((item) => item.id !== run.id)].slice(0, limit);
}

export function getGenerationRunResumeCheckpoint(run: GenerationRun): AiGenerationResumeCheckpoint | null {
  const artifacts = run.stages.flatMap((stage) => stage.artifacts ?? []);
  for (const artifact of [...artifacts].reverse()) {
    const result = validateStoryBlueprint(artifact.checkpoint?.storyBlueprint);
    if (result.success && checkpointEventsWithinRun(result.data.chapterEvents, run.chapterCount)) {
      return {
        storyBlueprint: result.data,
        chapterEvents: result.data.chapterEvents
      };
    }
  }

  const chapterEventsByIndex = new Map<number, NonNullable<AiGenerationResumeCheckpoint["chapterEvents"]>[number]>();
  artifacts.forEach((artifact) => {
    const result = chapterEventsSchema.safeParse(artifact.checkpoint?.chapterEvents);
    if (!result.success) return;

    result.data.forEach((group) => {
      if (checkpointEventWithinRun(group.chapterIndex, run.chapterCount)) {
        chapterEventsByIndex.set(group.chapterIndex, group);
      }
    });
  });

  if (!chapterEventsByIndex.size) {
    return null;
  }

  return {
    chapterEvents: [...chapterEventsByIndex.values()].sort((left, right) => left.chapterIndex - right.chapterIndex)
  };
}

function checkpointEventsWithinRun(
  chapterEvents: NonNullable<AiGenerationResumeCheckpoint["chapterEvents"]>,
  chapterCount: number
): boolean {
  return chapterEvents.every((group) => checkpointEventWithinRun(group.chapterIndex, chapterCount));
}

function checkpointEventWithinRun(chapterIndex: number, chapterCount: number): boolean {
  return chapterIndex >= 1 && chapterIndex <= chapterCount;
}

export function formatGenerationRunResumeSummary(run: GenerationRun): string | null {
  const checkpoint = getGenerationRunResumeCheckpoint(run);
  const chapterEvents = checkpoint?.storyBlueprint?.chapterEvents ?? checkpoint?.chapterEvents;
  if (!chapterEvents?.length) return null;

  const chapterIndexes = [...new Set(chapterEvents.map((group) => group.chapterIndex))].sort(
    (left, right) => left - right
  );
  const eventCount = chapterEvents.reduce((sum, group) => sum + group.events.length, 0);

  return `已保存 ${chapterIndexes.length} 章 / ${eventCount} 个事件：第 ${chapterIndexes.join("、")} 章，可从阶段产物继续`;
}

export function formatGenerationRunRetryAction(run: GenerationRun): { label: "续跑" | "重试"; title: string } | null {
  if (run.status !== "failed" || !run.canRetry) return null;

  return getGenerationRunResumeCheckpoint(run)
    ? {
        label: "续跑",
        title: "从已保存阶段继续调用当前 AI 配置"
      }
    : {
        label: "重试",
        title: "重新调用当前 AI 配置"
      };
}

export function formatGenerationRunArtifactDiagnostics(artifact: GenerationRunArtifact): string[] {
  const diagnostic = artifact.diagnostic;
  if (!diagnostic) return [];

  const lines: string[] = [];
  if (diagnostic.initialIssues?.length) {
    lines.push(formatArtifactIssueLine("初次返回", diagnostic.initialIssues));
  }
  if (diagnostic.repairedIssues?.length) {
    lines.push(formatArtifactIssueLine("修复后", diagnostic.repairedIssues));
  }
  if (diagnostic.initialExcerpt) {
    lines.push(`初次返回片段：${diagnostic.initialExcerpt}`);
  }
  if (diagnostic.repairedExcerpt) {
    lines.push(`修复返回片段：${diagnostic.repairedExcerpt}`);
  }
  return lines;
}

function formatArtifactIssueLine(label: string, issues: string[]): string {
  return `${label}仍有 ${issues.length} 个结构问题：${issues.join("；")}`;
}

export function formatAiGenerationProgress(event: AiGenerationProgress, model: string): string {
  if (event.stage === "chapter_event_extract") {
    return `正在用 ${model} 抽取章节事件：${event.current}/${event.total}`;
  }

  if (event.stage === "story_bible_generate") {
    return `正在用 ${model} 合并故事圣经和改编策略`;
  }

  if (event.stage === "schema_repair") {
    return `正在用 ${model} 修复剧本结构`;
  }

  return `${event.message}：${model}`;
}

export function formatGenerationRunStatus(status: GenerationRun["status"]): string {
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  return "待开始";
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

function isRetryableGenerationError(error: string): boolean {
  return /可重试|HTTP (408|429|500|502|503|504|524)|timeout|timed out|rate limit|temporarily|未通过 Schema|不是可解析 JSON|非 JSON 响应|返回空内容/i.test(error);
}

function isAiConfigurationError(error: string): boolean {
  return error.startsWith("请先配置 AI 生成") || error.startsWith("还没有可用的 API Key");
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
