import type { AdaptationStyle, Scene, ScreenplayYaml, StoryBlueprint } from "./types";
import { buildAiGatewayHeaders, classifyFetchFailure } from "./apiConnection";
import { parseChapters } from "./chapters";
import { splitParagraphsForGeneration } from "./generationPlan";
import { storyBlueprintSchema, validateScene, validateScreenplay, validateStoryBlueprint } from "./schema";

const longFormChapterThreshold = 3;
const maxTransientAttempts = 3;
const transientHttpStatuses = new Set([429, 500, 502, 503, 504]);

export interface AiProviderSettings {
  baseUrl: string;
  providerBaseUrl?: string;
  apiKey: string;
  model: string;
  useGenerationTasks?: boolean;
  taskPollIntervalMs?: number;
}

export interface AiGenerationOptions {
  title: string;
  style: AdaptationStyle;
  novelText: string;
  signal?: AbortSignal;
  onProgress?: (event: AiGenerationProgress) => void;
}

export interface AiGenerationProgress {
  stage:
    | "chapter_event_extract"
    | "event_extract"
    | "story_bible_generate"
    | "screenplay_generate"
    | "schema_repair";
  message: string;
  current?: number;
  total?: number;
}

type AiRequestStage = AiGenerationProgress["stage"] | "scene_regenerate";

export interface SceneRegenerationOptions {
  screenplay: ScreenplayYaml;
  sceneId: string;
  instruction: string;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface GenerationTaskPayload {
  task?: {
    id: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    response?: ChatCompletionResponse;
    error?: {
      message?: string;
      upstreamStatus?: number;
    };
  };
  error?: string;
}

interface ChatCompletionAttempt {
  ok: boolean;
  status: number;
  payload: ChatCompletionResponse;
}

export async function generateScreenplayWithApi(
  settings: AiProviderSettings,
  options: AiGenerationOptions
): Promise<ScreenplayYaml> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const sourceChapters = buildSourceChapters(options.novelText);

  if (sourceChapters.length >= longFormChapterThreshold) {
    return generateLongFormScreenplay(settings, baseUrl, options, sourceChapters);
  }

  options.onProgress?.({
    stage: "event_extract",
    message: "正在抽取章节事件和故事蓝图"
  });
  const blueprintContent = await requestChatCompletion(settings, baseUrl, {
    stage: "event_extract",
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content: buildBlueprintSystemPrompt()
      },
      {
        role: "user",
        content: buildBlueprintUserPrompt(options, sourceChapters)
      }
    ],
    signal: options.signal
  });
  const blueprint = normalizeStoryBlueprint(parseJsonObject(blueprintContent));

  options.onProgress?.({
    stage: "screenplay_generate",
    message: "正在生成结构化剧本 YAML"
  });
  const screenplayContent = await requestChatCompletion(settings, baseUrl, {
    stage: "screenplay_generate",
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: buildScreenplaySystemPrompt()
      },
      {
        role: "user",
        content: buildScreenplayUserPrompt(options, sourceChapters, blueprint)
      }
    ],
    signal: options.signal
  });

  const parsed = parseJsonObject(screenplayContent);
  return validateOrRepairScreenplay(settings, baseUrl, options, sourceChapters, blueprint, parsed);
}

export async function regenerateSceneWithApi(
  settings: AiProviderSettings,
  options: SceneRegenerationOptions
): Promise<Scene> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const scene = options.screenplay.scenes.find((item) => item.id === options.sceneId);
  if (!scene) {
    throw new Error(`未找到场景：${options.sceneId}`);
  }

  const sceneIndex = options.screenplay.scenes.findIndex((item) => item.id === options.sceneId);
  const content = await requestChatCompletion(settings, baseUrl, {
    stage: "scene_regenerate",
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content: buildSceneRegenerationSystemPrompt()
      },
      {
        role: "user",
        content: buildSceneRegenerationUserPrompt(options, scene, {
          previousScene: options.screenplay.scenes[sceneIndex - 1] ?? null,
          nextScene: options.screenplay.scenes[sceneIndex + 1] ?? null
        })
      }
    ],
    signal: options.signal
  });

  return normalizeRegeneratedScene(parseJsonObject(content), scene);
}

