import { describe, expect, it, vi } from "vitest";
import {
  classifyFetchFailure,
  deriveProxyHealthUrl,
  diagnoseAiConnection,
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
      message: "本地 proxy 未连接：请先运行 npm run proxy，并确认 http://127.0.0.1:18787/health 可访问。"
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
      message: "本地 proxy 没有读到 API Key：请在页面填写 API Key，或设置 JUJIANG_API_KEY / OPENAI_API_KEY 后重启 npm run proxy。"
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
      message: "本地 proxy 端口返回的不是剧匠 proxy：请关闭占用端口的其他服务，或用 JUJIANG_PROXY_PORT 启动剧匠 proxy 并同步页面 Base URL。"
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

  it("keeps direct mode explicit when browser fetch is blocked", () => {
    expect(classifyFetchFailure(new TypeError("Failed to fetch"), "https://api.openai.com/v1")).toBe(
      "浏览器直连失败：这通常是 CORS、系统代理或网络拦截导致。请勾选“本地 proxy”，运行 npm run proxy 后再生成。"
    );
  });
});
