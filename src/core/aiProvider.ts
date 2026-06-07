import type { AdaptationStyle, Scene, ScreenplayYaml, StoryBlueprint } from "./types";
import { buildAiGatewayHeaders, classifyFetchFailure } from "./apiConnection";
import { parseChapters } from "./chapters";
import { chapterEventsSchema, validateScene, validateScreenplay, validateStoryBlueprint } from "./schema";
import { screenplayToYaml } from "./yaml";

const longFormChapterThreshold = 3;

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
  resumeFrom?: AiGenerationResumeCheckpoint;
  signal?: AbortSignal;
  onProgress?: (event: AiGenerationProgress) => void;
}

export interface AiGenerationResumeCheckpoint {
  chapterEvents?: StoryBlueprint["chapterEvents"];
  storyBlueprint?: StoryBlueprint;
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
  artifact?: AiGenerationArtifact;
}

export interface AiGenerationArtifact {
  kind: "chapter_events" | "story_blueprint" | "screenplay" | "repair";
  summary: string;
  detail?: string;
  yamlDraft?: string;
  checkpoint?: AiGenerationResumeCheckpoint;
  diagnostic?: AiGenerationDiagnostic;
}

export interface AiGenerationDiagnostic {
  initialIssues?: string[];
  repairedIssues?: string[];
  initialExcerpt?: string;
  repairedExcerpt?: string;
}

export interface SceneRegenerationOptions {
  screenplay: ScreenplayYaml;
  sceneId: string;
  instruction: string;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: ChatCompletionContent;
      tool_calls?: ChatCompletionToolCall[];
      function_call?: ChatCompletionFunctionCall;
    };
  }>;
  error?: {
    message?: string;
  };
}

type ChatCompletionContent =
  | string
  | Array<
      | string
      | {
          type?: string;
          text?: string;
          content?: string;
        }
    >;

interface ChatCompletionToolCall {
  type?: string;
  function?: ChatCompletionFunctionCall;
}

interface ChatCompletionFunctionCall {
  name?: string;
  arguments?: string;
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
    signal: options.signal,
    stage: "event_extract"
  });
  let blueprint: StoryBlueprint;
  try {
    blueprint = normalizeStoryBlueprint(parseJsonObject(blueprintContent, "event_extract"), "event_extract");
  } catch (error) {
    options.onProgress?.({
      stage: "event_extract",
      message: "故事蓝图抽取返回不可用",
      artifact: {
        kind: "story_blueprint",
        summary: "故事蓝图抽取失败",
        detail: "Provider 返回内容未通过故事蓝图校验。",
        diagnostic: {
          initialExcerpt: summarizeBlueprintMergeFailure(blueprintContent)
        }
      }
    });
    throw error;
  }
  options.onProgress?.({
    stage: "event_extract",
    message: "故事蓝图已生成",
    artifact: describeStoryBlueprintArtifact(blueprint)
  });

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
    signal: options.signal,
    stage: "screenplay_generate"
  });

  const parsed = parseScreenplayJsonWithArtifact(options, screenplayContent);
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
    signal: options.signal,
    stage: "scene_regenerate"
  });

  return normalizeRegeneratedScene(parseJsonObject(content, "scene_regenerate"), scene);
}

