import type { AdaptationStyle, ScreenplayYaml } from "./types";
import { normalizeNovelText } from "./chapters";
import { generateScreenplayYamlModel } from "./generator";

export interface WorkspaceGenerationRequest {
  title: string;
  style: AdaptationStyle;
  novelText: string;
  useApi: boolean;
  apiReady: boolean;
  model: string;
}

export type WorkspaceGenerationSource = "api" | "local-draft" | "error";

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
      status: "请先输入小说正文，再生成剧本草稿。",
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
      return buildLocalDraftResult(request, `AI 暂时不可用，已生成本地草稿继续工作：${message}`);
    }
  }

  return buildLocalDraftResult(
    request,
    request.useApi ? "未配置可用 API，已生成本地草稿继续工作。" : "本地草稿生成完成。"
  );
}

function buildLocalDraftResult(
  request: WorkspaceGenerationRequest,
  status: string
): WorkspaceGenerationResult {
  return {
    source: "local-draft",
    status,
    screenplay: generateScreenplayYamlModel(request.novelText, {
      title: request.title,
      style: request.style
    })
  };
}
