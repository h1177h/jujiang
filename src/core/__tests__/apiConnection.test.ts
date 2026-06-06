import { describe, expect, it, vi } from "vitest";
import {
  classifyFetchFailure,
  deriveProxyHealthUrl,
  diagnoseAiConnection
} from "../apiConnection";

describe("AI connection diagnostics", () => {
  it("derives local proxy health URL from v1 base URL", () => {
    expect(deriveProxyHealthUrl("http://127.0.0.1:8787/v1")).toBe("http://127.0.0.1:8787/health");
    expect(deriveProxyHealthUrl("http://localhost:8787/v1/")).toBe("http://localhost:8787/health");
  });

  it("reports local proxy not reachable before generation", async () => {
    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:8787/v1",
        useLocalProxy: true
      },
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    expect(result).toEqual({
      ok: false,
      message: "本地 proxy 未连接：请先运行 npm run proxy，并确认 http://127.0.0.1:8787/health 可访问。"
    });
  });

  it("reports local proxy missing API key", async () => {
    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:8787/v1",
        useLocalProxy: true
      },
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, hasApiKey: false })
      }))
    );

    expect(result).toEqual({
      ok: false,
      message: "本地 proxy 没有读到 API Key：请在页面填写 API Key，或设置 JUJIANG_API_KEY / OPENAI_API_KEY 后重启 npm run proxy。"
    });
  });

  it("sends the browser-provided API key to local proxy diagnostics", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, hasApiKey: true, targetBaseUrl: "https://api.example.com/v1" })
    }));

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:8787/v1",
        useLocalProxy: true,
        apiKey: "browser-key"
      },
      fetcher
    );

    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8787/health", {
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
