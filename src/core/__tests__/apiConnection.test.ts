import { describe, expect, it, vi } from "vitest";
import {
  classifyFetchFailure,
  deriveProxyHealthUrl,
  diagnoseAiConnection,
  isActionableConnectionMessage,
  resolveAiRequestBaseUrl
} from "../apiConnection";

describe("AI connection diagnostics", () => {
  it("derives local proxy health URL from v1 base URL", () => {
    expect(deriveProxyHealthUrl("http://127.0.0.1:18787/v1")).toBe("http://127.0.0.1:18787/health");
    expect(deriveProxyHealthUrl("http://localhost:18787/v1/")).toBe("http://localhost:18787/health");
  });

  it("forces the request URL to local proxy when proxy mode is enabled", () => {
    expect(resolveAiRequestBaseUrl("https://api.example.com/v1", true)).toBe("http://127.0.0.1:18787/v1");
    expect(resolveAiRequestBaseUrl("http://127.0.0.1:8787/v1", true)).toBe("http://127.0.0.1:18787/v1");
    expect(resolveAiRequestBaseUrl("http://127.0.0.1:18888/v1", true)).toBe("http://127.0.0.1:18888/v1");
    expect(resolveAiRequestBaseUrl("https://api.example.com/v1", false)).toBe("https://api.example.com/v1");
  });

  it("reports local proxy not reachable before generation", async () => {
    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true
      },
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    expect(result).toEqual({
      ok: false,
      message: "应用内 AI 服务没有启动：请用 npm run dev:app 启动完整应用后再生成。"
    });
  });

  it("reports local proxy missing API key", async () => {
    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true
      },
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, service: "jujiang-api-proxy", hasApiKey: false })
      }))
    );

    expect(result).toEqual({
      ok: false,
      message: "还没有可用的 API Key：请在页面填写并保存，或在本机环境变量中配置后重启应用服务。"
    });
  });

  it("rejects a different service listening on the proxy port", async () => {
    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true
      },
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "ok", sessions: 1 })
      }))
    );

    expect(result).toEqual({
      ok: false,
      message: "当前端口不是剧匠 AI 服务，请用 npm run dev:app 启动完整应用。"
    });
  });

  it("sends the browser-provided API key to local proxy diagnostics", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        service: "jujiang-api-proxy",
        hasApiKey: true,
        targetBaseUrl: "https://api.example.com/v1"
      })
    }));

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        apiKey: "browser-key"
      },
      fetcher
    );

    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:18787/health", {
      method: "GET",
      headers: {
        Authorization: "Bearer browser-key"
      }
    });
  });

  it("sends the provider base URL to local proxy diagnostics", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        service: "jujiang-api-proxy",
        hasApiKey: true,
        targetBaseUrl: "https://api.deepseek.com/v1"
      })
    }));

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        providerBaseUrl: "https://api.deepseek.com",
        apiKey: "browser-key"
      },
      fetcher
    );

    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:18787/health", {
      method: "GET",
      headers: {
        Authorization: "Bearer browser-key",
        "X-Jujiang-Target-Base-Url": "https://api.deepseek.com"
      }
    });
  });

  it("points fetch failures back to the app service", () => {
    expect(classifyFetchFailure(new TypeError("Failed to fetch"), "https://api.openai.com/v1")).toBe(
      "AI 请求没有到达应用服务：请用 npm run dev:app 启动完整应用后再生成。"
    );
  });

  it("treats provider stage diagnostics as actionable messages", () => {
    expect(
      isActionableConnectionMessage(
        "screenplay_generate 阶段请求超时：HTTP 504。可重试。Provider 返回：Gateway Timeout"
      )
    ).toBe(true);
    expect(
      isActionableConnectionMessage(
        "上游 AI provider 请求超时：http://127.0.0.1:19000/v1。等待 1s 后仍未返回，可重试。"
      )
    ).toBe(true);
  });
});
