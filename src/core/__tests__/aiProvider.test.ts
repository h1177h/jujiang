import { afterEach, describe, expect, it, vi } from "vitest";
import { generateScreenplayWithApi, normalizeBaseUrl } from "../aiProvider";
import { generateScreenplayYamlModel } from "../generator";
import { sampleNovel } from "../sampleNovel";

describe("AI provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes OpenAI-compatible base URLs", () => {
    expect(normalizeBaseUrl("https://api.example.com")).toBe("https://api.example.com/v1");
    expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
  });

  it("calls a chat completions endpoint and validates the returned screenplay", async () => {
    const screenplay = generateScreenplayYamlModel(sampleNovel, {
      title: "雾港来信",
      style: "cinematic"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(screenplay)
              }
            }
          ]
        })
      }))
    );

    const result = await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "雾港来信",
        style: "cinematic",
        novelText: sampleNovel
      }
    );

    expect(result.scenes).toHaveLength(6);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        })
      })
    );
  });
});
