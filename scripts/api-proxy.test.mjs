import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApiProxyServer, getProxyConfig, normalizeTargetBaseUrl } from "./api-proxy.mjs";

const servers = [];
let nextTestPort = 19080;

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

async function listen(server) {
  servers.push(server);
  const port = nextTestPort++;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

describe("api proxy config", () => {
  it("normalizes compatible API base URLs", () => {
    expect(normalizeTargetBaseUrl("https://api.example.com")).toBe("https://api.example.com/v1");
    expect(normalizeTargetBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeTargetBaseUrl(" ")).toBe("https://api.openai.com/v1");
  });

  it("reads Jujiang proxy environment variables first", () => {
    const config = getProxyConfig({
      JUJIANG_PROXY_PORT: "8989",
      JUJIANG_API_BASE_URL: "https://proxy.example.com",
      JUJIANG_API_KEY: "jujiang-key",
      OPENAI_BASE_URL: "https://openai.example.com",
      OPENAI_API_KEY: "openai-key"
    });

    expect(config).toEqual({
      port: 8989,
      targetBaseUrl: "https://proxy.example.com/v1",
      apiKey: "jujiang-key",
      networkProxyUrl: ""
    });
  });

  it("uses a Jujiang-specific default port", () => {
    expect(getProxyConfig({}).port).toBe(18787);
  });

  it("reads HTTPS proxy settings for Node upstream requests", () => {
    const config = getProxyConfig({
      JUJIANG_API_KEY: "key",
      HTTPS_PROXY: "http://127.0.0.1:7897",
      HTTP_PROXY: "http://127.0.0.1:7898"
    });

    expect(config.networkProxyUrl).toBe("http://127.0.0.1:7897");
  });

  it("accepts a browser-provided API key during health checks", async () => {
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: "https://api.example.com/v1",
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const response = await fetch(`${proxyBaseUrl}/health`, {
      headers: {
        Authorization: "Bearer browser-key"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.hasApiKey).toBe(true);
  });

  it("uses the browser-provided upstream base URL during health checks", async () => {
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: "https://api.openai.com/v1",
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const response = await fetch(`${proxyBaseUrl}/health`, {
      headers: {
        Authorization: "Bearer browser-key",
        "X-Jujiang-Target-Base-Url": "https://api.deepseek.com"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.targetBaseUrl).toBe("https://api.deepseek.com/v1");
    expect(payload.hasApiKey).toBe(true);
  });

  it("forwards the browser-provided API key when no environment key is configured", async () => {
    let upstreamAuthorization = "";
    const upstream = createServer((request, response) => {
      upstreamAuthorization = request.headers.authorization || "";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }));
    });
    const upstreamBaseUrl = await listen(upstream);
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: `${upstreamBaseUrl}/v1`,
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const response = await fetch(`${proxyBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-key"
      },
      body: JSON.stringify({ model: "test-model", messages: [] })
    });

    expect(response.status).toBe(200);
    expect(upstreamAuthorization).toBe("Bearer browser-key");
  });

  it("forwards chat completions to the browser-provided upstream base URL", async () => {
    let upstreamAuthorization = "";
    let upstreamPath = "";
    const upstream = createServer((request, response) => {
      upstreamAuthorization = request.headers.authorization || "";
      upstreamPath = request.url || "";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }));
    });
    const upstreamBaseUrl = await listen(upstream);
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: "https://api.openai.com/v1",
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const response = await fetch(`${proxyBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-key",
        "X-Jujiang-Target-Base-Url": upstreamBaseUrl
      },
      body: JSON.stringify({ model: "test-model", messages: [] })
    });

    expect(response.status).toBe(200);
    expect(upstreamAuthorization).toBe("Bearer browser-key");
    expect(upstreamPath).toBe("/v1/chat/completions");
  });

  it("wraps upstream 504 responses with a proxy request id when the provider body is not useful", async () => {
    const upstream = createServer((request, response) => {
      response.writeHead(504, { "Content-Type": "text/plain" });
      response.end("Gateway Timeout");
    });
    const upstreamBaseUrl = await listen(upstream);
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: `${upstreamBaseUrl}/v1`,
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const response = await fetch(`${proxyBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-key"
      },
      body: JSON.stringify({ model: "test-model", messages: [] })
    });
    const payload = await response.json();

    expect(response.status).toBe(504);
    expect(response.headers.get("x-jujiang-request-id")).toMatch(/^jj-/);
    expect(payload.error.message).toBe("上游 AI 服务返回 HTTP 504");
    expect(payload.error.requestId).toBe(response.headers.get("x-jujiang-request-id"));
    expect(payload.error.upstreamStatus).toBe(504);
  });

  it("runs chat completions through a pollable task", async () => {
    const upstream = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }));
    });
    const upstreamBaseUrl = await listen(upstream);
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: `${upstreamBaseUrl}/v1`,
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const createResponse = await fetch(`${proxyBaseUrl}/v1/generation-tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-key"
      },
      body: JSON.stringify({ model: "test-model", messages: [] })
    });
    const created = await createResponse.json();

    expect(createResponse.status).toBe(202);
    expect(created.task.id).toMatch(/^task-/);
    expect(created.task.status).toMatch(/queued|running|completed/);

    const task = await waitForTask(proxyBaseUrl, created.task.id);

    expect(task.status).toBe("completed");
    expect(task.response.choices[0].message.content).toBe("{\"ok\":true}");
  });

  it("lists recent generation tasks for recovery after a page refresh", async () => {
    const upstream = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }));
    });
    const upstreamBaseUrl = await listen(upstream);
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: `${upstreamBaseUrl}/v1`,
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const createResponse = await fetch(`${proxyBaseUrl}/v1/generation-tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-key"
      },
      body: JSON.stringify({ model: "test-model", messages: [] })
    });
    const created = await createResponse.json();
    const task = await waitForTask(proxyBaseUrl, created.task.id);

    const listResponse = await fetch(`${proxyBaseUrl}/v1/generation-tasks`);
    const listed = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listed.tasks[0]).toMatchObject({
      id: task.id,
      requestId: task.requestId,
      status: "completed"
    });
    expect(listed.tasks[0].response).toBeNull();
  });

  it("keeps provider errors on failed generation tasks", async () => {
    const upstream = createServer((request, response) => {
      response.writeHead(504, { "Content-Type": "text/plain" });
      response.end("Gateway Timeout");
    });
    const upstreamBaseUrl = await listen(upstream);
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: `${upstreamBaseUrl}/v1`,
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const createResponse = await fetch(`${proxyBaseUrl}/v1/generation-tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-key"
      },
      body: JSON.stringify({ model: "test-model", messages: [] })
    });
    const created = await createResponse.json();
    const task = await waitForTask(proxyBaseUrl, created.task.id);

    expect(task.status).toBe("failed");
    expect(task.error.message).toBe("上游 AI 服务返回 HTTP 504");
    expect(task.error.upstreamStatus).toBe(504);
    expect(task.requestId).toMatch(/^jj-/);
  });

  it("cancels a queued or running generation task", async () => {
    const upstream = createServer((request, response) => {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }));
      }, 100);
    });
    const upstreamBaseUrl = await listen(upstream);
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: `${upstreamBaseUrl}/v1`,
      apiKey: "",
      networkProxyUrl: ""
    });
    const proxyBaseUrl = await listen(proxy);

    const createResponse = await fetch(`${proxyBaseUrl}/v1/generation-tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-key"
      },
      body: JSON.stringify({ model: "test-model", messages: [] })
    });
    const created = await createResponse.json();

    const cancelResponse = await fetch(`${proxyBaseUrl}/v1/generation-tasks/${created.task.id}`, {
      method: "DELETE"
    });
    const cancelled = await cancelResponse.json();

    expect(cancelResponse.status).toBe(200);
    expect(cancelled.task.status).toBe("cancelled");
  });
});

async function waitForTask(proxyBaseUrl, taskId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(`${proxyBaseUrl}/v1/generation-tasks/${taskId}`);
    const payload = await response.json();
    if (payload.task.status !== "queued" && payload.task.status !== "running") {
      return payload.task;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Task ${taskId} did not finish`);
}
