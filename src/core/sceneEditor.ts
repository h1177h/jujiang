import { parse } from "yaml";
import type { DialogueBeat, Scene, ScreenplayYaml } from "./types";
import { screenplayToYaml } from "./yaml";

export interface ScenePatch {
  title?: string;
  goal?: string;
  location?: string;
  time?: string;
  characters?: string[];
  action?: string[];
  dialogue?: DialogueBeat[];
  narrationOrTransition?: string;
  emotion?: string;
  pacing?: Scene["pacing"];
  conflict?: Scene["conflict"];
  revisionNotes?: string[];
}

export function updateScreenplayScene(
  screenplay: ScreenplayYaml,
  sceneId: string,
  patch: ScenePatch
): ScreenplayYaml {
  const scenes = screenplay.scenes.map((scene) =>
    scene.id === sceneId
      ? {
          ...scene,
          ...patch,
          conflict: patch.conflict ? { ...scene.conflict, ...patch.conflict } : scene.conflict
        }
      : scene
  );

  if (!scenes.some((scene) => scene.id === sceneId)) {
    throw new Error(`未找到场景：${sceneId}`);
  }

  return rebuildScreenplayMetrics({
    ...screenplay,
    scenes
  });
}

export function updateScreenplaySceneYaml(
  yamlText: string,
  sceneId: string,
  patch: ScenePatch
): string {
  const parsed = parse(yamlText) as ScreenplayYaml;
  return screenplayToYaml(updateScreenplayScene(parsed, sceneId, patch));
}

export function parseListInput(value: string): string[] {
  return value
    .split(/\r?\n|[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeDialogueInput(dialogue: DialogueBeat[]): string {
  return dialogue.map((item) => `${item.speaker}：${item.line}`).join("\n");
}

export function parseDialogueInput(value: string, fallbackScene: Scene): DialogueBeat[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separatorIndex = findDialogueSeparator(line);
      const speaker = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : fallbackScene.characters[0] ?? "角色";
      const content = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;
      const previous = fallbackScene.dialogue[index];

      return {
        speaker: speaker || "角色",
        line: content || "待补写对白",
        intent: previous?.intent ?? "表达态度",
        emotion: previous?.emotion ?? fallbackScene.emotion,
        source: previous?.source ?? fallbackScene.source
      };
    });
}

function findDialogueSeparator(line: string): number {
  const chinese = line.indexOf("：");
  const english = line.indexOf(":");
  if (chinese < 0) return english;
  if (english < 0) return chinese;
  return Math.min(chinese, english);
}

function rebuildScreenplayMetrics(screenplay: ScreenplayYaml): ScreenplayYaml {
  const dialogueCount = screenplay.scenes.reduce((sum, scene) => sum + scene.dialogue.length, 0);
  const averageConflict = Number(
    (
      screenplay.scenes.reduce((sum, scene) => sum + scene.conflict.level, 0) /
      Math.max(screenplay.scenes.length, 1)
    ).toFixed(2)
  );
  const highConflictSceneIds = screenplay.scenes
    .filter((scene) => scene.conflict.level >= 4)
    .map((scene) => scene.id);
  const strongest = [...screenplay.scenes].sort((a, b) => b.conflict.level - a.conflict.level)[0];
  const quietScenes = screenplay.scenes.filter((scene) => scene.pacing === "quiet").length;
  const noDialogueScenes = screenplay.scenes.filter((scene) => scene.dialogue.length === 0).length;
  const warnings = [
    quietScenes > screenplay.scenes.length / 2 ? "低冲突场景偏多，建议增加选择压力或明确阻碍。" : "",
    noDialogueScenes > 0 ? `有 ${noDialogueScenes} 场没有对白，建议检查是否需要补人物选择或场尾钩子。` : ""
  ].filter(Boolean);

  return {
    ...screenplay,
    rhythmStats: {
      ...screenplay.rhythmStats,
      sceneCount: screenplay.scenes.length,
      dialogueCount,
      averageConflict,
      highConflictSceneIds
    },
    storyDiagnostics: {
      ...screenplay.storyDiagnostics,
      strongestConflictSceneId: strongest?.id ?? screenplay.storyDiagnostics.strongestConflictSceneId,
      pacingSummary: `共 ${screenplay.scenes.length} 场，平均冲突 ${averageConflict.toFixed(
        2
      )}，高冲突场景 ${highConflictSceneIds.length} 场。`,
      warnings
    }
  };
}