async function generateLongFormScreenplay(
  settings: AiProviderSettings,
  baseUrl: string,
  options: AiGenerationOptions,
  sourceChapters: ReturnType<typeof buildSourceChapters>
): Promise<ScreenplayYaml> {
  const resumeCheckpoint = normalizeResumeCheckpoint(options.resumeFrom, sourceChapters.length);
  if (resumeCheckpoint?.storyBlueprint) {
    options.onProgress?.({
      stage: "story_bible_generate",
      message: "已从保存的故事蓝图续跑",
      artifact: withCheckpoint(describeStoryBlueprintArtifact(resumeCheckpoint.storyBlueprint), {
        storyBlueprint: resumeCheckpoint.storyBlueprint,
        chapterEvents: resumeCheckpoint.storyBlueprint.chapterEvents
      })
    });

    options.onProgress?.({
      stage: "screenplay_generate",
      message: "正在从检查点继续生成剧本"
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
          content: buildLongFormScreenplayUserPrompt(options, sourceChapters, resumeCheckpoint.storyBlueprint)
        }
      ],
      signal: options.signal,
      stage: "screenplay_generate"
    });

    return validateOrRepairScreenplay(
      settings,
      baseUrl,
      options,
      sourceChapters,
      resumeCheckpoint.storyBlueprint,
      parseScreenplayJsonWithArtifact(options, screenplayContent)
    );
  }

  const chapterEvents: StoryBlueprint["chapterEvents"] = resumeCheckpoint?.chapterEvents
    ? [...resumeCheckpoint.chapterEvents]
    : [];
  const completedChapterIndexes = new Set(chapterEvents.map((group) => group.chapterIndex));

  for (const [index, sourceChapter] of sourceChapters.entries()) {
    if (completedChapterIndexes.has(sourceChapter.chapterIndex)) {
      continue;
    }

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
      signal: options.signal,
      stage: "chapter_event_extract"
    });
    let eventGroups: StoryBlueprint["chapterEvents"];
    try {
      eventGroups = normalizeChapterEventGroups(
        parseJsonObject(content, "chapter_event_extract"),
        "chapter_event_extract"
      );
    } catch (error) {
      options.onProgress?.({
        stage: "chapter_event_extract",
        message: `第 ${sourceChapter.chapterIndex} 章事件抽取返回不可用`,
        current: index + 1,
        total: sourceChapters.length,
        artifact: {
          kind: "chapter_events",
          summary: `第 ${sourceChapter.chapterIndex} 章事件抽取失败`,
          detail: "Provider 返回内容未通过章节事件校验。",
          diagnostic: {
            initialExcerpt: truncateDiagnostic(content)
          }
        }
      });
      throw error;
    }
    chapterEvents.push(...eventGroups);
    options.onProgress?.({
      stage: "chapter_event_extract",
      message: `第 ${sourceChapter.chapterIndex} 章事件已保存`,
      current: index + 1,
      total: sourceChapters.length,
      artifact: withCheckpoint(describeChapterEventsArtifact(eventGroups, sourceChapter.chapterIndex), {
        chapterEvents: eventGroups
      })
    });
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
        content: buildBlueprintMergeUserPrompt(
          options,
          sourceChapters,
          normalizeCheckpointChapterEvents(chapterEvents, sourceChapters.length)
        )
      }
    ],
    signal: options.signal,
    stage: "story_bible_generate"
  });
  let blueprint: StoryBlueprint;
  try {
    blueprint = normalizeStoryBlueprint(
      parseJsonObject(blueprintContent, "story_bible_generate"),
      "story_bible_generate"
    );
  } catch (error) {
    options.onProgress?.({
      stage: "story_bible_generate",
      message: "故事蓝图合并返回不可用",
      artifact: {
        kind: "story_blueprint",
        summary: "故事蓝图合并失败",
        detail: "Provider 返回内容未通过故事蓝图校验。",
        diagnostic: {
          initialExcerpt: summarizeBlueprintMergeFailure(blueprintContent)
        }
      }
    });
    throw error;
  }
  options.onProgress?.({
    stage: "story_bible_generate",
    message: "故事圣经和改编策略已合并",
    artifact: withCheckpoint(describeStoryBlueprintArtifact(blueprint), {
      storyBlueprint: blueprint,
      chapterEvents: blueprint.chapterEvents
    })
  });

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
    signal: options.signal,
    stage: "screenplay_generate"
  });

  return validateOrRepairScreenplay(
    settings,
    baseUrl,
    options,
    sourceChapters,
    blueprint,
    parseScreenplayJsonWithArtifact(options, screenplayContent)
  );
}

