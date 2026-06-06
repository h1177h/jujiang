import type { AdaptationStyle, ScreenplayYaml, StoryBlueprint } from "./types";
import { classifyFetchFailure } from "./apiConnection";
import { parseChapters } from "./chapters";
import { validateScreenplay, validateStoryBlueprint } from "./schema";

export interface AiProviderSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiGenerationOptions {
  title: string;
  style: AdaptationStyle;
  novelText: string;
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
  const normalized = normalizeApiScreenplay(parsed, settings.model, blueprint);
  const result = validateScreenplay(normalized);
  if (!result.success) {
    throw new Error(`API 返回结构未通过 Schema：${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  return result.data;
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
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
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
    throw new Error(payload.error?.message || `API 请求失败：HTTP ${response.status}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("API 没有返回可解析的剧本内容。");
  }

  return content;
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