async function generateLongFormScreenplay(
  settings: AiProviderSettings,
  baseUrl: string,
  options: AiGenerationOptions,
  sourceChapters: ReturnType<typeof buildSourceChapters>
): Promise<ScreenplayYaml> {
  const chapterEvents = [];
  const extractionUnits = buildChapterExtractionUnits(sourceChapters);

  for (const [index, unit] of extractionUnits.entries()) {
    const chunkSuffix = unit.totalChunks > 1 ? `（片段 ${unit.chunkIndex}/${unit.totalChunks}）` : "";
    options.onProgress?.({
      stage: "chapter_event_extract",
      message: `正在抽取第 ${unit.chapterIndex} 章事件${chunkSuffix}`,
      current: index + 1,
      total: extractionUnits.length
    });
    const content = await requestChatCompletion(settings, baseUrl, {
      stage: "chapter_event_extract",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: buildChapterEventSystemPrompt()
        },
        {
          role: "user",
          content: buildChapterEventUserPrompt(options, unit, sourceChapters.length)
        }
      ],
      signal: options.signal
    });
    chapterEvents.push(...normalizeChapterEventGroups(parseJsonObject(content)));
  }

  options.onProgress?.({
    stage: "story_bible_generate",
    message: "正在合并故事圣经和改编策略"
  });
  const blueprintContent = await requestChatCompletion(settings, baseUrl, {
    stage: "story_bible_generate",
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content: buildBlueprintMergeSystemPrompt()
      },
      {
        role: "user",
        content: buildBlueprintMergeUserPrompt(options, sourceChapters, mergeChapterEventGroups(chapterEvents))
      }
    ],
    signal: options.signal
  });
  const blueprint = normalizeStoryBlueprint(parseJsonObject(blueprintContent));

  options.onProgress?.({
    stage: "screenplay_generate",
    message: "正在按故事蓝图生成完整剧本"
  });
  const screenplayContent = await requestChatCompletion(settings, baseUrl, {
    stage: "screenplay_generate",
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: buildScreenplaySystemPrompt()
      },
      {
        role: "user",
        content: buildLongFormScreenplayUserPrompt(options, sourceChapters, blueprint)
      }
    ],
    signal: options.signal
  });

  return validateOrRepairScreenplay(
    settings,
    baseUrl,
    options,
    sourceChapters,
    blueprint,
    parseJsonObject(screenplayContent)
  );
}

async function requestChatCompletion(
  settings: AiProviderSettings,
  baseUrl: string,
  request: {
    stage: AiRequestStage;
    temperature: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
    signal?: AbortSignal;
  }
): Promise<string> {
  const startedAt = Date.now();
  const body = JSON.stringify({
    model: settings.model,
    temperature: request.temperature,
    response_format: { type: "json_object" },
    messages: request.messages
  });
  let lastErrorMessage = "";

  for (let attempt = 1; attempt <= maxTransientAttempts; attempt++) {
    let completionAttempt: ChatCompletionAttempt;
    try {
      completionAttempt = await requestChatCompletionAttempt(settings, baseUrl, body, request.signal);
    } catch (error) {
      const message = classifyFetchFailure(error, baseUrl);
      if (message.includes("生成任务已取消")) {
        throw new Error("生成任务已取消");
      }
      if (attempt < maxTransientAttempts && isTransientNetworkMessage(message)) {
        lastErrorMessage = message;
        continue;
      }
      throw new Error(formatAiStageError(request.stage, message, attempt, Date.now() - startedAt, body.length));
    }

    if (!completionAttempt.ok) {
      const message = completionAttempt.payload.error?.message || `HTTP ${completionAttempt.status}`;
      if (attempt < maxTransientAttempts && transientHttpStatuses.has(completionAttempt.status)) {
        lastErrorMessage = message;
        continue;
      }
      throw new Error(formatAiStageError(request.stage, message, attempt, Date.now() - startedAt, body.length));
    }

    const payload = completionAttempt.payload;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(
        formatAiStageError(request.stage, "API 返回内容没有剧本正文", attempt, Date.now() - startedAt, body.length)
      );
    }

    return content;
  }

  throw new Error(
    formatAiStageError(
      request.stage,
      lastErrorMessage || "API 请求失败",
      maxTransientAttempts,
      Date.now() - startedAt,
      body.length
    )
  );
}