async function requestChatCompletion(
  settings: AiProviderSettings,
  baseUrl: string,
  request: {
    temperature: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
    signal?: AbortSignal;
    stage: AiGenerationProgress["stage"] | "scene_regenerate";
  }
): Promise<string> {
  const firstAttempt = await sendChatCompletionRequest(settings, baseUrl, request, true);
  let response = firstAttempt.response;
  let payload = firstAttempt.payload;

  if (
    !response.ok &&
    isResponseFormatUnsupported(response.status, payload) &&
    !request.signal?.aborted
  ) {
    const retryAttempt = await sendChatCompletionRequest(settings, baseUrl, request, false);
    response = retryAttempt.response;
    payload = retryAttempt.payload;

    if (!response.ok) {
      throw new Error(
        `${formatHttpFailure(request.stage, response.status, payload)} 已在 Provider 拒绝 response_format 后重试一次。首次 Provider 返回：${truncateDiagnostic(
          getProviderDiagnostic(firstAttempt.payload)
        )}`
      );
    }
  }

  if (!response.ok) {
    throw new Error(formatHttpFailure(request.stage, response.status, payload));
  }

  const content = extractFirstChatCompletionText(payload.choices);
  if (!content) {
    throw new Error(formatEmptyContentFailure(request.stage, payload));
  }

  return content;
}

async function sendChatCompletionRequest(
  settings: AiProviderSettings,
  baseUrl: string,
  request: {
    temperature: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
    signal?: AbortSignal;
    stage: AiGenerationProgress["stage"] | "scene_regenerate";
  },
  includeResponseFormat: boolean
): Promise<{ response: Response; payload: ChatCompletionResponse & { rawText?: string } }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAiGatewayHeaders(settings.apiKey, settings.providerBaseUrl)
      },
      body: JSON.stringify(buildChatCompletionBody(settings, request, includeResponseFormat)),
      signal: request.signal
    });
  } catch (error) {
    throw new Error(classifyFetchFailure(error, baseUrl));
  }

  const payload = await readChatCompletionResponse(response, request.stage);
  return { response, payload };
}

function buildChatCompletionBody(
  settings: AiProviderSettings,
  request: {
    temperature: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
  },
  includeResponseFormat: boolean
) {
  return {
    model: settings.model,
    temperature: request.temperature,
    ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
    messages: request.messages
  };
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

function parseJsonObject(
  content: string,
  stage: AiGenerationProgress["stage"] | "scene_regenerate"
): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        `${labelProviderStage(stage)} 阶段返回内容不是可解析 JSON。Provider 返回：${truncateDiagnostic(trimmed)}`
      );
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new Error(
        `${labelProviderStage(stage)} 阶段返回内容不是可解析 JSON。Provider 返回：${truncateDiagnostic(trimmed)}`
      );
    }
  }
}

function parseScreenplayJsonWithArtifact(options: AiGenerationOptions, content: string): unknown {
  try {
    return parseJsonObject(content, "screenplay_generate");
  } catch (error) {
    options.onProgress?.({
      stage: "screenplay_generate",
      message: "剧本生成返回不可解析 JSON",
      artifact: {
        kind: "screenplay",
        summary: "剧本生成返回不可解析 JSON",
        detail: "Provider 返回内容不是可解析 JSON。",
        diagnostic: {
          initialExcerpt: truncateDiagnostic(content)
        }
      }
    });
    throw error;
  }
}

function normalizeStoryBlueprint(
  value: unknown,
  stage: AiGenerationProgress["stage"]
): StoryBlueprint {
  const result = validateStoryBlueprint(value);
  if (!result.success) {
    const issuePaths = getValidationIssuePaths(result.error.issues);
    throw new Error(
      `${labelProviderStage(stage)} 阶段故事蓝图未通过 Schema：${formatValidationIssues(
        issuePaths
      )}。Provider 返回摘要：${summarizeReturnedJson(value, issuePaths)}`
    );
  }
  return result.data;
}

