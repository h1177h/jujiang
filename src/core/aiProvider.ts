import type { AdaptationStyle, ScreenplayYaml } from "./types";
import { parseChapters } from "./chapters";
import { validateScreenplay } from "./schema";

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
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildSystemPrompt()
        },
        {
          role: "user",
          content: buildUserPrompt(options)
        }
      ]
    }),
    signal: options.signal
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `API 请求失败：HTTP ${response.status}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("API 没有返回可解析的剧本内容。");
  }

  const parsed = parseJsonObject(content);
  const normalized = normalizeApiScreenplay(parsed, settings.model);
  const result = validateScreenplay(normalized);
  if (!result.success) {
    throw new Error(`API 返回结构未通过 Schema：${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }

  return result.data;
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

function buildSystemPrompt(): string {
  return [
    "你是剧匠的小说改编引擎，只输出 JSON，不要输出 Markdown。",
    "你的任务是把结构化章节上下文改成剧本初稿，短篇片段和多章长文都可以处理。",
    "处理长文时必须先按 sourceChapters 提取每章关键事件、人物行动和冲突转折，再决定分场，不能机械按章节数量平均拆分。",
    "输出必须匹配剧匠 ScreenplayYaml Schema：work、adaptationPlan、characters、chapterMappings、scenes、rhythmStats、storyDiagnostics、validationHints。",
    "每个结构单元至少拆出 1 个 scene；如果段落足够，优先拆成 setup / turning_point / payoff。",
    "每个 scene 必须保留 source，写出 chapterIndex、chapterTitle、paragraphIndexes、lineStart、lineEnd、excerpt。",
    "不要照抄本文说明，不要编造不存在的章节。"
  ].join("\n");
}

function buildUserPrompt(options: AiGenerationOptions): string {
  const sourceChapters = parseChapters(options.novelText).map((chapter) => ({
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

  return JSON.stringify({
    title: options.title,
    adaptationStyle: options.style,
    longNovelStrategy: [
      "先从每章 paragraphs 中提取事件链、人物目标、阻碍、转折和结尾钩子。",
      "再把事件链改编成 scenes；地点、时间、人物行动或冲突发生变化时才开新场。",
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
    sourceChapters
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

function normalizeApiScreenplay(value: unknown, model: string): ScreenplayYaml {
  if (!value || typeof value !== "object") {
    throw new Error("API 返回 JSON 不是对象。");
  }

  const screenplay = value as ScreenplayYaml;
  return {
    ...screenplay,
    work: {
      ...screenplay.work,
      generatedBy: screenplay.work?.generatedBy || `api:${model}`
    }
  };
}
