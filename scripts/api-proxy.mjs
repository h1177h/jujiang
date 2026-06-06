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
  const taskStore = createGenerationTaskStore(config);

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

    if (request.url?.startsWith("/v1/generation-tasks")) {
      await handleGenerationTaskRequest(config, taskStore, request, response);
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
      const requestId = createRequestId();
      const body = await readBody(request);
      const targetBaseUrl = resolveRequestTargetBaseUrl(config, request);
      const upstream = await requestUpstreamChatCompletions(config, body, apiKey, targetBaseUrl);
      const text = await upstream.text();
      response.setHeader("X-Jujiang-Request-Id", requestId);

      if (!upstream.ok && !hasProviderErrorMessage(text)) {
        writeJson(response, upstream.status, {
          error: {
            message: `上游 AI 服务返回 HTTP ${upstream.status}`,
            requestId,
            upstreamStatus: upstream.status,
            targetBaseUrl
          }
        });
        return;
      }

      if (upstream.ok) {
        const normalized = normalizeSuccessfulProviderResponse(
          text,
          upstream.headers.get("content-type") || "",
          requestId,
          targetBaseUrl
        );
        if (!normalized.ok) {
          writeJson(response, 502, { error: normalized.error });
          return;
        }
        writeJson(response, upstream.status, normalized.response);
        return;
      }

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
        dispatcher,
        signal: config.signal
  });
}

function createGenerationTaskStore(config) {
  const tasks = new Map();

  function get(id) {
    return tasks.get(id) || null;
  }

  function list(limit = 20) {
    return Array.from(tasks.values())
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, limit);
  }

  function create({ body, apiKey, targetBaseUrl }) {
    const now = new Date().toISOString();
    const task = {
      id: createTaskId(),
      requestId: createRequestId(),
      status: "queued",
      targetBaseUrl,
      createdAt: now,
      updatedAt: now,
      response: null,
      error: null,
      abortController: new AbortController()
    };
    tasks.set(task.id, task);
    queueMicrotask(() => runGenerationTask(config, task, body, apiKey));
    return task;
  }

  function cancel(id) {
    const task = get(id);
    if (!task) {
      return null;
    }
    if (task.status === "queued" || task.status === "running") {
      task.abortController.abort();
      updateTask(task, {
        status: "cancelled",
        error: {
          message: "生成任务已取消"
        }
      });
    }
    return task;
  }

  return { create, get, list, cancel };
}

async function handleGenerationTaskRequest(config, taskStore, request, response) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const taskId = url.pathname.match(/^\/v1\/generation-tasks\/([^/]+)$/)?.[1] || "";

  if (request.method === "GET" && url.pathname === "/v1/generation-tasks") {
    writeJson(response, 200, { tasks: taskStore.list().map((task) => serializeTask(task, { includeResponse: false })) });
    return;
  }

  if (request.method === "GET" && taskId) {
    const task = taskStore.get(taskId);
    if (!task) {
      writeJson(response, 404, { error: "生成任务不存在" });
      return;
    }
    writeJson(response, 200, { task: serializeTask(task) });
    return;
  }

  if (request.method === "DELETE" && taskId) {
    const task = taskStore.cancel(taskId);
    if (!task) {
      writeJson(response, 404, { error: "生成任务不存在" });
      return;
    }
    writeJson(response, 200, { task: serializeTask(task) });
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/v1/generation-tasks") {
    writeJson(response, 404, { error: "生成任务接口不存在" });
    return;
  }

  const requestApiKey = readBearerToken(request.headers.authorization);
  const apiKey = config.apiKey || requestApiKey;
  if (!apiKey) {
    writeJson(response, 500, {
      error: "请先设置 JUJIANG_API_KEY / OPENAI_API_KEY，或在页面填写并保存 API Key 后再生成。"
    });
    return;
  }

  try {
    const body = await readBody(request);
    const targetBaseUrl = resolveRequestTargetBaseUrl(config, request);
    const task = taskStore.create({ body, apiKey, targetBaseUrl });
    response.setHeader("X-Jujiang-Request-Id", task.requestId);
    writeJson(response, 202, { task: serializeTask(task) });
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : "创建生成任务失败。"
    });
  }
}

async function runGenerationTask(config, task, body, apiKey) {
  if (task.status === "cancelled") return;
  updateTask(task, { status: "running" });

  try {
    const upstream = await requestUpstreamChatCompletions(
      { ...config, signal: task.abortController.signal },
      body,
      apiKey,
      task.targetBaseUrl
    );
    const text = await upstream.text();
    if (task.status === "cancelled") return;

    if (!upstream.ok) {
      updateTask(task, {
        status: "failed",
        error: buildUpstreamTaskError(text, upstream.status, task.requestId, task.targetBaseUrl)
      });
      return;
    }

    const normalized = normalizeSuccessfulProviderResponse(
      text,
      upstream.headers.get("content-type") || "",
      task.requestId,
      task.targetBaseUrl
    );
    if (!normalized.ok) {
      updateTask(task, {
        status: "failed",
        error: normalized.error
      });
      return;
    }

    updateTask(task, {
      status: "completed",
      response: normalized.response
    });
  } catch (error) {
    if (task.status === "cancelled") return;
    updateTask(task, {
      status: "failed",
      error: {
        message: error instanceof Error ? error.message : "生成任务请求失败"
      }
    });
  }
}

function updateTask(task, patch) {
  Object.assign(task, patch, {
    updatedAt: new Date().toISOString()
  });
}