function normalizeChapterEventGroups(
  value: unknown,
  stage: AiGenerationProgress["stage"]
): StoryBlueprint["chapterEvents"] {
  if (!value || typeof value !== "object") {
    throw new Error(
      `${labelProviderStage(stage)} 阶段章节事件返回 JSON 不是对象。Provider 返回摘要：${summarizeReturnedJson(value)}`
    );
  }

  const chapterEvents = (value as Partial<StoryBlueprint>).chapterEvents;
  const result = chapterEventsSchema.safeParse(chapterEvents);
  if (!result.success) {
    const issuePaths = getValidationIssuePaths(result.error.issues);
    throw new Error(
      `${labelProviderStage(stage)} 阶段章节事件未通过 Schema：${formatValidationIssues(
        issuePaths
      )}。Provider 返回摘要：${summarizeReturnedJson(chapterEvents, issuePaths)}`
    );
  }
  return result.data;
}

function normalizeResumeCheckpoint(
  checkpoint: AiGenerationResumeCheckpoint | undefined,
  sourceChapterCount: number
): AiGenerationResumeCheckpoint | null {
  if (!checkpoint) return null;

  if (checkpoint.storyBlueprint) {
    const result = validateStoryBlueprint(checkpoint.storyBlueprint);
    if (result.success && coversSourceChapters(result.data.chapterEvents, sourceChapterCount)) {
      const storyBlueprint = {
        ...result.data,
        chapterEvents: normalizeCheckpointChapterEvents(result.data.chapterEvents, sourceChapterCount)
      };
      return { storyBlueprint, chapterEvents: storyBlueprint.chapterEvents };
    }
  }

  if (checkpoint.chapterEvents) {
    const result = chapterEventsSchema.safeParse(checkpoint.chapterEvents);
    if (result.success) {
      const chapterEvents = normalizeCheckpointChapterEvents(result.data, sourceChapterCount);
      if (chapterEvents.length > 0) {
        return { chapterEvents };
      }
    }
  }

  return null;
}

function normalizeCheckpointChapterEvents(
  chapterEvents: StoryBlueprint["chapterEvents"],
  sourceChapterCount: number
): StoryBlueprint["chapterEvents"] {
  const chapterEventsByIndex = new Map<number, StoryBlueprint["chapterEvents"][number]>();
  chapterEvents.forEach((group) => {
    if (group.chapterIndex >= 1 && group.chapterIndex <= sourceChapterCount) {
      chapterEventsByIndex.set(group.chapterIndex, group);
    }
  });

  return [...chapterEventsByIndex.values()].sort((left, right) => left.chapterIndex - right.chapterIndex);
}

function coversSourceChapters(chapterEvents: StoryBlueprint["chapterEvents"], sourceChapterCount: number): boolean {
  const covered = new Set(chapterEvents.map((group) => group.chapterIndex));
  return Array.from({ length: sourceChapterCount }, (_, index) => index + 1).every((chapterIndex) =>
    covered.has(chapterIndex)
  );
}

function withCheckpoint(
  artifact: AiGenerationArtifact,
  checkpoint: AiGenerationResumeCheckpoint
): AiGenerationArtifact {
  return {
    ...artifact,
    checkpoint
  };
}

