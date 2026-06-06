import { parse } from "yaml";
import { stringify } from "yaml";
import { validateScreenplay } from "./schema";
import type { ScreenplayYaml } from "./types";

export interface ScreenplayYamlDiagnostic {
  path: string;
  message: string;
  fieldLabel: string;
  severity: "error";
  suggestion: string;
  sceneId?: string;
}

export function screenplayToYaml(screenplay: ScreenplayYaml): string {
  return stringify(screenplay, {
    collectionStyle: "block",
    lineWidth: 100
  });
}

export function validateScreenplayYaml(yamlText: string): {
  ok: boolean;
  errors: string[];
  issues?: ScreenplayYamlDiagnostic[];
} {
  try {
    const parsed = parse(yamlText);
    const validation = validateScreenplay(parsed);
    if (validation.success) {
      return { ok: true, errors: [] };
    }

    const issues = validation.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return {
        path,
        message: issue.message,
        fieldLabel: labelSchemaPath(path),
        severity: "error" as const,
        suggestion: suggestSchemaFix(path),
        sceneId: findSceneIdForPath(parsed, issue.path)
      };
    });

    return {
      ok: false,
      errors: issues.map((issue) =>
        [issue.sceneId, issue.fieldLabel, issue.message].filter(Boolean).join(" · ")
      ),
      issues
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "YAML 解析失败"],
      issues: [
        {
          path: "yaml",
          message: error instanceof Error ? error.message : "YAML 解析失败",
          fieldLabel: "YAML 格式",
          severity: "error",
          suggestion: "检查缩进、冒号和列表符号，先让 YAML 能被解析。"
        }
      ]
    };
  }
}

function labelSchemaPath(path: string): string {
  if (/^scenes\.\d+\.goal$/.test(path)) return "场景目标";
  if (/^scenes\.\d+\.source\.excerpt$/.test(path)) return "原文摘录";
  if (/^scenes\.\d+\.dialogue/.test(path)) return "对白";
  if (/^scenes\.\d+\.characters/.test(path)) return "出场人物";
  if (/^scenes\.\d+\.conflict\.level$/.test(path)) return "冲突等级";
  if (path.startsWith("chapterMappings")) return "章节映射";
  if (path.startsWith("chapterEvents")) return "章节事件";
  if (path.startsWith("characters")) return "角色表";
  if (path.startsWith("adaptationPlan")) return "改编计划";
  if (path.startsWith("storyDiagnostics")) return "故事诊断";
  if (path.startsWith("rhythmStats")) return "节奏统计";
  if (path.startsWith("work")) return "作品信息";
  return path || "剧本结构";
}

function suggestSchemaFix(path: string): string {
  if (/^scenes\.\d+\.goal$/.test(path)) {
    return "补充这一场的戏剧目标，让作者知道本场要推动什么。";
  }
  if (/^scenes\.\d+\.source\.excerpt$/.test(path)) {
    return "补充可追溯的原文摘录，避免场景失去改编依据。";
  }
  if (/^scenes\.\d+\.dialogue/.test(path)) {
    return "检查对白数组结构；没有对白时保留空数组，有对白时补齐 speaker、line、intent、emotion 和 source。";
  }
  if (path.startsWith("chapterMappings")) {
    return "补齐章节到场景的映射，确保每章能追溯到对应 sceneIds。";
  }
  if (path.startsWith("chapterEvents")) {
    return "补齐章节事件和事件来源，避免剧本只剩分场结果。";
  }
  if (path.startsWith("characters")) {
    return "补齐角色表字段，至少包含姓名、角色定位、特征和首次出现章节。";
  }
  return "按 Schema 补齐该字段，保持 YAML 缩进和字段层级不变。";
}

function findSceneIdForPath(parsed: unknown, path: Array<string | number>): string | undefined {
  if (path[0] !== "scenes" || typeof path[1] !== "number") {
    return undefined;
  }

  const scenes = (parsed as { scenes?: unknown[] } | null)?.scenes;
  const scene = Array.isArray(scenes) ? scenes[path[1]] : null;
  const sceneId = (scene as { id?: unknown } | null)?.id;
  return typeof sceneId === "string" && sceneId ? sceneId : undefined;
}