function serializeTask(task, options = { includeResponse: true }) {
  return {
    id: task.id,
    requestId: task.requestId,
    status: task.status,
    targetBaseUrl: task.targetBaseUrl,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    response: options.includeResponse ? task.response : null,
    error: task.error
  };
}

function buildUpstreamTaskError(text, status, requestId, targetBaseUrl) {
  try {
    const payload = JSON.parse(text);
    return {
      message: payload?.error?.message || payload?.message || `上游 AI 服务返回 HTTP ${status}`,
      requestId,
      upstreamStatus: status,
      targetBaseUrl
    };
  } catch {
    return {
      message: `上游 AI 服务返回 HTTP ${status}`,
      requestId,
      upstreamStatus: status,
      targetBaseUrl
    };
  }
}

function normalizeSuccessfulProviderResponse(text, contentType, requestId, targetBaseUrl) {
  const response = parseProviderResponseText(text, contentType);
  if (!response.ok) {
    return {
      ok: false,
      error: {
        message: response.message,
        requestId,
        upstreamStatus: 200,
        targetBaseUrl,
        providerSummary: response.providerSummary
      }
    };
  }
  return {
    ok: true,
    response: response.payload
  };
}

function parseProviderResponseText(text, contentType = "") {
  if (looksLikeSse(text, contentType)) {
    return parseSseChatCompletion(text);
  }

  try {
    const payload = JSON.parse(text);
    const content = extractChatMessageContent(payload);
    if (content) {
      return { ok: true, payload };
    }

    return {
      ok: false,
      message: "上游 AI 服务没有返回可用正文，请更换可用模型或检查该 provider 的响应格式。",
      providerSummary: summarizeProviderPayload(payload, contentType)
    };
  } catch {
    return {
      ok: false,
      message: "上游 AI 服务返回了非 JSON 内容，剧匠无法读取生成结果。",
      providerSummary: summarizeProviderText(text, contentType)
    };
  }
}

function looksLikeSse(text, contentType) {
  return /text\/event-stream/i.test(contentType) || /^\s*data:\s*/m.test(text);
}

function parseSseChatCompletion(text) {
  const chunks = [];
  let usage = null;
  let lastPayload = null;
  let parsedEventCount = 0;
  let choiceCount = 0;
  const finishReasons = new Set();
  const errors = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const payload = JSON.parse(data);
      parsedEventCount += 1;
      lastPayload = payload;
      if (payload?.error?.message || payload?.message) {
        errors.push(payload.error?.message || payload.message);
      }
      if (payload?.usage) {
        usage = payload.usage;
      }
      const choices = Array.isArray(payload?.choices) ? payload.choices : [];
      choiceCount += choices.length;
      for (const choice of choices) {
        if (choice?.finish_reason) {
          finishReasons.add(choice.finish_reason);
        }
        const content =
          stringOrEmpty(choice?.delta?.content) ||
          stringOrEmpty(choice?.message?.content) ||
          stringOrEmpty(choice?.text);
        if (content) {
          chunks.push(content);
        }
      }
    } catch {
      errors.push("SSE 数据片段不是有效 JSON");
    }
  }

  const content = chunks.join("");
  if (content.trim()) {
    return {
      ok: true,
      payload: {
        choices: [
          {
            message: {
              content
            },
            finish_reason: Array.from(finishReasons).at(-1) || undefined
          }
        ],
        ...(usage ? { usage } : {})
      }
    };
  }

  const providerSummary = [
    `contentType=${contentTypeOrUnknown("text/event-stream")}`,
    `events=${parsedEventCount}`,
    `choices=${choiceCount}`,
    usage?.completion_tokens !== undefined ? `completion_tokens=${usage.completion_tokens}` : null,
    finishReasons.size ? `finish_reason=${Array.from(finishReasons).join(",")}` : null,
    lastPayload ? `lastKeys=${Object.keys(lastPayload).slice(0, 8).join(",")}` : null,
    errors.length ? `errors=${errors.slice(0, 2).join(" / ")}` : null
  ]
    .filter(Boolean)
    .join("; ");

  return {
    ok: false,
    message: errors[0] || "上游 AI 服务没有返回可用正文，请更换可用模型或检查该 provider 的响应格式。",
    providerSummary
  };
}

function extractChatMessageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

function summarizeProviderPayload(payload, contentType) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const firstChoice = choices[0] || {};
  const message = firstChoice.message || {};
  const usage = payload?.usage || {};
  return [
    `contentType=${contentTypeOrUnknown(contentType)}`,
    `choices=${choices.length}`,
    firstChoice.finish_reason ? `finish_reason=${firstChoice.finish_reason}` : null,
    usage.completion_tokens !== undefined ? `completion_tokens=${usage.completion_tokens}` : null,
    `topKeys=${Object.keys(payload || {}).slice(0, 8).join(",") || "none"}`,
    `messageKeys=${Object.keys(message).slice(0, 8).join(",") || "none"}`
  ]
    .filter(Boolean)
    .join("; ");
}

function summarizeProviderText(text, contentType) {
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 160);
  return [`contentType=${contentTypeOrUnknown(contentType)}`, compact ? `body=${compact}` : "body=empty"].join("; ");
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function contentTypeOrUnknown(value) {
  return value || "unknown";
}

function createTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function createRequestId() {
  return `jj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function hasProviderErrorMessage(text) {
  try {
    const payload = JSON.parse(text);
    return Boolean(payload?.error?.message || payload?.message);
  } catch {
    return false;
  }
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET, DELETE");
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
