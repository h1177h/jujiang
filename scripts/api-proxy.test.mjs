import { describe, expect, it } from "vitest";
import { getProxyConfig, normalizeTargetBaseUrl } from "./api-proxy.mjs";

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

  it("reads HTTPS proxy settings for Node upstream requests", () => {
    const config = getProxyConfig({
      JUJIANG_API_KEY: "key",
      HTTPS_PROXY: "http://127.0.0.1:7897",
      HTTP_PROXY: "http://127.0.0.1:7898"
    });

    expect(config.networkProxyUrl).toBe("http://127.0.0.1:7897");
  });
});
