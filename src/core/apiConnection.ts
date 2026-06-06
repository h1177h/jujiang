export interface AiConnectionSettings {
  baseUrl: string;
  useLocalProxy: boolean;
  providerBaseUrl?: string;
  apiKey?: string;
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
        headers
      }
    : { method: "GET" };

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
    message.startsWith("浏览器直连失败") ||
    message.startsWith("本地 proxy 未连接") ||
    message.startsWith("上游 AI 服务超时") ||
    message.startsWith("AI 服务临时不可用") ||
    message.startsWith("API 调用被限流")
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
