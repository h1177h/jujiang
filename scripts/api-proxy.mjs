import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_TARGET_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_PORT = 18787;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TARGET_BASE_URL_HEADER = "x-jujiang-target-base-url";

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
    networkProxyUrl: getNetworkProxyUrl(env)
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

    try {
      const body = await readBody(request);
      const targetBaseUrl = resolveRequestTargetBaseUrl(config, request);
      const upstream = await requestUpstreamChatCompletions(config, body, apiKey, targetBaseUrl);
      const text = await upstream.text();

      response.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/json"
      });
      response.end(text);
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : "应用内 AI 服务请求失败。"
      });
    }
  });
}

export function requestUpstreamChatCompletions(config, body, apiKey = config.apiKey, targetBaseUrl = config.targetBaseUrl) {
  const dispatcher = config.networkProxyUrl ? new ProxyAgent(config.networkProxyUrl) : undefined;

  return undiciFetch(`${targetBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body,
        dispatcher
  });
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