function normalizeApiScreenplay(value: unknown, model: string, blueprint: StoryBlueprint): ScreenplayYaml {
  if (!value || typeof value !== "object") {
    throw new Error("API 返回 JSON 不是对象。");
  }

  const screenplay = value as ScreenplayYaml;
  return {
    ...screenplay,
    chapterEvents: blueprint.chapterEvents,
    storyBible: blueprint.storyBible,
    adaptationStrategy: blueprint.adaptationStrategy,
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
    options.onProgress?.({
      stage: "screenplay_generate",
      message: "剧本结构已通过 Schema",
      artifact: describeScreenplayArtifact(result.data)
    });
    return result.data;
  }

  const validationIssues = getValidationIssuePaths(result.error.issues);
  const initialExcerpt = summarizeReturnedJson(normalized, validationIssues);
  options.onProgress?.({
    stage: "screenplay_generate",
    message: "剧本初稿未通过 Schema，已保存供修复追踪",
    artifact: {
      kind: "screenplay",
      summary: "剧本初稿未通过 Schema",
      detail: `初次问题：${formatValidationIssues(validationIssues)}`,
      yamlDraft: screenplayToYaml(normalized),
      diagnostic: {
        initialIssues: validationIssues,
        initialExcerpt
      }
    }
  });
  options.onProgress?.({
    stage: "schema_repair",
    message: "AI 返回结构未通过校验，正在尝试修复",
    artifact: {
      kind: "repair",
      summary: "结构初稿未通过 Schema",
      detail: `初次问题：${formatValidationIssues(validationIssues)}`,
      diagnostic: {
        initialIssues: validationIssues,
        initialExcerpt
      }
    }
  });
  let repairedContent: string;
  try {
    repairedContent = await requestChatCompletion(settings, baseUrl, {
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
      signal: options.signal,
      stage: "schema_repair"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onProgress?.({
      stage: "schema_repair",
      message: "结构修复请求失败",
      artifact: {
        kind: "repair",
        summary: "结构修复请求失败",
        detail: `初次问题：${formatValidationIssues(validationIssues)}`,
        diagnostic: {
          initialIssues: validationIssues,
          initialExcerpt,
          repairedExcerpt: truncateDiagnostic(message)
        }
      }
    });
    throw error;
  }

  let repairedJson: unknown;
  try {
    repairedJson = parseJsonObject(repairedContent, "schema_repair");
  } catch (error) {
    options.onProgress?.({
      stage: "schema_repair",
      message: "结构修复返回不可解析 JSON",
      artifact: {
        kind: "repair",
        summary: "结构修复返回不可解析 JSON",
        detail: `初次问题：${formatValidationIssues(validationIssues)}`,
        diagnostic: {
          initialIssues: validationIssues,
          initialExcerpt,
          repairedExcerpt: truncateDiagnostic(repairedContent)
        }
      }
    });
    throw error;
  }

  const repaired = normalizeApiScreenplay(repairedJson, settings.model, blueprint);
  const repairedResult = validateScreenplay(repaired);
  if (!repairedResult.success) {
    const repairedIssues = getValidationIssuePaths(repairedResult.error.issues);
    const repairedExcerpt = summarizeReturnedJson(repaired, repairedIssues);
    options.onProgress?.({
      stage: "schema_repair",
      message: "结构修复后仍未通过 Schema",
      artifact: {
        kind: "repair",
        summary: "结构修复仍未通过 Schema",
        detail: `初次问题：${formatValidationIssues(validationIssues)}；修复后问题：${formatValidationIssues(
          repairedIssues
        )}`,
        yamlDraft: screenplayToYaml(repaired),
        diagnostic: {
          initialIssues: validationIssues,
          repairedIssues,
          initialExcerpt,
          repairedExcerpt
        }
      }
    });
    throw new Error(
      `API 返回结构修复后仍未通过 Schema：初次问题：${formatValidationIssues(
        validationIssues
      )}；修复后问题：${formatValidationIssues(repairedIssues)}。初次返回摘要：${initialExcerpt}。修复返回摘要：${repairedExcerpt}`
    );
  }
  options.onProgress?.({
    stage: "screenplay_generate",
    message: "修复后的剧本结构已通过 Schema",
    artifact: describeScreenplayArtifact(repairedResult.data)
  });
  const repairedExcerpt = summarizeReturnedJson(repairedResult.data, validationIssues);
  options.onProgress?.({
    stage: "schema_repair",
    message: "结构修复已通过 Schema",
    artifact: {
      kind: "repair",
      summary: `${repairedResult.data.scenes.length} 场剧本已修复`,
      detail: `修复字段：${validationIssues.slice(0, 4).join(", ") || "结构字段"}`,
      diagnostic: {
        initialIssues: validationIssues,
        repairedIssues: [],
        initialExcerpt,
        repairedExcerpt
      }
    }
  });
  return repairedResult.data;
}

async function readChatCompletionResponse(
  response: Response,
  stage: AiGenerationProgress["stage"] | "scene_regenerate"
): Promise<ChatCompletionResponse & { rawText?: string }> {
  const contentType = response.headers?.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    const rawText = await readResponseText(response);
    const parsedStream = parseSseChatCompletion(rawText);
    return {
      choices: [
        {
          finish_reason: parsedStream.finishReason,
          message: {
            content: parsedStream.content,
            ...(parsedStream.toolCalls?.length ? { tool_calls: parsedStream.toolCalls } : {}),
            ...(parsedStream.functionCall ? { function_call: parsedStream.functionCall } : {})
          }
        }
      ],
      ...(parsedStream.errorMessage ? { error: { message: parsedStream.errorMessage } } : {}),
      rawText
    };
  }

  const rawText = await readResponseText(response);
  if (rawText) {
    try {
      return {
        ...(JSON.parse(rawText) as ChatCompletionResponse),
        rawText
      };
    } catch {
      return {
        rawText,
        error: { message: rawText }
      };
    }
  }

  try {
    return ((await response.json()) as ChatCompletionResponse) || {};
  } catch {
    return {
      rawText,
      error: { message: `${labelProviderStage(stage)} 阶段返回了非 JSON 响应` }
    };
  }
}

async function readResponseText(response: Response): Promise<string> {
  const textReader = (response as { text?: () => Promise<string> }).text;
  if (typeof textReader !== "function") {
    return "";
  }
  return textReader.call(response).catch(() => "");
}

function parseSseChatCompletion(rawText: string): {
  content: string;
  errorMessage?: string;
  finishReason?: string;
  toolCalls?: ChatCompletionToolCall[];
  functionCall?: ChatCompletionFunctionCall;
} {
  let errorMessage = "";
  let finishReason = "";
  const toolCalls: ChatCompletionToolCall[] = [];
  let functionCall: ChatCompletionFunctionCall | undefined;
  const content = parseSseDataEvents(rawText)
    .filter((eventData) => eventData && eventData !== "[DONE]")
    .map((eventData) => {
      try {
        const payload = JSON.parse(eventData) as {
          error?: { message?: string } | string;
          choices?: Array<{
            finish_reason?: string;
            delta?: {
              content?: ChatCompletionContent;
              tool_calls?: ChatCompletionToolCall[];
              function_call?: ChatCompletionFunctionCall;
            };
            message?: {
              content?: ChatCompletionContent;
              tool_calls?: ChatCompletionToolCall[];
              function_call?: ChatCompletionFunctionCall;
            };
          }>;
        };
        const streamError =
          typeof payload.error === "string" ? payload.error : payload.error?.message;
        if (streamError && !errorMessage) {
          errorMessage = streamError;
        }
        payload.choices?.forEach((choice) => {
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const streamedToolCalls = choice.delta?.tool_calls || choice.message?.tool_calls;
          if (streamedToolCalls?.length) {
            toolCalls.push(...streamedToolCalls);
          }
          const streamedFunctionCall = choice.delta?.function_call || choice.message?.function_call;
          if (streamedFunctionCall) {
            functionCall = mergeFunctionCall(functionCall, streamedFunctionCall);
          }
        });
        return extractFirstChatCompletionText(
          payload.choices?.map((choice) => ({
            message: {
              content:
                extractChatCompletionText(choice.delta?.content) ||
                extractChatCompletionText(choice.message?.content)
            }
          }))
        );
      } catch {
        if (!errorMessage) {
          errorMessage = eventData;
        }
        return "";
      }
    })
    .join("");

  return {
    content,
    errorMessage: errorMessage || undefined,
    finishReason: finishReason || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    functionCall
  };
}

function parseSseDataEvents(rawText: string): string[] {
  return rawText
    .split(/\r?\n\r?\n/)
    .map((eventBlock) => {
      const dataLines = eventBlock
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());
      if (!dataLines.length) {
        return "";
      }

      const eventData = dataLines.join("\n").trim();
      if (eventData === "[DONE]" || isJsonLike(eventData)) {
        return eventData;
      }

      const compactEventData = dataLines.join("").trim();
      return isJsonLike(compactEventData) ? compactEventData : eventData;
    });
}

