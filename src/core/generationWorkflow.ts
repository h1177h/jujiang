import type { AdaptationStyle, ScreenplayYaml } from "./types";
import { normalizeNovelText } from "./chapters";

export interface WorkspaceGenerationRequest {
  title: string;
  style: AdaptationStyle;
  novelText: string;
  useApi: boolean;
  apiReady: boolean;
  model: string;
}

export type WorkspaceGenerationSource = "api" | "error";

export interface WorkspaceGenerationResult {
  source: WorkspaceGenerationSource;
  status: string;
  screenplay: ScreenplayYaml | null;
}

export async function generateWorkspaceDraft(
  request: WorkspaceGenerationRequest,
  apiGenerator: () => Promise<ScreenplayYaml>
): Promise<WorkspaceGenerationResult> {
  if (!normalizeNovelText(request.novelText)) {
      return {
        source: "error",
        status: "请先输入小说正文，再调用 AI 生成剧本。",
        screenplay: null
      };
  }

  if (request.useApi && request.apiReady) {
    try {
      const screenplay = await apiGenerator();
      return {
        source: "api",
        status: `AI 草稿生成完成：${request.model}`,
        screenplay
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "API 请求失败";
      return {
        source: "error",
        status: `AI 生成失败：${message}。请检查 API key、代理或稍后重试。`,
        screenplay: null
      };
    }
  }

  return {
    source: "error",
    status: "请先配置 AI 生成。剧匠不会用本地规则伪造剧情理解。",
    screenplay: null
  };
}
