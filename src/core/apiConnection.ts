export interface AiConnectionSettings {
  baseUrl: string;
  useLocalProxy: boolean;
  providerBaseUrl?: string;
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface AiConnectionResult {
  ok: boolean;
  message: string;
}

export const defaultLocalProxyBaseUrl = "http://127.0.0.1:18787/v1";
const oldDefaultLocalProxyBaseUrl = "http://127.0.0.1:8787/v1";

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

type ProbeChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<string | { text?: string; content?: string }>;
    };
  }>;
  error?: string | { message?: string };
};

export function deriveProxyHealthUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim().replace(/\/+$/, ""));
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function resolveAiRequestBaseUrl(baseUrl: string, useLocalProxy: boolean): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!useLocalProxy) {
    return normalized;
  }

  if (normalized === oldDefaultLocalProxyBaseUrl) {
    return defaultLocalProxyBaseUrl;
  }

  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(normalized)) {
    return normalized;
  }

  return defaultLocalProxyBaseUrl;
}

export async function diagnoseAiConnection(
  settings: AiConnectionSettings,
  fetcher: FetchLike = fetch
): Promise<AiConnectionResult> {
  const configIssue = validateAiConnectionConfig(settings);
  if (configIssue) {
    return {
      ok: false,
      message: configIssue
    };
  }

  if (!settings.useLocalProxy) {
    return {
      ok: true,
      message: "当前使用浏览器直连，仅建议临时调试。"
    };
  }

  const healthUrl = deriveProxyHealthUrl(settings.baseUrl);
  const headers = buildAiGatewayHeaders(settings.apiKey, settings.providerBaseUrl);
  const init: RequestInit = Object.keys(headers).length
    ? {
        method: "GET",
        headers,
        signal: settings.signal
      }
    : { method: "GET", signal: settings.signal };

  try {
    const response = await fetcher(healthUrl, init);
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      service?: string;
      hasApiKey?: boolean;
      targetBaseUrl?: string;
      networkProxy?: string;
      error?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        message: payload.error || `AI 服务连接检查失败：HTTP ${response.status ?? "非 2xx"}。`
      };
    }

    if (payload.service !== "jujiang-api-proxy") {
      return {
        ok: false,
        message: "当前端口不是剧匠 AI 服务，请用 npm run dev:app 启动完整应用。"
      };
    }

    if (!payload.hasApiKey) {
      return {
        ok: false,
        message: "还没有可用的 API Key：请在页面填写并保存，或在本机环境变量中配置后重启应用服务。"
      };
    }

    if (settings.model?.trim()) {
      return probeAiProvider(settings, payload.targetBaseUrl || settings.providerBaseUrl || settings.baseUrl, fetcher);
    }

    return {
      ok: true,
      message: `AI 服务已连接：${payload.targetBaseUrl || settings.providerBaseUrl || settings.baseUrl}`
    };
  } catch {
    return {
      ok: false,
      message: `应用内 AI 服务没有启动：请用 npm run dev:app 启动完整应用后再生成。`
    };
  }
}

function validateAiConnectionConfig(settings: AiConnectionSettings): string | null {
  if (settings.model !== undefined && !settings.model.trim()) {
    return "请先填写 Model，再测试连接。";
  }

  if (settings.providerBaseUrl !== undefined) {
    const trimmedProviderBaseUrl = settings.providerBaseUrl.trim();
    if (!trimmedProviderBaseUrl) {
      return "请先填写 Provider Base URL，再测试连接。";
    }

    if (!/^https?:\/\//i.test(trimmedProviderBaseUrl)) {
      return "Provider Base URL 必须以 http:// 或 https:// 开头。";
    }
  }

  return null;
}