function isJsonLike(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function mergeFunctionCall(
  current: ChatCompletionFunctionCall | undefined,
  next: ChatCompletionFunctionCall
): ChatCompletionFunctionCall {
  return {
    name: next.name ?? current?.name,
    arguments: `${current?.arguments ?? ""}${next.arguments ?? ""}` || undefined
  };
}

function extractFirstChatCompletionText(
  choices:
    | Array<{
        message?: {
          content?: ChatCompletionContent;
        };
      }>
    | undefined
): string {
  if (!choices?.length) {
    return "";
  }

  for (const choice of choices) {
    const content = extractChatCompletionText(choice.message?.content);
    if (content) {
      return content;
    }
  }

  return "";
}

function extractChatCompletionText(content: ChatCompletionContent | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      return part.text || part.content || "";
    })
    .join("");
}

function formatHttpFailure(
  stage: AiGenerationProgress["stage"] | "scene_regenerate",
  status: number,
  payload: ChatCompletionResponse & { rawText?: string }
): string {
  const providerMessage = payload.error?.message || payload.rawText || "";
  const base = isTimeoutStatus(status)
    ? `${labelProviderStage(stage)} 阶段请求超时：HTTP ${status}。可重试。`
    : `${labelProviderStage(stage)} 阶段请求失败：HTTP ${status}。`;
  return providerMessage ? `${base}Provider 返回：${truncateDiagnostic(providerMessage)}` : base;
}

