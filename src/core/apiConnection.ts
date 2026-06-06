export interface AiConnectionSettings {
  baseUrl: string;
  useLocalProxy: boolean;
  apiKey?: string;
}

export interface AiConnectionResult {
  ok: boolean;
  message: string;
}

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

export async function diagnoseAiConnection(
  settings: AiConnectionSettings,
  fetcher: FetchLike = fetch
): Promise<AiConnectionResult> {
  if (!settings.useLocalProxy) {
    return {
      ok: true,
      message: "前端直连模式不会预检 provider；如果浏览器拦截请求，请切换本地 proxy。"
    };
  }

  const healthUrl = deriveProxyHealthUrl(settings.baseUrl);
  const apiKey = settings.apiKey?.trim();
  const init: RequestInit = apiKey
    ? {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    : { method: "GET" };

  try {
    const response = await fetcher(healthUrl, init);
    const payload = (await response.json().catch(() => ({}))) as {
      hasApiKey?: boolean;
      targetBaseUrl?: string;
      networkProxy?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        message: `本地 proxy 健康检查失败：HTTP ${response.status ?? "非 2xx"}。请重启 npm run proxy。`
      };
    }

    if (!payload.hasApiKey) {
      return {
        ok: false,
        message: "本地 proxy 没有读到 API Key：请在页面填写 API Key，或设置 JUJIANG_API_KEY / OPENAI_API_KEY 后重启 npm run proxy。"
      };
    }

    return {
      ok: true,
      message: `本地 proxy 已连接：${payload.targetBaseUrl || settings.baseUrl}`
    };
  } catch {
    return {
      ok: false,
      message: `本地 proxy 未连接：请先运行 npm run proxy，并确认 ${healthUrl} 可访问。`
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
    return "本地 proxy 未连接：请先运行 npm run proxy，并确认 /health 可以访问。";
  }

  return "浏览器直连失败：这通常是 CORS、系统代理或网络拦截导致。请勾选“本地 proxy”，运行 npm run proxy 后再生成。";
}

export function isActionableConnectionMessage(message: string): boolean {
  return (
    message.startsWith("浏览器直连失败") ||
    message.startsWith("本地 proxy 未连接") ||
    message.startsWith("本地 proxy 没有读到 API Key") ||
    message.startsWith("本地 proxy 健康检查失败")
  );
}
