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

  it("rejects a blank selected model before checking the provider", async () => {
    const fetcher = vi.fn();

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        providerBaseUrl: "https://api.example.com",
        apiKey: "browser-key",
        model: "   "
      },
      fetcher
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: "请先填写 Model，再测试连接。"
    });
  });

  it("rejects a blank provider base URL before reaching the proxy", async () => {
    const fetcher = vi.fn();

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        providerBaseUrl: "   ",
        apiKey: "browser-key",
        model: "test-model"
      },
      fetcher
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: "请先填写 Provider Base URL，再测试连接。"
    });
  });

  it("rejects malformed provider base URLs before reaching the proxy", async () => {
    const fetcher = vi.fn();

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        providerBaseUrl: "not-a-url",
        apiKey: "browser-key",
        model: "test-model"
      },
      fetcher
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: "Provider Base URL 必须以 http:// 或 https:// 开头。"
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

  it("probes the selected upstream provider model after local proxy health succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          service: "jujiang-api-proxy",
          hasApiKey: true,
          targetBaseUrl: "https://api.deepseek.com/v1"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "{\"ok\":true}" } }]
        })
      });

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        providerBaseUrl: "https://api.deepseek.com",
        apiKey: "browser-key",
        model: "deepseek-chat"
      },
      fetcher
    );

    expect(result).toEqual({
      ok: true,
      message: "AI provider 已连接：https://api.deepseek.com/v1 · deepseek-chat"
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("http://127.0.0.1:18787/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-key",
        "X-Jujiang-Target-Base-Url": "https://api.deepseek.com"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0,
        max_tokens: 8,
        messages: [
          {
            role: "user",
            content: "Return only {\"ok\":true}."
          }
        ]
      })
    });
  });

  it("reports provider probe failures with HTTP status and raw provider message", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          service: "jujiang-api-proxy",
          hasApiKey: true,
          targetBaseUrl: "https://api.example.com/v1"
        })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            message: "invalid api key"
          }
        })
      });

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        providerBaseUrl: "https://api.example.com",
        apiKey: "bad-key",
        model: "test-model"
      },
      fetcher
    );

    expect(result).toEqual({
      ok: false,
      message: "AI provider 连接检查失败：HTTP 401。Provider 返回：invalid api key"
    });
  });

  it("rejects successful provider probes that return no chat text", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          service: "jujiang-api-proxy",
          hasApiKey: true,
          targetBaseUrl: "https://api.example.com/v1"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              finish_reason: "length",
              message: {
                content: ""
              }
            }
          ]
        })
      });

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        providerBaseUrl: "https://api.example.com",
        apiKey: "browser-key",
        model: "test-model"
      },
      fetcher
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("AI provider 连接检查失败");
    expect(result.message).toContain("返回空内容");
    expect(result.message).toContain("finish_reason=length");
  });

  it("reports provider probe tool calls instead of generic empty content", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          service: "jujiang-api-proxy",
          hasApiKey: true,
          targetBaseUrl: "https://api.example.com/v1"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    type: "function",
                    function: {
                      name: "make_screenplay",
                      arguments: "{\"title\":\"Mist Harbor\"}"
                    }
                  }
                ]
              }
            }
          ]
        })
      });

    const result = await diagnoseAiConnection(
      {
        baseUrl: "http://127.0.0.1:18787/v1",
        useLocalProxy: true,
        providerBaseUrl: "https://api.example.com",
        apiKey: "browser-key",
        model: "test-model"
      },
      fetcher
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("AI provider 连接检查失败");
    expect(result.message).toContain("工具调用");
    expect(result.message).toContain("tool_calls");
    expect(result.message).toContain("make_screenplay");
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
