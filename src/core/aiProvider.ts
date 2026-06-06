import type { AdaptationStyle, Scene, ScreenplayYaml, StoryBlueprint } from "./types";
import { buildAiGatewayHeaders, classifyFetchFailure } from "./apiConnection";
import { parseChapters } from "./chapters";
import { storyBlueprintSchema, validateScene, validateScreenplay, validateStoryBlueprint } from "./schema";

const longFormChapterThreshold = 3;
const transientHttpStatuses = new Set([408, 429, 500, 502, 503, 504]);
const chatCompletionMaxAttempts = 3;

export interface AiProviderSettings {
  baseUrl: string;
  providerBaseUrl?: string;
  apiKey: string;
  model: string;
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

export async function generateScreenplayWithApi(
  settings: AiProviderSettings,
  options: AiGenerationOptions
): Promise<ScreenplayYaml> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const sourceChapters = buildSourceChapters(options.novelText);

  if (sourceChapters.length > longFormChapterThreshold) {
    return generateLongFormScreenplay(settings, baseUrl, options, sourceChapters);
  }

  options.onProgress?.({
    stage: "event_extract",
    message: "正在抽取章节事件和故事蓝图"
  });
  const blueprintContent = await requestChatCompletion(settings, baseUrl, {
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

  for (const [index, sourceChapter] of sourceChapters.entries()) {
    options.onProgress?.({
      stage: "chapter_event_extract",
      message: `正在抽取第 ${sourceChapter.chapterIndex} 章事件`,
      current: index + 1,
      total: sourceChapters.length
    });
    const content = await requestChatCompletion(settings, baseUrl, {
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: buildChapterEventSystemPrompt()
        },
        {
          role: "user",
          content: buildChapterEventUserPrompt(options, sourceChapter, sourceChapters.length)
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
    temperature: 0.25,
    messages: [
      {
        role: "system",
        content: buildBlueprintMergeSystemPrompt()
      },
      {
        role: "user",
        content: buildBlueprintMergeUserPrompt(options, sourceChapters, chapterEvents)
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
    temperature: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
    signal?: AbortSignal;
  }
): Promise<string> {
  for (let attempt = 1; attempt <= chatCompletionMaxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAiGatewayHeaders(settings.apiKey, settings.providerBaseUrl)
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: request.temperature,
          response_format: { type: "json_object" },
          messages: request.messages
        }),
        signal: request.signal
      });
    } catch (error) {
      throw new Error(classifyFetchFailure(error, baseUrl));
    }

    const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
    if (!response.ok) {
      if (shouldRetryHttpStatus(response.status) && attempt < chatCompletionMaxAttempts) {
        await waitForRetry(attempt);
        continue;
      }
      throw new Error(formatHttpFailure(response.status, payload, attempt));
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("API 没有返回可解析的剧本内容。");
    }

    return content;
  }

  throw new Error("API 请求失败。");
}

function shouldRetryHttpStatus(status: number): boolean {
  return transientHttpStatuses.has(status);
}

function formatHttpFailure(
  status: number,
  payload: ChatCompletionResponse,
  attempts: number
): string {
  const upstreamMessage = payload.error?.message?.trim();
  if (status === 504 || status === 408) {
    return [
      `上游 AI 服务超时：HTTP ${status}。已尝试 ${attempts} 次仍未返回。`,
      "这通常是模型响应太慢、中转站网关超时或输入过长导致；建议换更快模型、减少本次章节量，或稍后重试。"
    ].join("");
  }
  if (status === 429) {
    return [
      `API 调用被限流：HTTP ${status}。已尝试 ${attempts} 次仍失败。`,
      "请稍后重试，或切换到额度更稳定的 provider。"
    ].join("");
  }
  if (status >= 500 && status < 600) {
    return [
      `AI 服务临时不可用：HTTP ${status}。已尝试 ${attempts} 次仍失败。`,
      upstreamMessage ? `上游返回：${upstreamMessage}` : "请稍后重试，或切换 provider。"
    ].join("");
  }
  return upstreamMessage || `API 请求失败：HTTP ${status}`;
}

function waitForRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, attempt * 300));
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
  sourceChapter: ReturnType<typeof buildSourceChapters>[number],
  sourceChapterCount: number
): string {
  return JSON.stringify({
    pipelineStage: "chapter_event_extract",
    title: options.title,
    adaptationStyle: options.style,
    sourceChapterCount,
    sourceChapter,
    extractionRules: [
      "只处理 sourceChapter 中的 paragraphs。",
      "按人物目标、阻碍、转折、线索和场尾钩子提取事件。",
      "同一章节可以有多个事件；事件数量应由剧情变化决定，不要机械固定。"
    ]
  });
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
