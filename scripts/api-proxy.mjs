import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_TARGET_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_PORT = 18787;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TARGET_BASE_URL_HEADER = "x-jujiang-target-base-url";
const DEFAULT_UPSTREAM_TIMEOUT_MS = 180_000;

export function normalizeTargetBaseUrl(value = DEFAULT_TARGET_BASE_URL) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return DEFAULT_TARGET_BASE_URL;
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API Base URL must start with http:// or https://");
  }
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function getProxyConfig(env = process.env) {
  return {
    port: Number(env.JUJIANG_PROXY_PORT || DEFAULT_PORT),
    targetBaseUrl: normalizeTargetBaseUrl(
      env.JUJIANG_API_BASE_URL || env.OPENAI_BASE_URL || DEFAULT_TARGET_BASE_URL
    ),
    apiKey: env.JUJIANG_API_KEY || env.OPENAI_API_KEY || "",
    networkProxyUrl: getNetworkProxyUrl(env),
    upstreamTimeoutMs: normalizeUpstreamTimeoutMs(env.JUJIANG_UPSTREAM_TIMEOUT_MS)
  };
}

export function getNetworkProxyUrl(env = process.env) {
  return env.JUJIANG_NETWORK_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "";
}

export function createApiProxyServer(config = getProxyConfig()) {
  return createServer(async (request, response) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      const requestApiKey = readBearerToken(request.headers.authorization);
      let targetBaseUrl = config.targetBaseUrl;
      try {
        targetBaseUrl = resolveRequestTargetBaseUrl(config, request);
      } catch (error) {
        writeJson(response, 400, {
          ok: false,
          service: "jujiang-api-proxy",
          error: error instanceof Error ? error.message : "Invalid API Base URL"
        });
        return;
      }
      writeJson(response, 200, {
        ok: true,
        service: "jujiang-api-proxy",
        targetBaseUrl,
        hasApiKey: Boolean(config.apiKey || requestApiKey),
        networkProxy: config.networkProxyUrl || ""
      });
      return;
    }

    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      writeJson(response, 404, {
        error: "剧匠应用内 AI 服务只支持 POST /v1/chat/completions。"
      });
      return;
    }

    const requestApiKey = readBearerToken(request.headers.authorization);
    const apiKey = config.apiKey || requestApiKey;
    if (!apiKey) {
      writeJson(response, 500, {
        error: "请先设置 JUJIANG_API_KEY / OPENAI_API_KEY，或在页面填写 API Key 后通过应用内 AI 服务调用。"
      });
      return;
    }

    let targetBaseUrl = config.targetBaseUrl;
    let forwardingToUpstream = false;
    const clientAbortController = createClientAbortController(request, response);
    try {
      const body = await readBody(request);
      targetBaseUrl = resolveRequestTargetBaseUrl(config, request);
      forwardingToUpstream = true;
      const upstream = await requestUpstreamChatCompletions(
        config,
        body,
        apiKey,
        targetBaseUrl,
        clientAbortController.signal
      );
      const text = await upstream.text();

      if (response.destroyed || clientAbortController.signal.aborted) {
        return;
      }

      response.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/json"
      });
      response.end(text);
    } catch (error) {
      if (response.destroyed || clientAbortController.signal.aborted) {
        return;
      }
      const upstreamTimedOut = forwardingToUpstream && isUpstreamTimeout(error);
      writeJson(response, upstreamTimedOut ? 504 : forwardingToUpstream ? 502 : 500, {
        error: forwardingToUpstream
          ? upstreamTimedOut
            ? formatUpstreamTimeout(targetBaseUrl, config.upstreamTimeoutMs)
            : formatUpstreamFailure(targetBaseUrl, error)
          : error instanceof Error ? error.message : "应用内 AI 服务请求失败。"
      });
    } finally {
      clientAbortController.cleanup();
    }
  });
}

export async function requestUpstreamChatCompletions(
  config,
  body,
  apiKey = config.apiKey,
  targetBaseUrl = config.targetBaseUrl,
  clientSignal
) {
  const dispatcher = config.networkProxyUrl ? new ProxyAgent(config.networkProxyUrl) : undefined;
  const timeoutMs = normalizeUpstreamTimeoutMs(config.upstreamTimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`upstream timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  const abortFromClient = () => {
    controller.abort(clientSignal.reason || new Error("client aborted request"));
  };
  if (clientSignal?.aborted) {
    abortFromClient();
  } else {
    clientSignal?.addEventListener("abort", abortFromClient, { once: true });
  }

  try {
    return await undiciFetch(`${targetBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body,
        dispatcher,
        signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
    clientSignal?.removeEventListener("abort", abortFromClient);
  }
}

function createClientAbortController(request, response) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("client aborted request"));
    }
  };
  const abortIfResponseClosedEarly = () => {
    if (!response.writableEnded) {
      abort();
    }
  };

  request.on("aborted", abort);
  response.on("close", abortIfResponseClosedEarly);

  return {
    signal: controller.signal,
    cleanup() {
      request.off("aborted", abort);
      response.off("close", abortIfResponseClosedEarly);
    }
  };
}

function resolveRequestTargetBaseUrl(config, request) {
  const value = readSingleHeader(request.headers[TARGET_BASE_URL_HEADER]);
  return value ? normalizeTargetBaseUrl(value) : config.targetBaseUrl;
}

function readSingleHeader(value) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function readBearerToken(authorization = "") {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Jujiang-Target-Base-Url");
}

function writeJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function formatUpstreamFailure(targetBaseUrl, error) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  return `上游 AI provider 连接失败：${targetBaseUrl}。请检查 Base URL、网络代理或 provider 服务状态。底层错误：${truncateDiagnostic(message)}`;
}

function formatUpstreamTimeout(targetBaseUrl, timeoutMs) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `上游 AI provider 请求超时：${targetBaseUrl}。等待 ${seconds}s 后仍未返回，可重试。请检查 Base URL、网络代理或 provider 服务状态。`;
}

function isUpstreamTimeout(error) {
  return error instanceof Error && /upstream timeout|aborted|aborterror|timeouterror/i.test(`${error.name} ${error.message}`);
}

function normalizeUpstreamTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPSTREAM_TIMEOUT_MS;
}

function truncateDiagnostic(value) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 300 ? `${normalized.slice(0, 300)}...` : normalized;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求体超过 2MB，已拒绝代理。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = getProxyConfig();
  const server = createApiProxyServer(config);

  server.listen(config.port, "127.0.0.1", () => {
    console.log(`Jujiang AI service listening on http://127.0.0.1:${config.port}/v1`);
    console.log(`Upstream: ${config.targetBaseUrl}`);
    console.log(`Network proxy: ${config.networkProxyUrl || "none"}`);
    console.log(`API key: ${config.apiKey ? "loaded from env" : "missing"}`);
  });
}