async function probeAiProvider(
  settings: AiConnectionSettings,
  targetBaseUrl: string,
  fetcher: FetchLike
): Promise<AiConnectionResult> {
  const response = await fetcher(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAiGatewayHeaders(settings.apiKey, settings.providerBaseUrl)
    },
    body: JSON.stringify({
      model: settings.model?.trim(),
      temperature: 0,
      max_tokens: 8,
      messages: [
        {
          role: "user",
          content: "Return only {\"ok\":true}."
        }
      ]
    }),
    signal: settings.signal
  });
  const payload = (await response.json().catch(() => ({}))) as ProbeChatCompletionResponse;

  if (!response.ok) {
    const providerMessage = getProbeProviderMessage(payload);
    return {
      ok: false,
      message: providerMessage
        ? `AI provider 连接检查失败：HTTP ${response.status ?? "非 2xx"}。Provider 返回：${truncateConnectionDiagnostic(providerMessage)}`
        : `AI provider 连接检查失败：HTTP ${response.status ?? "非 2xx"}。`
    };
  }

  const probeContent = extractProbeChatText(payload);
  if (!probeContent) {
    return {
      ok: false,
      message: `AI provider 连接检查失败：返回空内容。${formatProbeEmptyDiagnostic(payload)}`
    };
  }

  return {
    ok: true,
    message: `AI provider 已连接：${targetBaseUrl} · ${settings.model?.trim()}`
  };
}

function getProbeProviderMessage(payload: { error?: string | { message?: string } }): string {
  if (typeof payload.error === "string") {
    return payload.error;
  }
  return payload.error?.message || "";
}

function extractProbeChatText(payload: ProbeChatCompletionResponse): string {
  if (!payload.choices?.length) {
    return "";
  }

  for (const choice of payload.choices) {
    const content = extractProbeContentText(choice.message?.content);
    if (content.trim()) {
      return content;
    }
  }

  return "";
}

function extractProbeContentText(
  content: string | Array<string | { text?: string; content?: string }> | undefined
): string {
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

function formatProbeEmptyDiagnostic(payload: ProbeChatCompletionResponse): string {
  const providerMessage = getProbeProviderMessage(payload);
  if (providerMessage) {
    return `Provider 返回：${truncateConnectionDiagnostic(providerMessage)}`;
  }

  const finishReason = payload.choices?.[0]?.finish_reason;
  return finishReason ? `finish_reason=${finishReason}` : "choices[0].message.content 为空";
}

export function classifyFetchFailure(error: unknown, baseUrl: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const isFetchFailure = /failed to fetch|fetch failed|networkerror|load failed/i.test(message);

  if (!isFetchFailure) {
    return message;
  }

  if (/127\.0\.0\.1|localhost/i.test(baseUrl)) {
    return "应用内 AI 服务没有启动：请用 npm run dev:app 启动完整应用后再生成。";
  }

  return "AI 请求没有到达应用服务：请用 npm run dev:app 启动完整应用后再生成。";
}

export function isActionableConnectionMessage(message: string): boolean {
  return (
    message.startsWith("应用内 AI 服务没有启动") ||
    message.startsWith("AI 请求没有到达应用服务") ||
    message.startsWith("还没有可用的 API Key") ||
    message.startsWith("当前端口不是剧匠 AI 服务") ||
    message.startsWith("AI 服务连接检查失败") ||
    message.startsWith("AI provider 连接检查失败") ||
    message.startsWith("浏览器直连失败") ||
    message.startsWith("本地 proxy 未连接") ||
    message.includes("阶段请求超时") ||
    message.includes("阶段请求失败") ||
    message.includes("阶段返回了非 JSON 响应") ||
    message.includes("阶段返回空内容") ||
    message.includes("Provider 返回：") ||
    message.startsWith("上游 AI provider")
  );
}

export function buildAiGatewayHeaders(apiKey?: string, providerBaseUrl?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const trimmedApiKey = apiKey?.trim();
  const trimmedProviderBaseUrl = providerBaseUrl?.trim();

  if (trimmedApiKey) {
    headers.Authorization = `Bearer ${trimmedApiKey}`;
  }
  if (trimmedProviderBaseUrl) {
    headers["X-Jujiang-Target-Base-Url"] = trimmedProviderBaseUrl;
  }

  return headers;
}

function truncateConnectionDiagnostic(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 300 ? `${normalized.slice(0, 300)}...` : normalized;
}