function isResponseFormatUnsupported(
  status: number,
  payload: ChatCompletionResponse & { rawText?: string }
): boolean {
  if (status !== 400 && status !== 422) {
    return false;
  }

  const diagnostic = getProviderDiagnostic(payload);
  return /response[_\s-]?format|json[_\s-]?mode/i.test(diagnostic)
    && /not supported|unsupported|unknown parameter|invalid parameter|unrecognized|does not support|不支持/i.test(
      diagnostic
    );
}

function getProviderDiagnostic(payload: ChatCompletionResponse & { rawText?: string }): string {
  return payload.error?.message || payload.rawText || "";
}

function formatEmptyContentFailure(
  stage: AiGenerationProgress["stage"] | "scene_regenerate",
  payload: ChatCompletionResponse & { rawText?: string }
): string {
  if (!payload.choices?.length && payload.rawText?.trim()) {
    return `${labelProviderStage(stage)} 阶段返回了非 JSON 响应。Provider 返回：${truncateDiagnostic(payload.rawText)}`;
  }

  if (payload.error?.message) {
    return `${labelProviderStage(stage)} 阶段返回空内容。Provider 返回：${truncateDiagnostic(payload.error.message)}`;
  }

  const callDiagnostic = getChatCallDiagnostic(payload.choices);
  if (callDiagnostic) {
    return `${labelProviderStage(stage)} 阶段返回了工具调用而不是文本 JSON。${callDiagnostic}`;
  }

  const finishReason = payload.choices?.[0]?.finish_reason;
  const suffix = finishReason ? `finish_reason=${finishReason}` : "choices[0].message.content 为空";
  return `${labelProviderStage(stage)} 阶段返回空内容。${suffix}`;
}

