export type YamlPresentationTone = "idle" | "ok" | "error";

export interface YamlPresentationState {
  tone: YamlPresentationTone;
  label: string;
  title: string;
  message: string;
}

export function getYamlPresentationState(
  yamlText: string,
  validation: { ok: boolean; errors: string[] }
): YamlPresentationState {
  if (!yamlText.trim()) {
    return {
      tone: "idle",
      label: "YAML 等待生成",
      title: "等待生成 YAML",
      message: "粘贴小说并调用 AI 后，这里会显示可校验、可复制和可下载的结构化剧本 YAML。"
    };
  }

  if (validation.ok) {
    return {
      tone: "ok",
      label: "YAML 校验通过",
      title: "Schema 校验通过",
      message: "当前 YAML 可复制、下载和继续改写。"
    };
  }

  return {
    tone: "error",
    label: "YAML 待修正",
    title: "Schema 校验失败",
    message: validation.errors.slice(0, 3).join("；")
  };
}
