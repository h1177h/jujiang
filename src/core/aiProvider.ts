import type { AdaptationStyle, ScreenplayYaml } from "./types";
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
    "你的任务是把三章以上小说改成结构化剧本初稿。",
    "输出必须匹配剧匠 ScreenplayYaml Schema：work、adaptationPlan、characters、chapterMappings、scenes、rhythmStats、storyDiagnostics、validationHints。",
    "每章至少拆出 1 个 scene；如果段落足够，优先拆成 setup / turning_point / payoff。",
    "每个 scene 必须保留 source，写出 chapterIndex、chapterTitle、paragraphIndexes、lineStart、lineEnd、excerpt。",
    "不要照抄本文说明，不要编造不存在的章节。"
  ].join("\n");
}

function buildUserPrompt(options: AiGenerationOptions): string {
  return JSON.stringify({
    title: options.title,
    adaptationStyle: options.style,
    schemaNotes: {
      generatedBy: "请写成 api:<model>",
      conflictLevel: "1 到 5 的整数",
      pacing: ["quiet", "steady", "tense", "cliffhanger"],
      beatType: ["setup", "turning_point", "payoff"],
      minimumScenes: 3
    },
    novelText: options.novelText
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
