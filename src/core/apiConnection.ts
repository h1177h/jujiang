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
  text?: () => Promise<string>;
}>;

type ProbeChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<string | { text?: string; content?: string }>;
      tool_calls?: ProbeChatCompletionToolCall[];
      function_call?: ProbeChatCompletionFunctionCall;
    };
  }>;
  error?: string | { message?: string };
};

type ProbeChatCompletionToolCall = {
  type?: string;
  function?: ProbeChatCompletionFunctionCall;
};

type ProbeChatCompletionFunctionCall = {
  name?: string;
  arguments?: string;
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
      try {
        return await probeAiProvider(
          settings,
          payload.targetBaseUrl || settings.providerBaseUrl || settings.baseUrl,
          fetcher
        );
      } catch (error) {
        return {
          ok: false,
          message: formatProviderProbeFetchFailure(error)
        };
      }
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

function formatProviderProbeFetchFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `AI provider 连接检查失败：应用内 AI 服务已响应 health，但 provider 探测请求没有完成。请重新测试连接；如果持续失败，重启 npm run dev:app 后再试。底层错误：${truncateConnectionDiagnostic(message)}`;
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
  const payload = await readProbeChatCompletionResponse(response);

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

async function readProbeChatCompletionResponse(response: Awaited<ReturnType<FetchLike>>): Promise<ProbeChatCompletionResponse> {
  try {
    const payload = (await response.json()) as ProbeChatCompletionResponse;
    return payload || {};
  } catch {
    const rawText = await response.text?.().catch(() => "");
    return rawText ? { error: rawText } : {};
  }
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

  const callDiagnostic = getProbeCallDiagnostic(payload);
  if (callDiagnostic) {
    return `返回了工具调用而不是文本。${callDiagnostic}`;
  }

  const finishReason = payload.choices?.[0]?.finish_reason;
  return finishReason ? `finish_reason=${finishReason}` : "choices[0].message.content 为空";
}

function getProbeCallDiagnostic(payload: ProbeChatCompletionResponse): string {
  if (!payload.choices?.length) {
    return "";
  }

  for (const choice of payload.choices) {
    const message = choice.message;
    if (!message) continue;

    if (message.tool_calls?.length) {
      const names = message.tool_calls
        .map((call) => call.function?.name)
        .filter((name): name is string => Boolean(name));
      const nameSummary = names.length ? `工具：${truncateConnectionDiagnostic(names.join(", "))}。` : "";
      const reason = choice.finish_reason ? `finish_reason=${choice.finish_reason}。` : "";
      return `${reason}${nameSummary}Provider 返回：${truncateConnectionDiagnostic(JSON.stringify(message.tool_calls))}`;
    }

    if (message.function_call) {
      const functionName = message.function_call.name ? `函数：${message.function_call.name}。` : "";
      const reason = choice.finish_reason ? `finish_reason=${choice.finish_reason}。` : "";
      return `${reason}${functionName}Provider 返回：${truncateConnectionDiagnostic(JSON.stringify(message.function_call))}`;
    }
  }

  return "";
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
