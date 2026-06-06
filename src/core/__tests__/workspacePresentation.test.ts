import { describe, expect, it } from "vitest";
import { getYamlPresentationState } from "../workspacePresentation";

describe("workspace presentation state", () => {
  it("treats an empty YAML editor as idle instead of invalid", () => {
    expect(getYamlPresentationState("", { ok: false, errors: ["Required"] })).toEqual({
      tone: "idle",
      label: "YAML 等待生成",
      title: "等待生成 YAML",
      message: "粘贴小说并调用 AI 后，这里会显示可校验、可复制和可下载的结构化剧本 YAML。"
    });
  });

  it("uses schema status once YAML content exists", () => {
    expect(getYamlPresentationState("work:\n  title: 测试\n", { ok: true, errors: [] })).toEqual(
      expect.objectContaining({
        tone: "ok",
        label: "YAML 校验通过",
        title: "Schema 校验通过"
      })
    );
  });
});