function getChatCallDiagnostic(choices: ChatCompletionResponse["choices"]): string {
  if (!choices?.length) {
    return "";
  }

  for (const choice of choices) {
    const message = choice.message;
    if (!message) continue;

    if (message.tool_calls?.length) {
      const names = message.tool_calls
        .map((call) => call.function?.name)
        .filter((name): name is string => Boolean(name));
      const nameSummary = names.length ? `工具：${truncateDiagnostic(names.join(", "))}。` : "";
      const reason = choice.finish_reason ? `finish_reason=${choice.finish_reason}。` : "";
      return `${reason}${nameSummary}Provider 返回：${truncateDiagnostic(JSON.stringify(message.tool_calls))}`;
    }

    if (message.function_call) {
      const functionName = message.function_call.name ? `函数：${message.function_call.name}。` : "";
      const reason = choice.finish_reason ? `finish_reason=${choice.finish_reason}。` : "";
      return `${reason}${functionName}Provider 返回：${truncateDiagnostic(JSON.stringify(message.function_call))}`;
    }
  }

  return "";
}

function isTimeoutStatus(status: number): boolean {
  return status === 408 || status === 504 || status === 524;
}

function labelProviderStage(stage: AiGenerationProgress["stage"] | "scene_regenerate"): string {
  return stage;
}

function truncateDiagnostic(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;
}

function getValidationIssuePaths(issues: Array<{ path: Array<string | number> }>): string[] {
  return issues.map((issue) => issue.path.join(".")).filter(Boolean);
}

function formatValidationIssues(paths: string[]): string {
  return paths.join(", ") || "结构字段";
}

function summarizeReturnedJson(value: unknown, issuePaths: string[] = []): string {
  try {
    const focused = getFocusedJsonFields(value, issuePaths);
    const fullSummary = truncateDiagnostic(JSON.stringify(value));
    return focused ? `${focused}；整体：${fullSummary}` : fullSummary;
  } catch {
    return truncateDiagnostic(String(value));
  }
}

function summarizeBlueprintMergeFailure(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return truncateDiagnostic(content);
    }

    const compact = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        key === "chapterEvents" && Array.isArray(value) && value.length > 3
          ? `${value.length} chapter event groups`
          : value
      ])
    );
    return truncateDiagnostic(JSON.stringify(compact));
  } catch {
    return truncateDiagnostic(content);
  }
}

function getFocusedJsonFields(value: unknown, issuePaths: string[]): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const focused: Record<string, unknown> = {};
  issuePaths.forEach((path) => {
    const [topLevelKey] = path.split(".");
    if (topLevelKey && topLevelKey in record) {
      focused[topLevelKey] = record[topLevelKey];
    }
  });

  return Object.keys(focused).length ? truncateDiagnostic(JSON.stringify(focused)) : "";
}

function describeChapterEventsArtifact(
  chapterEvents: StoryBlueprint["chapterEvents"],
  chapterIndex?: number
): AiGenerationArtifact {
  const eventCount = chapterEvents.reduce((sum, group) => sum + group.events.length, 0);
  return {
    kind: "chapter_events",
    summary: chapterIndex ? `第 ${chapterIndex} 章 ${eventCount} 个事件` : `${chapterEvents.length} 个章节事件组`,
    detail: `覆盖章节：${chapterEvents.map((group) => group.chapterIndex).join(", ")}`
  };
}

function describeStoryBlueprintArtifact(blueprint: StoryBlueprint): AiGenerationArtifact {
  const eventCount = blueprint.chapterEvents.reduce((sum, group) => sum + group.events.length, 0);
  return {
    kind: "story_blueprint",
    summary: `${blueprint.chapterEvents.length} 个章节事件组`,
    detail: `${eventCount} 个事件，${blueprint.storyBible.characterArcs.length} 条角色弧光`
  };
}

function describeScreenplayArtifact(screenplay: ScreenplayYaml): AiGenerationArtifact {
  return {
    kind: "screenplay",
    summary: `${screenplay.scenes.length} 场剧本`,
    detail: `${screenplay.characters.length} 个角色，${screenplay.rhythmStats.dialogueCount} 条对白`
  };
}
