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

  it("reports the upstream provider target when chat completion forwarding fails", async () => {
    const proxy = createApiProxyServer({
      port: 0,
      targetBaseUrl: "http://127.0.0.1:9/v1",
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

    expect(response.status).toBe(502);
    expect(payload.error).toContain("上游 AI provider 连接失败");
    expect(payload.error).toContain("http://127.0.0.1:9/v1");
    expect(payload.error).toContain("请检查 Base URL、网络代理或 provider 服务状态");
  });
});
