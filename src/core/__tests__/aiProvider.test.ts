import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { generateScreenplayWithApi, normalizeBaseUrl, regenerateSceneWithApi } from "../aiProvider";
import { sampleNovel } from "../sampleNovel";
import { validateScreenplay } from "../schema";
import type { StoryBlueprint } from "../types";
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
        providerBaseUrl: "https://api.deepseek.com",
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
          Authorization: "Bearer test-key",
          "X-Jujiang-Target-Base-Url": "https://api.deepseek.com"
        })
      })
    );
  });

  it("extracts a story blueprint before asking for final screenplay YAML", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chapterEvents: validation.data.chapterEvents,
                  storyBible: validation.data.storyBible,
                  adaptationStrategy: validation.data.adaptationStrategy
                })
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(validation.data)
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

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

    expect(result.chapterEvents).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const firstPayload = JSON.parse(firstBody.messages[1].content);
    expect(firstPayload.pipelineStage).toBe("event_extract");
    expect(firstPayload.sourceChapters).toHaveLength(3);

    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    const secondPayload = JSON.parse(secondBody.messages[1].content);
    expect(secondPayload.pipelineStage).toBe("screenplay_generate");
    expect(secondPayload.storyBlueprint.chapterEvents[0].events[0].id).toBe("event-01-01");
  });

  it("reads OpenAI-compatible content parts as chat completion text", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const blueprint = {
      chapterEvents: validation.data.chapterEvents,
      storyBible: validation.data.storyBible,
      adaptationStrategy: validation.data.adaptationStrategy
    };
    const screenplayJson = JSON.stringify(validation.data);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(blueprint)
                  }
                ]
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: [
                  {
                    type: "text",
                    text: screenplayJson.slice(0, 80)
                  },
                  {
                    type: "text",
                    text: screenplayJson.slice(80)
                  }
                ]
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the staged story blueprint when the final screenplay response drifts", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const stagedBlueprint = {
      chapterEvents: validation.data.chapterEvents,
      storyBible: validation.data.storyBible,
      adaptationStrategy: validation.data.adaptationStrategy
    };
    const driftedChapterEvents = validation.data.chapterEvents.map((group) => ({
      ...group,
      chapterGoal: `drifted ${group.chapterGoal}`,
      events: group.events.map((event) => ({
        ...event,
        id: `drifted-${event.id}`,
        summary: `drifted ${event.summary}`
      }))
    }));
    const driftedStoryBible = {
      ...validation.data.storyBible,
      coreConflict: "drifted final response conflict"
    };
    const driftedAdaptationStrategy = {
      ...validation.data.adaptationStrategy,
      pacing: "drifted final response pacing"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(stagedBlueprint)
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validation.data,
                  chapterEvents: driftedChapterEvents,
                  storyBible: driftedStoryBible,
                  adaptationStrategy: driftedAdaptationStrategy
                })
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "Blueprint Drift Story",
        style: "cinematic",
        novelText: sampleNovel
      }
    );

    expect(result.chapterEvents[0].events[0].id).toBe(validation.data.chapterEvents[0].events[0].id);
    expect(result.storyBible.coreConflict).toBe(validation.data.storyBible.coreConflict);
    expect(result.adaptationStrategy.pacing).toBe(validation.data.adaptationStrategy.pacing);
  });

  it("records stage artifacts when provider stages return usable structured content", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chapterEvents: validation.data.chapterEvents,
                  storyBible: validation.data.storyBible,
                  adaptationStrategy: validation.data.adaptationStrategy
                })
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(validation.data)
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);
    const artifacts: string[] = [];

    await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "雾港来信",
        style: "cinematic",
        novelText: sampleNovel,
        onProgress: (event) => {
          if (event.artifact) artifacts.push(`${event.stage}:${event.artifact.summary}`);
        }
      }
    );

    expect(artifacts).toEqual(
      expect.arrayContaining([
        "event_extract:3 个章节事件组",
        "screenplay_generate:6 场剧本"
      ])
    );
  });

  it("reads OpenAI-compatible SSE chat completion streams as JSON content", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;
    const blueprint = {
      chapterEvents: validation.data.chapterEvents,
      storyBible: validation.data.storyBible,
      adaptationStrategy: validation.data.adaptationStrategy
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "text/event-stream" }),
        json: async () => {
          throw new Error("stream body");
        },
        text: async () =>
          [
            `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(blueprint).slice(0, 40) } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(blueprint).slice(40) } }] })}`,
            "data: [DONE]"
          ].join("\n\n")
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(validation.data)
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

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
  });

  it("preserves provider diagnostics from SSE error events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        json: async () => {
          throw new Error("stream body");
        },
        text: async () =>
          [
            `data: ${JSON.stringify({ error: { message: "quota exceeded" } })}`,
            "data: [DONE]"
          ].join("\n\n")
      }))
    );

    await expect(
      generateScreenplayWithApi(
        {
          baseUrl: "https://api.example.com",
          apiKey: "test-key",
          model: "test-model"
        },
        {
          title: "Mist Harbor",
          style: "cinematic",
          novelText: sampleNovel
        }
      )
    ).rejects.toThrow("event_extract 阶段返回空内容。Provider 返回：quota exceeded");
  });

  it("reports tool calls from SSE streams when no text content is returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        text: async () =>
          [
            `data: ${JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  delta: {
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
            })}`,
            "data: [DONE]"
          ].join("\n\n")
      }))
    );

    let message = "";
    try {
      await generateScreenplayWithApi(
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
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("event_extract");
    expect(message).toContain("工具调用");
    expect(message).toContain("tool_calls");
    expect(message).toContain("make_screenplay");
  });

  it("reports stage, HTTP 504, and retryability when the provider times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 504,
        headers: new Headers({ "content-type": "text/plain" }),
        json: async () => {
          throw new Error("not json");
        },
        text: async () => "Gateway Timeout"
      }))
    );

    await expect(
      generateScreenplayWithApi(
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
      )
    ).rejects.toThrow("event_extract 阶段请求超时：HTTP 504。可重试。Provider 返回：Gateway Timeout");
  });

  it("reports the stage and raw finish reason when the provider returns empty content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
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
      }))
    );

    await expect(
      generateScreenplayWithApi(
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
      )
    ).rejects.toThrow("event_extract 阶段返回空内容。finish_reason=length");
  });

  it("reports tool call responses when the provider returns no chat text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
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
      }))
    );

    let message = "";
    try {
      await generateScreenplayWithApi(
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
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("event_extract");
    expect(message).toContain("工具调用");
    expect(message).toContain("tool_calls");
    expect(message).toContain("make_screenplay");
  });

  it("uses the first non-empty chat completion choice when earlier choices are blank", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const blueprint = {
      chapterEvents: validation.data.chapterEvents,
      storyBible: validation.data.storyBible,
      adaptationStrategy: validation.data.adaptationStrategy
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              finish_reason: "length",
              message: {
                content: ""
              }
            },
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify(blueprint)
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(validation.data)
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports successful non-json provider responses with a raw response excerpt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        json: async () => {
          throw new Error("not json");
        },
        text: async () => "<html><body>Provider login page</body></html>"
      }))
    );

    await expect(
      generateScreenplayWithApi(
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
      )
    ).rejects.toThrow(
      "event_extract 阶段返回了非 JSON 响应。Provider 返回：<html><body>Provider login page</body></html>"
    );
  });

  it("reports the provider content excerpt when a chat message is not parseable JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: "我已经理解故事，会先提炼人物关系，然后再生成剧本。"
              }
            }
          ]
        })
      }))
    );

    await expect(
      generateScreenplayWithApi(
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
      )
    ).rejects.toThrow(
      "event_extract 阶段返回内容不是可解析 JSON。Provider 返回：我已经理解故事，会先提炼人物关系，然后再生成剧本。"
    );
  });

  it("reports the provider JSON excerpt when the story blueprint schema fails", async () => {
    const invalidBlueprint = {
      chapterEvents: []
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(invalidBlueprint)
              }
            }
          ]
        })
      }))
    );

    let errorMessage = "";
    try {
      await generateScreenplayWithApi(
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
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain(
      "event_extract 阶段故事蓝图未通过 Schema：chapterEvents, storyBible, adaptationStrategy。Provider 返回摘要："
    );
    expect(errorMessage).toContain("\"chapterEvents\":[]");
  });

  it("retries without response_format when a compatible provider rejects json mode", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () =>
          JSON.stringify({
            error: {
              message: "response_format is not supported by this model"
            }
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chapterEvents: validation.data.chapterEvents,
                  storyBible: validation.data.storyBible,
                  adaptationStrategy: validation.data.adaptationStrategy
                })
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(validation.data)
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const rejectedBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const retriedBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    const screenplayBody = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body));

    expect(rejectedBody.response_format).toEqual({ type: "json_object" });
    expect(retriedBody.response_format).toBeUndefined();
    expect(screenplayBody.response_format).toEqual({ type: "json_object" });
  });

  it("does not retry unrelated HTTP 400 provider failures without response_format", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () =>
        JSON.stringify({
          error: {
            message: "invalid api key"
          }
        })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateScreenplayWithApi(
        {
          baseUrl: "https://api.example.com",
          apiKey: "bad-key",
          model: "test-model"
        },
        {
          title: "雾港来信",
          style: "cinematic",
          novelText: sampleNovel
        }
      )
    ).rejects.toThrow("event_extract 阶段请求失败：HTTP 400。Provider 返回：invalid api key");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends structured chapter context instead of an undifferentiated novel blob", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(validation.data)
            }
          }
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateScreenplayWithApi(
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

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body?: BodyInit }];
    const requestBody = JSON.parse(String(requestInit.body));
    const userPayload = JSON.parse(requestBody.messages[1].content);

    expect(userPayload.novelText).toBeUndefined();
    expect(userPayload.sourceChapters).toHaveLength(3);
    expect(userPayload.sourceChapters[0]).toEqual(
      expect.objectContaining({
        chapterIndex: 1,
        chapterTitle: "迟到的渡船",
        lineStart: 4
      })
    );
    expect(userPayload.sourceChapters[0].paragraphs[0]).toEqual({
      paragraphIndex: 1,
      text: "夜色压在雾港的石桥上，林砚抱着旧皮箱，听见钟楼敲过十下。"
    });
  });

  it("extracts long novels chapter by chapter before generating the screenplay", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const longNovel = [
      "第一章 起风",
      "林砚发现码头起风。",
      "第二章 账册",
      "沈知夏拿到账册。",
      "第三章 黑伞",
      "黑伞男人跟踪他们。",
      "第四章 钟楼",
      "众人进入钟楼。",
      "第五章 第十一声",
      "第十一声钟即将响起。"
    ].join("\n");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => {
        const callIndex = fetchMock.mock.calls.length;
        if (callIndex <= 5) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    chapterEvents: [validation.data.chapterEvents[Math.min(callIndex - 1, 2)]]
                  })
                }
              }
            ]
          };
        }

        if (callIndex === 6) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    chapterEvents: validation.data.chapterEvents,
                    storyBible: validation.data.storyBible,
                    adaptationStrategy: validation.data.adaptationStrategy
                  })
                }
              }
            ]
          };
        }

        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validation.data,
                  work: {
                    ...validation.data.work,
                    sourceChapterCount: 5
                  }
                })
              }
            }
          ]
        };
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const progress: string[] = [];

    const result = await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "长篇测试",
        style: "cinematic",
        novelText: longNovel,
        onProgress: (event) => progress.push(event.stage)
      }
    );

    expect(result.work.sourceChapterCount).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(progress).toEqual(
      expect.arrayContaining(["chapter_event_extract", "story_bible_generate", "screenplay_generate"])
    );

    const firstBody = JSON.parse(String(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body));
    const firstPayload = JSON.parse(firstBody.messages[1].content);
    expect(firstPayload.pipelineStage).toBe("chapter_event_extract");
    expect(firstPayload.sourceChapter.chapterIndex).toBe(1);
    expect(firstPayload.sourceChapters).toBeUndefined();

    const finalBody = JSON.parse(String(((fetchMock.mock.calls[6] as unknown as [string, RequestInit])[1]).body));
    const finalPayload = JSON.parse(finalBody.messages[1].content);
    expect(finalPayload.pipelineStage).toBe("screenplay_generate");
    expect(finalPayload.sourceChapters).toHaveLength(5);
    expect(finalPayload.sourceChapters[0].paragraphs).toBeUndefined();
  });

  it("resumes long-form generation from saved chapter event checkpoints", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const longNovel = [
      "Chapter 1 The Pier",
      "Lin finds a coded note at the pier.",
      "Chapter 2 The Ledger",
      "Shen discovers the missing ledger.",
      "Chapter 3 The Tail",
      "A stranger follows them through the market.",
      "Chapter 4 The Bell Tower",
      "They hide evidence inside the bell tower.",
      "Chapter 5 The Eleventh Bell",
      "The eleventh bell exposes the traitor."
    ].join("\n");
    const savedChapterEvents = Array.from({ length: 5 }, (_, index) => {
      const source = validation.data.chapterEvents[index % validation.data.chapterEvents.length];
      return {
        ...source,
        chapterIndex: index + 1,
        chapterTitle: `Chapter ${index + 1}`,
        chapterGoal: `Recover checkpoint ${index + 1}`,
        events: source.events.map((event, eventIndex) => ({
          ...event,
          id: `resume-${index + 1}-${eventIndex + 1}`,
          source: {
            ...event.source,
            chapterIndex: index + 1,
            chapterTitle: `Chapter ${index + 1}`,
            excerpt: `Checkpoint excerpt ${index + 1}`
          }
        }))
      };
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => {
        const callIndex = fetchMock.mock.calls.length;
        if (callIndex === 1) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    chapterEvents: savedChapterEvents,
                    storyBible: storyBibleAnchoredToEvents(validation.data.storyBible, savedChapterEvents),
                    adaptationStrategy: validation.data.adaptationStrategy
                  })
                }
              }
            ]
          };
        }

        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validation.data,
                  work: {
                    ...validation.data.work,
                    sourceChapterCount: 5
                  },
                  chapterEvents: savedChapterEvents
                })
              }
            }
          ]
        };
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const progress: string[] = [];

    const result = await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "Checkpoint Story",
        style: "cinematic",
        novelText: longNovel,
        resumeFrom: {
          chapterEvents: savedChapterEvents
        },
        onProgress: (event) => progress.push(event.stage)
      }
    );

    expect(result.work.sourceChapterCount).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress).not.toContain("chapter_event_extract");
    expect(progress).toEqual(expect.arrayContaining(["story_bible_generate", "screenplay_generate"]));

    const firstBody = JSON.parse(String(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body));
    const firstPayload = JSON.parse(firstBody.messages[1].content);
    expect(firstPayload.pipelineStage).toBe("story_bible_generate");
    expect(firstPayload.chapterEvents).toHaveLength(5);
  });

  it("filters stale story blueprint checkpoints before resuming screenplay generation", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const longNovel = [
      "Chapter 1 The Pier",
      "Lin finds a coded note at the pier.",
      "Chapter 2 The Ledger",
      "Shen discovers the missing ledger.",
      "Chapter 3 The Tail",
      "A stranger follows them through the market.",
      "Chapter 4 The Bell Tower",
      "They hide evidence inside the bell tower.",
      "Chapter 5 The Eleventh Bell",
      "The eleventh bell exposes the traitor."
    ].join("\n");
    const makeChapterEvent = (chapterIndex: number) => {
      const source = validation.data.chapterEvents[(chapterIndex - 1) % validation.data.chapterEvents.length];
      return {
        ...source,
        chapterIndex,
        chapterTitle: `Chapter ${chapterIndex}`,
        chapterGoal: `Resume chapter ${chapterIndex}`,
        events: source.events.map((event, eventIndex) => ({
          ...event,
          id: `blueprint-${chapterIndex}-${eventIndex + 1}`,
          source: {
            ...event.source,
            chapterIndex,
            chapterTitle: `Chapter ${chapterIndex}`,
            excerpt: `Blueprint excerpt ${chapterIndex}`
          }
        }))
      };
    };
    const savedChapterEvents = Array.from({ length: 5 }, (_, index) => makeChapterEvent(index + 1));
    const savedStoryBlueprint = {
      chapterEvents: [...savedChapterEvents, makeChapterEvent(9)],
      storyBible: storyBibleAnchoredToEvents(validation.data.storyBible, savedChapterEvents),
      adaptationStrategy: validation.data.adaptationStrategy
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ...validation.data,
                work: {
                  ...validation.data.work,
                  sourceChapterCount: 5
                },
                chapterEvents: savedChapterEvents
              })
            }
          }
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "Blueprint Checkpoint Story",
        style: "cinematic",
        novelText: longNovel,
        resumeFrom: {
          storyBlueprint: savedStoryBlueprint
        }
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body));
    const payload = JSON.parse(body.messages[1].content);
    expect(payload.pipelineStage).toBe("screenplay_generate");
    expect(payload.storyBlueprint.chapterEvents.map((group: { chapterIndex: number }) => group.chapterIndex)).toEqual([
      1,
      2,
      3,
      4,
      5
    ]);
  });

  it("continues missing long-form chapters from partial event checkpoints", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const longNovel = [
      "Chapter 1 The Pier",
      "Lin finds a coded note at the pier.",
      "Chapter 2 The Ledger",
      "Shen discovers the missing ledger.",
      "Chapter 3 The Tail",
      "A stranger follows them through the market.",
      "Chapter 4 The Bell Tower",
      "They hide evidence inside the bell tower.",
      "Chapter 5 The Eleventh Bell",
      "The eleventh bell exposes the traitor."
    ].join("\n");
    const savedChapterEvents = validation.data.chapterEvents.slice(0, 3);
    const makeChapterEvents = (chapterIndex: number) => {
      const source = validation.data.chapterEvents[(chapterIndex - 1) % validation.data.chapterEvents.length];
      return [
        {
          ...source,
          chapterIndex,
          chapterTitle: `Chapter ${chapterIndex}`,
          chapterGoal: `Extract chapter ${chapterIndex}`,
          events: source.events.map((event, eventIndex) => ({
            ...event,
            id: `continued-${chapterIndex}-${eventIndex + 1}`,
            source: {
              ...event.source,
              chapterIndex,
              chapterTitle: `Chapter ${chapterIndex}`,
              excerpt: `Continued excerpt ${chapterIndex}`
            }
          }))
        }
      ];
    };
    const completedChapterEvents = [...savedChapterEvents, ...makeChapterEvents(4), ...makeChapterEvents(5)];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => {
        const callIndex = fetchMock.mock.calls.length;
        if (callIndex === 1) {
          return { choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(4) }) } }] };
        }
        if (callIndex === 2) {
          return { choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(5) }) } }] };
        }
        if (callIndex === 3) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    chapterEvents: completedChapterEvents,
                    storyBible: storyBibleAnchoredToEvents(validation.data.storyBible, completedChapterEvents),
                    adaptationStrategy: validation.data.adaptationStrategy
                  })
                }
              }
            ]
          };
        }

        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validation.data,
                  work: {
                    ...validation.data.work,
                    sourceChapterCount: 5
                  },
                  chapterEvents: completedChapterEvents
                })
              }
            }
          ]
        };
      }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "Partial Checkpoint Story",
        style: "cinematic",
        novelText: longNovel,
        resumeFrom: {
          chapterEvents: savedChapterEvents
        }
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const firstBody = JSON.parse(String(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body));
    const firstPayload = JSON.parse(firstBody.messages[1].content);
    expect(firstPayload.pipelineStage).toBe("chapter_event_extract");
    expect(firstPayload.sourceChapter.chapterIndex).toBe(4);

    const mergeBody = JSON.parse(String(((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1]).body));
    const mergePayload = JSON.parse(mergeBody.messages[1].content);
    expect(mergePayload.pipelineStage).toBe("story_bible_generate");
    expect(mergePayload.chapterEvents).toHaveLength(5);
  });

  it("filters stale partial resume checkpoints before continuing long-form generation", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const longNovel = [
      "Chapter 1 The Pier",
      "Lin finds a coded note at the pier.",
      "Chapter 2 The Ledger",
      "Shen discovers the missing ledger.",
      "Chapter 3 The Tail",
      "A stranger follows them through the market.",
      "Chapter 4 The Bell Tower",
      "They hide evidence inside the bell tower.",
      "Chapter 5 The Eleventh Bell",
      "The eleventh bell exposes the traitor."
    ].join("\n");
    const makeChapterEvents = (chapterIndex: number) => {
      const source = validation.data.chapterEvents[(chapterIndex - 1) % validation.data.chapterEvents.length];
      return [
        {
          ...source,
          chapterIndex,
          chapterTitle: `Chapter ${chapterIndex}`,
          chapterGoal: `Extract chapter ${chapterIndex}`,
          events: source.events.map((event, eventIndex) => ({
            ...event,
            id: `filtered-${chapterIndex}-${eventIndex + 1}`,
            source: {
              ...event.source,
              chapterIndex,
              chapterTitle: `Chapter ${chapterIndex}`,
              excerpt: `Filtered excerpt ${chapterIndex}`
            }
          }))
        }
      ];
    };
    const savedChapterEvents = [...makeChapterEvents(2), ...makeChapterEvents(9)];
    const completedChapterEvents = [
      ...makeChapterEvents(2),
      ...makeChapterEvents(1),
      ...makeChapterEvents(3),
      ...makeChapterEvents(4),
      ...makeChapterEvents(5)
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => {
        const callIndex = fetchMock.mock.calls.length;
        if (callIndex === 1) {
          return { choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(1) }) } }] };
        }
        if (callIndex === 2) {
          return { choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(3) }) } }] };
        }
        if (callIndex === 3) {
          return { choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(4) }) } }] };
        }
        if (callIndex === 4) {
          return { choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(5) }) } }] };
        }
        if (callIndex === 5) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    chapterEvents: completedChapterEvents,
                    storyBible: storyBibleAnchoredToEvents(validation.data.storyBible, completedChapterEvents),
                    adaptationStrategy: validation.data.adaptationStrategy
                  })
                }
              }
            ]
          };
        }

        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validation.data,
                  work: {
                    ...validation.data.work,
                    sourceChapterCount: 5
                  },
                  chapterEvents: completedChapterEvents
                })
              }
            }
          ]
        };
      }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "Stale Checkpoint Story",
        style: "cinematic",
        novelText: longNovel,
        resumeFrom: {
          chapterEvents: savedChapterEvents
        }
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const firstBody = JSON.parse(String(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body));
    const firstPayload = JSON.parse(firstBody.messages[1].content);
    expect(firstPayload.pipelineStage).toBe("chapter_event_extract");
    expect(firstPayload.sourceChapter.chapterIndex).toBe(1);

    const mergeBody = JSON.parse(String(((fetchMock.mock.calls[4] as unknown as [string, RequestInit])[1]).body));
    const mergePayload = JSON.parse(mergeBody.messages[1].content);
    expect(mergePayload.pipelineStage).toBe("story_bible_generate");
    expect(mergePayload.chapterEvents.map((group: { chapterIndex: number }) => group.chapterIndex)).toEqual([
      1,
      2,
      3,
      4,
      5
    ]);
  });

  it("deduplicates partial resume checkpoints before continuing long-form generation", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const longNovel = [
      "Chapter 1 The Pier",
      "Lin finds a coded note at the pier.",
      "Chapter 2 The Ledger",
      "Shen discovers the missing ledger.",
      "Chapter 3 The Tail",
      "A stranger follows them through the market.",
      "Chapter 4 The Bell Tower",
      "They hide evidence inside the bell tower.",
      "Chapter 5 The Eleventh Bell",
      "The eleventh bell exposes the traitor."
    ].join("\n");
    const makeChapterEvents = (chapterIndex: number, version: string) => {
      const source = validation.data.chapterEvents[(chapterIndex - 1) % validation.data.chapterEvents.length];
      return [
        {
          ...source,
          chapterIndex,
          chapterTitle: `Chapter ${chapterIndex}`,
          chapterGoal: `${version} checkpoint chapter ${chapterIndex}`,
          events: source.events.map((event, eventIndex) => ({
            ...event,
            id: `${version}-${chapterIndex}-${eventIndex + 1}`,
            source: {
              ...event.source,
              chapterIndex,
              chapterTitle: `Chapter ${chapterIndex}`,
              excerpt: `${version} excerpt ${chapterIndex}`
            }
          }))
        }
      ];
    };
    const savedChapterEvents = [
      ...makeChapterEvents(2, "old"),
      ...makeChapterEvents(2, "latest"),
      ...makeChapterEvents(4, "saved")
    ];
    const completedChapterEvents = [
      ...makeChapterEvents(1, "generated"),
      ...makeChapterEvents(2, "latest"),
      ...makeChapterEvents(3, "generated"),
      ...makeChapterEvents(4, "saved"),
      ...makeChapterEvents(5, "generated")
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => {
        const callIndex = fetchMock.mock.calls.length;
        if (callIndex === 1) {
          return {
            choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(1, "generated") }) } }]
          };
        }
        if (callIndex === 2) {
          return {
            choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(3, "generated") }) } }]
          };
        }
        if (callIndex === 3) {
          return {
            choices: [{ message: { content: JSON.stringify({ chapterEvents: makeChapterEvents(5, "generated") }) } }]
          };
        }
        if (callIndex === 4) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    chapterEvents: completedChapterEvents,
                    storyBible: storyBibleAnchoredToEvents(validation.data.storyBible, completedChapterEvents),
                    adaptationStrategy: validation.data.adaptationStrategy
                  })
                }
              }
            ]
          };
        }

        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validation.data,
                  work: {
                    ...validation.data.work,
                    sourceChapterCount: 5
                  },
                  chapterEvents: completedChapterEvents
                })
              }
            }
          ]
        };
      }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "Duplicate Checkpoint Story",
        style: "cinematic",
        novelText: longNovel,
        resumeFrom: {
          chapterEvents: savedChapterEvents
        }
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const mergeBody = JSON.parse(String(((fetchMock.mock.calls[3] as unknown as [string, RequestInit])[1]).body));
    const mergePayload = JSON.parse(mergeBody.messages[1].content);
    expect(mergePayload.pipelineStage).toBe("story_bible_generate");
    expect(mergePayload.chapterEvents.map((group: { chapterIndex: number }) => group.chapterIndex)).toEqual([
      1,
      2,
      3,
      4,
      5
    ]);
    expect(
      mergePayload.chapterEvents.find((group: { chapterIndex: number }) => group.chapterIndex === 2).events[0].id
    ).toBe("latest-2-1");
  });

  it("reports the provider JSON excerpt when a chapter event schema fails", async () => {
    const longNovel = [
      "第一章 起风",
      "林砚发现码头起风。",
      "第二章 账册",
      "沈知夏拿到账册。",
      "第三章 黑伞",
      "黑伞男人跟踪他们。",
      "第四章 钟楼",
      "众人进入钟楼。"
    ].join("\n");
    const invalidChapterEvents = {
      chapterEvents: [
        {
          chapterIndex: 1,
          chapterTitle: "起风"
        }
      ]
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(invalidChapterEvents)
              }
            }
          ]
        })
      }))
    );

    let errorMessage = "";
    try {
      await generateScreenplayWithApi(
        {
          baseUrl: "https://api.example.com",
          apiKey: "test-key",
          model: "test-model"
        },
        {
          title: "长篇测试",
          style: "cinematic",
          novelText: longNovel
        }
      );
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain(
      "chapter_event_extract 阶段章节事件未通过 Schema：0.chapterGoal, 0.events。Provider 返回摘要："
    );
    expect(errorMessage).toContain("\"chapterTitle\":\"起风\"");
  });

  it("asks the model to repair screenplay JSON when schema validation fails", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const invalidScreenplay = {
      ...validation.data,
      scenes: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chapterEvents: validation.data.chapterEvents,
                  storyBible: validation.data.storyBible,
                  adaptationStrategy: validation.data.adaptationStrategy
                })
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(invalidScreenplay)
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(validation.data)
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);
    const repairArtifacts: unknown[] = [];

    const result = await generateScreenplayWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        title: "雾港来信",
        style: "cinematic",
        novelText: sampleNovel,
        onProgress: (event) => {
          if (event.stage === "schema_repair" && event.artifact) {
            repairArtifacts.push(event.artifact);
          }
        }
      }
    );

    expect(result.scenes).toHaveLength(6);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const repairBody = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body));
    const repairPayload = JSON.parse(repairBody.messages[1].content);
    expect(repairPayload.pipelineStage).toBe("schema_repair");
    expect(repairPayload.validationIssues.join("\n")).toContain("scenes");
    expect(repairArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repair",
          diagnostic: expect.objectContaining({
            initialIssues: expect.arrayContaining(["scenes"]),
            repairedIssues: [],
            initialExcerpt: expect.stringContaining("\"scenes\":[]"),
            repairedExcerpt: expect.stringContaining("\"scenes\"")
          })
        })
      ])
    );
  });

  it("saves initial schema diagnostics before a repair request fails", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const invalidScreenplay = {
      ...validation.data,
      scenes: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chapterEvents: validation.data.chapterEvents,
                  storyBible: validation.data.storyBible,
                  adaptationStrategy: validation.data.adaptationStrategy
                })
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(invalidScreenplay)
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "Gateway Timeout"
      });
    vi.stubGlobal("fetch", fetchMock);
    const repairArtifacts: unknown[] = [];

    await expect(
      generateScreenplayWithApi(
        {
          baseUrl: "https://api.example.com",
          apiKey: "test-key",
          model: "test-model"
        },
        {
          title: "雾港来信",
          style: "cinematic",
          novelText: sampleNovel,
          onProgress: (event) => {
            if (event.stage === "schema_repair" && event.artifact) {
              repairArtifacts.push(event.artifact);
            }
          }
        }
      )
    ).rejects.toThrow("schema_repair 阶段请求超时：HTTP 504。可重试。Provider 返回：Gateway Timeout");

    expect(repairArtifacts).toEqual([
      expect.objectContaining({
        kind: "repair",
        summary: "结构初稿未通过 Schema",
        diagnostic: expect.objectContaining({
          initialIssues: expect.arrayContaining(["scenes"]),
          initialExcerpt: expect.stringContaining("\"scenes\":[]")
        })
      }),
      expect.objectContaining({
        kind: "repair",
        summary: "结构修复请求失败",
        diagnostic: expect.objectContaining({
          initialIssues: expect.arrayContaining(["scenes"]),
          initialExcerpt: expect.stringContaining("\"scenes\":[]"),
          repairedExcerpt: expect.stringContaining("Gateway Timeout")
        })
      })
    ]);
  });

  it("saves repaired response excerpts when schema repair returns non-json text", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const invalidScreenplay = {
      ...validation.data,
      scenes: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chapterEvents: validation.data.chapterEvents,
                  storyBible: validation.data.storyBible,
                  adaptationStrategy: validation.data.adaptationStrategy
                })
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(invalidScreenplay)
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "我先说明一下修复思路：场景不能为空，需要补齐 scenes。"
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);
    const repairArtifacts: unknown[] = [];

    let errorMessage = "";
    try {
      await generateScreenplayWithApi(
        {
          baseUrl: "https://api.example.com",
          apiKey: "test-key",
          model: "test-model"
        },
        {
          title: "雾港来信",
          style: "cinematic",
          novelText: sampleNovel,
          onProgress: (event) => {
            if (event.stage === "schema_repair" && event.artifact) {
              repairArtifacts.push(event.artifact);
            }
          }
        }
      );
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain("schema_repair");
    expect(errorMessage).toContain("不是可解析 JSON");
    expect(repairArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repair",
          summary: "结构修复返回不可解析 JSON",
          diagnostic: expect.objectContaining({
            initialIssues: expect.arrayContaining(["scenes"]),
            initialExcerpt: expect.stringContaining("\"scenes\":[]"),
            repairedExcerpt: expect.stringContaining("我先说明一下修复思路")
          })
        })
      ])
    );
  });

  it("reports original and repaired JSON excerpts when schema repair still fails", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const invalidScreenplay = {
      ...validation.data,
      scenes: []
    };
    const invalidRepair = {
      ...validation.data,
      scenes: [],
      validationHints: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chapterEvents: validation.data.chapterEvents,
                  storyBible: validation.data.storyBible,
                  adaptationStrategy: validation.data.adaptationStrategy
                })
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(invalidScreenplay)
              }
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(invalidRepair)
              }
            }
          ]
        })
      });
    vi.stubGlobal("fetch", fetchMock);
    const repairArtifacts: unknown[] = [];

    let errorMessage = "";
    try {
      await generateScreenplayWithApi(
        {
          baseUrl: "https://api.example.com",
          apiKey: "test-key",
          model: "test-model"
        },
        {
          title: "雾港来信",
          style: "cinematic",
          novelText: sampleNovel,
          onProgress: (event) => {
            if (event.stage === "schema_repair" && event.artifact) {
              repairArtifacts.push(event.artifact);
            }
          }
        }
      );
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(errorMessage).toContain("API 返回结构修复后仍未通过 Schema");
    expect(errorMessage).toContain("scenes");
    expect(errorMessage).toContain("chapterMappings.0.sceneIds.0");
    expect(errorMessage).toContain("storyDiagnostics.strongestConflictSceneId");
    expect(errorMessage).toContain("修复返回摘要：");
    expect(errorMessage).toContain("\"scenes\":[]");
    expect(repairArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repair",
          diagnostic: expect.objectContaining({
            initialIssues: expect.arrayContaining([
              "scenes",
              "chapterMappings.0.sceneIds.0",
              "storyDiagnostics.strongestConflictSceneId"
            ]),
            repairedIssues: expect.arrayContaining([
              "scenes",
              "chapterMappings.0.sceneIds.0",
              "storyDiagnostics.strongestConflictSceneId"
            ]),
            initialExcerpt: expect.stringContaining("\"scenes\":[]"),
            repairedExcerpt: expect.stringContaining("\"scenes\":[]")
          })
        })
      ])
    );
  });

  it("regenerates a single scene without rerunning the whole screenplay pipeline", async () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;
    const sourceScene = validation.data.scenes[0];
    const revisedScene = {
      ...sourceScene,
      goal: "补强林砚和沈知夏之间的试探，让场尾留下更强追问。",
      conflict: {
        level: 5,
        reason: "主角直接逼问来信来源，关系压力和外部危险同时抬升。"
      },
      revisionNotes: ["已补强冲突", "保留原文来源"]
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ scene: revisedScene })
            }
          }
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await regenerateSceneWithApi(
      {
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "test-model"
      },
      {
        screenplay: validation.data,
        sceneId: sourceScene.id,
        instruction: "强化本场冲突和对白"
      }
    );

    expect(result.goal).toContain("试探");
    expect(result.conflict.level).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestBody = JSON.parse(String(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).body));
    const payload = JSON.parse(requestBody.messages[1].content);
    expect(payload.pipelineStage).toBe("scene_regenerate");
    expect(payload.scene.id).toBe(sourceScene.id);
    expect(payload.screenplay).toBeUndefined();
  });
});

function storyBibleAnchoredToEvents(
  storyBible: StoryBlueprint["storyBible"],
  chapterEvents: StoryBlueprint["chapterEvents"]
): StoryBlueprint["storyBible"] {
  const eventIds = chapterEvents.flatMap((group) => group.events.map((event) => event.id));
  return {
    ...storyBible,
    characterArcs: storyBible.characterArcs.map((arc, index) => ({
      ...arc,
      firstEventId: eventIds[index % eventIds.length] ?? arc.firstEventId,
      lastEventId: eventIds[eventIds.length - 1 - (index % eventIds.length)] ?? arc.lastEventId
    }))
  };
}