async function requestChatCompletionAttempt(
  settings: AiProviderSettings,
  baseUrl: string,
  body: string,
  signal?: AbortSignal
): Promise<ChatCompletionAttempt> {
  if (settings.useGenerationTasks) {
    return requestChatCompletionTask(settings, baseUrl, body, signal);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAiGatewayHeaders(settings.apiKey, settings.providerBaseUrl)
    },
    body,
    signal
  });
  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

async function requestChatCompletionTask(
  settings: AiProviderSettings,
  baseUrl: string,
  body: string,
  signal?: AbortSignal
): Promise<ChatCompletionAttempt> {
  const createResponse = await fetch(`${baseUrl}/generation-tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAiGatewayHeaders(settings.apiKey, settings.providerBaseUrl)
    },
    body,
    signal
  });
  const created = (await createResponse.json().catch(() => ({}))) as GenerationTaskPayload;
  if (!createResponse.ok || !created.task?.id) {
    return {
      ok: false,
      status: createResponse.status,
      payload: {
        error: {
          message: created.error || `HTTP ${createResponse.status}`
        }
      }
    };
  }

  try {
    while (true) {
      if (signal?.aborted) {
        await cancelGenerationTask(baseUrl, created.task.id).catch(() => undefined);
        throw new Error("生成任务已取消");
      }

      const taskResponse = await fetch(`${baseUrl}/generation-tasks/${created.task.id}`, { signal });
      const payload = (await taskResponse.json().catch(() => ({}))) as GenerationTaskPayload;
      const task = payload.task;
      if (!taskResponse.ok || !task) {
        return {
          ok: false,
          status: taskResponse.status,
          payload: {
            error: {
              message: payload.error || `HTTP ${taskResponse.status}`
            }
          }
        };
      }

      if (task.status === "completed") {
        return {
          ok: true,
          status: 200,
          payload: task.response || {}
        };
      }

      if (task.status === "failed" || task.status === "cancelled") {
        return {
          ok: false,
          status: task.error?.upstreamStatus || (task.status === "cancelled" ? 499 : 500),
          payload: {
            error: {
              message: task.error?.message || (task.status === "cancelled" ? "生成任务已取消" : "生成任务失败")
            }
          }
        };
      }

      await wait(settings.taskPollIntervalMs ?? 800);
    }
  } catch (error) {
    if (signal?.aborted) {
      await cancelGenerationTask(baseUrl, created.task.id).catch(() => undefined);
      throw new Error("生成任务已取消");
    }
    throw error;
  }
}

async function cancelGenerationTask(baseUrl: string, taskId: string): Promise<void> {
  await fetch(`${baseUrl}/generation-tasks/${taskId}`, {
    method: "DELETE"
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("请填写 API Base URL。");
  }
  if (trimmed.endsWith("/v1")) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

function isTransientNetworkMessage(message: string): boolean {
  return /timeout|timed out|econnreset|econnrefused|socket|network|fetch failed|failed to fetch/i.test(message);
}

function formatAiStageError(
  stage: AiRequestStage,
  message: string,
  attempt: number,
  elapsedMs: number,
  requestBytes: number
): string {
  const retrySuffix = attempt > 1 ? `，已重试 ${attempt - 1} 次` : "";
  return `${stage} 阶段请求失败：${message}${retrySuffix}，耗时 ${elapsedMs}ms，请求 ${requestBytes} bytes`;
}

function buildBlueprintSystemPrompt(): string {
  return [
    "你是剧匠的故事分析引擎，只输出 JSON，不要输出 Markdown。",
    "你的任务是从结构化章节上下文中提取故事蓝图，不要直接写剧本。",
    "输出必须只包含 chapterEvents、storyBible、adaptationStrategy。",
    "chapterEvents 要按章节组织，每章至少 1 个事件；事件必须带 source，excerpt 必须来自原文段落。",
    "storyBible 要概括世界观、核心冲突、时间线和角色弧光。",
    "adaptationStrategy 要说明剧本格式、节奏、分场规则和风险控制。"
  ].join("\n");
}

function buildChapterEventSystemPrompt(): string {
  return [
    "你是剧匠的章节事件抽取引擎，只输出 JSON，不要输出 Markdown。",
    "你一次只处理一个章节，输出必须只包含 chapterEvents。",
    "chapterEvents 必须是数组，并且只包含当前章节的事件组。",
    "每个事件必须写 characters、location、conflict、emotionalTurn 和 source。",
    "source.excerpt 必须来自当前章节原文段落，不要补写原文不存在的剧情。"
  ].join("\n");
}

function buildBlueprintMergeSystemPrompt(): string {
  return [
    "你是剧匠的长篇故事统筹引擎，只输出 JSON，不要输出 Markdown。",
    "你会收到逐章抽取的 chapterEvents，请合并成完整故事蓝图。",
    "输出必须包含 chapterEvents、storyBible、adaptationStrategy。",
    "不要删除已抽取事件；可以统一角色弧光、时间线、核心冲突和分场策略。"
  ].join("\n");
}

function buildScreenplaySystemPrompt(): string {
  return [
    "你是剧匠的小说改编引擎，只输出 JSON，不要输出 Markdown。",
    "你的任务是把结构化章节上下文改成剧本初稿，短篇片段和多章长文都可以处理。",
    "你会收到已经抽取好的 storyBlueprint，必须基于事件图谱和故事圣经分场，不能重新忽略蓝图。",
    "输出必须匹配剧匠 ScreenplayYaml Schema：work、adaptationPlan、characters、chapterMappings、scenes、rhythmStats、storyDiagnostics、validationHints。",
    "输出必须保留 chapterEvents、storyBible、adaptationStrategy。",
    "每个结构单元至少拆出 1 个 scene；如果段落足够，优先拆成 setup / turning_point / payoff。",
    "每个 scene 必须保留 source，写出 chapterIndex、chapterTitle、paragraphIndexes、lineStart、lineEnd、excerpt。",
    "不要照抄本文说明，不要编造不存在的章节。"
  ].join("\n");
}

function buildSourceChapters(novelText: string) {
  return parseChapters(novelText).map((chapter) => ({
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    heading: chapter.heading,
    lineStart: chapter.startLine,
    lineEnd: chapter.endLine,
    paragraphs: chapter.paragraphs.map((paragraph, index) => ({
      paragraphIndex: index + 1,
      text: paragraph
    }))
  }));
}

function buildChapterExtractionUnits(sourceChapters: ReturnType<typeof buildSourceChapters>) {
  return sourceChapters.flatMap((chapter) => {
    const chunks = splitChapterParagraphs(chapter.paragraphs);
    if (chunks.length === 1) {
      return [
        {
          ...chapter,
          chunkIndex: 1,
          totalChunks: 1,
          paragraphOffset: 0
        }
      ];
    }

    return chunks.map((paragraphs, index) => ({
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      heading: chapter.heading,
      lineStart: chapter.lineStart,
      lineEnd: chapter.lineEnd,
      chunkIndex: index + 1,
      totalChunks: chunks.length,
      paragraphOffset: chunks.slice(0, index).reduce((total, chunk) => total + chunk.length, 0),
      paragraphs
    }));
  });
}

function splitChapterParagraphs<T extends { paragraphIndex: number; text: string }>(paragraphs: T[]): T[][] {
  return splitParagraphsForGeneration(paragraphs);
}

function buildBlueprintUserPrompt(
  options: AiGenerationOptions,
  sourceChapters: ReturnType<typeof buildSourceChapters>
): string {
  return JSON.stringify({
    pipelineStage: "event_extract",
    title: options.title,
    adaptationStyle: options.style,
    longNovelStrategy: [
      "先从每章 paragraphs 中提取事件链、人物目标、阻碍、转折和结尾钩子。",
      "同一章可有多个事件，但事件不能凭空创造，source.excerpt 必须来自对应段落。",
      "角色、地点和冲突要服务后续分场，不要写成泛泛摘要。"
    ],
    sourceChapterCount: sourceChapters.length,
    sourceChapters
  });
}

function buildChapterEventUserPrompt(
  options: AiGenerationOptions,
  sourceUnit: ReturnType<typeof buildChapterExtractionUnits>[number],
  sourceChapterCount: number
): string {
  const isChunked = sourceUnit.totalChunks > 1;
  const sourceKey = isChunked ? "sourceChunk" : "sourceChapter";
  const sourceValue = isChunked
    ? {
        chapterIndex: sourceUnit.chapterIndex,
        chapterTitle: sourceUnit.chapterTitle,
        heading: sourceUnit.heading,
        lineStart: sourceUnit.lineStart,
        lineEnd: sourceUnit.lineEnd,
        chunkIndex: sourceUnit.chunkIndex,
        totalChunks: sourceUnit.totalChunks,
        paragraphOffset: sourceUnit.paragraphOffset,
        paragraphs: sourceUnit.paragraphs
      }
    : {
        chapterIndex: sourceUnit.chapterIndex,
        chapterTitle: sourceUnit.chapterTitle,
        heading: sourceUnit.heading,
        lineStart: sourceUnit.lineStart,
        lineEnd: sourceUnit.lineEnd,
        paragraphs: sourceUnit.paragraphs
      };

  return JSON.stringify({
    pipelineStage: "chapter_event_extract",
    title: options.title,
    adaptationStyle: options.style,
    sourceChapterCount,
    [sourceKey]: sourceValue,
    extractionRules: [
      isChunked ? "只处理 sourceChunk 中的 paragraphs。" : "只处理 sourceChapter 中的 paragraphs。",
      "按人物目标、阻碍、转折、线索和场尾钩子提取事件。",
      "同一章节可以有多个事件；事件数量应由剧情变化决定，不要机械固定。",
      "如果当前输入是 sourceChunk，事件 source.paragraphIndexes 仍使用原章节段落编号，不要从 1 重新编号。"
    ]
  });
}

function mergeChapterEventGroups(chapterEvents: StoryBlueprint["chapterEvents"]): StoryBlueprint["chapterEvents"] {
  const merged = new Map<number, StoryBlueprint["chapterEvents"][number]>();

  for (const group of chapterEvents) {
    const existing = merged.get(group.chapterIndex);
    if (!existing) {
      merged.set(group.chapterIndex, { ...group, events: [...group.events] });
      continue;
    }

    const existingIds = new Set(existing.events.map((event) => event.id));
    for (const event of group.events) {
      if (!existingIds.has(event.id)) {
        existing.events.push(event);
        existingIds.add(event.id);
      }
    }
    if (group.chapterGoal.length > existing.chapterGoal.length) {
      existing.chapterGoal = group.chapterGoal;
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.chapterIndex - right.chapterIndex);
}

function buildBlueprintMergeUserPrompt(
  options: AiGenerationOptions,
  sourceChapters: ReturnType<typeof buildSourceChapters>,
  chapterEvents: StoryBlueprint["chapterEvents"]
): string {
  return JSON.stringify({
    pipelineStage: "story_bible_generate",
    title: options.title,
    adaptationStyle: options.style,
    sourceChapterCount: sourceChapters.length,
    sourceChapters: sourceChapters.map((chapter) => ({
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      lineStart: chapter.lineStart,
      lineEnd: chapter.lineEnd,
      paragraphCount: chapter.paragraphs.length
    })),
    chapterEvents,
    mergeRules: [
      "保持 chapterEvents 覆盖所有输入章节。",
      "storyBible 要解决角色弧光、时间线和核心冲突的连续性。",
      "adaptationStrategy 要明确长篇分场策略和风险控制。"
    ]
  });
}

function buildScreenplayUserPrompt(
  options: AiGenerationOptions,
  sourceChapters: ReturnType<typeof buildSourceChapters>,
  storyBlueprint: StoryBlueprint
): string {
  return JSON.stringify({
    pipelineStage: "screenplay_generate",
    title: options.title,
    adaptationStyle: options.style,
    longNovelStrategy: [
      "基于 storyBlueprint.chapterEvents 生成 scenes，每个 scene 至少引用一个事件来源。",
      "地点、时间、人物行动或冲突发生变化时才开新场，不能机械按章节平均拆分。",
      "chapterMappings 必须覆盖所有 sourceChapters，source.excerpt 必须来自对应段落。"
    ],
    schemaNotes: {
      generatedBy: "请写成 api:<model>",
      conflictLevel: "1 到 5 的整数",
      pacing: ["quiet", "steady", "tense", "cliffhanger"],
      beatType: ["setup", "turning_point", "payoff"],
      minimumScenes: 3
    },
    sourceChapterCount: sourceChapters.length,
    sourceChapters,
    storyBlueprint
  });
}

function buildLongFormScreenplayUserPrompt(
  options: AiGenerationOptions,
  sourceChapters: ReturnType<typeof buildSourceChapters>,
  storyBlueprint: StoryBlueprint
): string {
  return JSON.stringify({
    pipelineStage: "screenplay_generate",
    title: options.title,
    adaptationStyle: options.style,
    longNovelStrategy: [
      "基于 storyBlueprint.chapterEvents 生成 scenes，不要重新请求或复述整篇小说。",
      "source.excerpt 直接使用 chapterEvents 中已抽取的原文摘录。",
      "地点、时间、人物行动或冲突发生变化时才开新场，不能机械按章节平均拆分。",
      "chapterMappings 必须覆盖所有 sourceChapters。"
    ],
    schemaNotes: {
      generatedBy: "请写成 api:<model>",
      conflictLevel: "1 到 5 的整数",
      pacing: ["quiet", "steady", "tense", "cliffhanger"],
      beatType: ["setup", "turning_point", "payoff"],
      minimumScenes: 3
    },
    sourceChapterCount: sourceChapters.length,
    sourceChapters: sourceChapters.map((chapter) => ({
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      heading: chapter.heading,
      lineStart: chapter.lineStart,
      lineEnd: chapter.lineEnd,
      paragraphCount: chapter.paragraphs.length
    })),
    storyBlueprint
  });
}

function buildRepairSystemPrompt(): string {
  return [
    "你是剧匠的 Schema 修复引擎，只输出 JSON，不要输出 Markdown。",
    "你会收到一份未通过校验的剧本 JSON、校验错误和故事蓝图。",
    "只修结构和缺失字段，尽量保留原剧本内容；不要重写成另一个故事。",
    "修复后的输出必须匹配剧匠 ScreenplayYaml Schema。"
  ].join("\n");
}

function buildRepairUserPrompt(
  options: AiGenerationOptions,
  sourceChapters: ReturnType<typeof buildSourceChapters>,
  storyBlueprint: StoryBlueprint,
  screenplayDraft: unknown,
  validationIssues: string[]
): string {
  return JSON.stringify({
    pipelineStage: "schema_repair",
    title: options.title,
    adaptationStyle: options.style,
    validationIssues,
    sourceChapterCount: sourceChapters.length,
    sourceChapters,
    storyBlueprint,
    screenplayDraft,
    repairRules: [
      "补齐缺失字段和空数组，但不要编造不存在的章节。",
      "scene.source.excerpt 必须来自 sourceChapters 的原文段落。",
      "rhythmStats 和 storyDiagnostics 必须与 scenes 保持一致。"
    ]
  });
}

function buildSceneRegenerationSystemPrompt(): string {
  return [
    "你是剧匠的单场修订引擎，只输出 JSON，不要输出 Markdown。",
    "你只改写用户指定的一场戏，不要重写整篇剧本。",
    "输出格式必须是 { \"scene\": <Scene> }。",
    "必须保留 scene.id、chapterIndex、beatIndex、beatType 和 source。",
    "修订要服务 instruction，并保持与前后场连续。"
  ].join("\n");
}

function buildSceneRegenerationUserPrompt(
  options: SceneRegenerationOptions,
  scene: Scene,
  neighbors: { previousScene: Scene | null; nextScene: Scene | null }
): string {
  const chapterEvents = options.screenplay.chapterEvents.filter(
    (chapter) => chapter.chapterIndex === scene.chapterIndex
  );

  return JSON.stringify({
    pipelineStage: "scene_regenerate",
    instruction: options.instruction,
    work: options.screenplay.work,
    adaptationPlan: options.screenplay.adaptationPlan,
    storyBible: options.screenplay.storyBible,
    adaptationStrategy: options.screenplay.adaptationStrategy,
    chapterEvents,
    characters: options.screenplay.characters,
    scene,
    previousScene: neighbors.previousScene
      ? summarizeNeighborScene(neighbors.previousScene)
      : null,
    nextScene: neighbors.nextScene ? summarizeNeighborScene(neighbors.nextScene) : null,
    rewriteRules: [
      "只返回修订后的 scene，不要返回 screenplay。",
      "可以补强 goal、action、dialogue、conflict、revisionNotes。",
      "不要改变 source.excerpt，不要编造原文之外的来源。",
      "如果补对白，speaker 必须来自 characters 或原场景人物。"
    ]
  });
}

function summarizeNeighborScene(scene: Scene) {
  return {
    id: scene.id,
    title: scene.title,
    goal: scene.goal,
    characters: scene.characters,
    conflict: scene.conflict,
    source: scene.source
  };
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("API 返回不是 JSON。");
    }
    return JSON.parse(match[0]);
  }
}

function normalizeStoryBlueprint(value: unknown): StoryBlueprint {
  const result = validateStoryBlueprint(value);
  if (!result.success) {
    throw new Error(`API 故事蓝图未通过 Schema：${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return result.data;
}

function normalizeChapterEventGroups(value: unknown): StoryBlueprint["chapterEvents"] {
  if (!value || typeof value !== "object") {
    throw new Error("API 章节事件返回 JSON 不是对象。");
  }

  const chapterEvents = (value as Partial<StoryBlueprint>).chapterEvents;
  const result = storyBlueprintSchema.shape.chapterEvents.safeParse(chapterEvents);
  if (!result.success) {
    throw new Error(`API 章节事件未通过 Schema：${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return result.data;
}

function normalizeApiScreenplay(value: unknown, model: string, blueprint: StoryBlueprint): ScreenplayYaml {
  if (!value || typeof value !== "object") {
    throw new Error("API 返回 JSON 不是对象。");
  }

  const screenplay = value as ScreenplayYaml;
  return {
    ...screenplay,
    chapterEvents: screenplay.chapterEvents || blueprint.chapterEvents,
    storyBible: screenplay.storyBible || blueprint.storyBible,
    adaptationStrategy: screenplay.adaptationStrategy || blueprint.adaptationStrategy,
    work: {
      ...screenplay.work,
      generatedBy: screenplay.work?.generatedBy || `api:${model}`
    }
  };
}

function normalizeRegeneratedScene(value: unknown, sourceScene: Scene): Scene {
  if (!value || typeof value !== "object") {
    throw new Error("API 返回 JSON 不是对象。");
  }

  const candidate = "scene" in value ? (value as { scene?: unknown }).scene : value;
  const merged = {
    ...sourceScene,
    ...(candidate && typeof candidate === "object" ? candidate : {}),
    id: sourceScene.id,
    chapterIndex: sourceScene.chapterIndex,
    beatIndex: sourceScene.beatIndex,
    beatType: sourceScene.beatType,
    source: sourceScene.source
  };
  const result = validateScene(merged);
  if (!result.success) {
    throw new Error(`API 场景修订未通过 Schema：${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return result.data;
}

async function validateOrRepairScreenplay(
  settings: AiProviderSettings,
  baseUrl: string,
  options: AiGenerationOptions,
  sourceChapters: ReturnType<typeof buildSourceChapters>,
  blueprint: StoryBlueprint,
  screenplayDraft: unknown
): Promise<ScreenplayYaml> {
  const normalized = normalizeApiScreenplay(screenplayDraft, settings.model, blueprint);
  const result = validateScreenplay(normalized);
  if (result.success) {
    return result.data;
  }

  const validationIssues = result.error.issues.map((issue) => issue.path.join(".")).filter(Boolean);
  options.onProgress?.({
    stage: "schema_repair",
    message: "AI 返回结构未通过校验，正在尝试修复"
  });
  const repairedContent = await requestChatCompletion(settings, baseUrl, {
    stage: "schema_repair",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: buildRepairSystemPrompt()
      },
      {
        role: "user",
        content: buildRepairUserPrompt(options, sourceChapters, blueprint, normalized, validationIssues)
      }
    ],
    signal: options.signal
  });

  const repaired = normalizeApiScreenplay(parseJsonObject(repairedContent), settings.model, blueprint);
  const repairedResult = validateScreenplay(repaired);
  if (!repairedResult.success) {
    throw new Error(`API 返回结构未通过 Schema：${repairedResult.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return repairedResult.data;
}
