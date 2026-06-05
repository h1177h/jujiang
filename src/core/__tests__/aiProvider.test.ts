import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { generateScreenplayWithApi, normalizeBaseUrl } from "../aiProvider";
import { sampleNovel } from "../sampleNovel";
import { validateScreenplay } from "../schema";
import sampleOutputYaml from "../../../examples/sample-output.yaml?raw";

describe("AI provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes OpenAI-compatible base URLs", () => {
    expect(normalizeBaseUrl("https://api.example.com")).toBe("https://api.example.com/v1");
    expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
  });

  it("calls a chat completions endpoint and validates the returned screenplay", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;
    const screenplay = validation.data;

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
