import type { Scene, ScreenplayYaml } from "./types";

export interface ChapterSceneCoverage {
  chapterIndex: number;
  title: string;
  sceneIds: string[];
  sourceLines: [number, number];
  summary: string;
  coverageLabel: string;
}

export interface ConflictCurvePoint {
  sceneId: string;
  title: string;
  level: Scene["conflict"]["level"];
  pacing: Scene["pacing"];
  chapterIndex: number;
}

export interface SceneQualityIssue {
  sceneId: string;
  label: string;
  detail: string;
  severity: "warning" | "risk";
}

export interface StoryAnalysis {
  chapterCoverage: ChapterSceneCoverage[];
  conflictCurve: ConflictCurvePoint[];
  qualityIssues: SceneQualityIssue[];
  sourceCoveragePercent: number;
  readySceneCount: number;
}

export function analyzeScreenplay(screenplay: ScreenplayYaml): StoryAnalysis {
  const sceneMap = new Map(screenplay.scenes.map((scene) => [scene.id, scene]));
  const coveredSceneIds = new Set<string>();

  const chapterCoverage = screenplay.chapterMappings.map((mapping) => {
    for (const sceneId of mapping.sceneIds) {
      if (sceneMap.has(sceneId)) {
        coveredSceneIds.add(sceneId);
      }
    }

    return {
      chapterIndex: mapping.chapterIndex,
      title: mapping.novelTitle,
      sceneIds: mapping.sceneIds,
      sourceLines: mapping.sourceLines,
      summary: mapping.summary,
      coverageLabel: `${mapping.sceneIds.length} 场 / 行 ${mapping.sourceLines[0]}-${mapping.sourceLines[1]}`
    };
  });

  const conflictCurve = screenplay.scenes.map((scene) => ({
    sceneId: scene.id,
    title: scene.title,
    level: scene.conflict.level,
    pacing: scene.pacing,
    chapterIndex: scene.chapterIndex
  }));

  const qualityIssues = screenplay.scenes.flatMap((scene) => buildSceneIssues(scene));
  const readySceneCount = screenplay.scenes.length - new Set(qualityIssues.map((issue) => issue.sceneId)).size;

  return {
    chapterCoverage,
    conflictCurve,
    qualityIssues,
    sourceCoveragePercent:
      screenplay.scenes.length === 0
        ? 0
        : Math.round((coveredSceneIds.size / screenplay.scenes.length) * 100),
    readySceneCount
  };
}

function buildSceneIssues(scene: Scene): SceneQualityIssue[] {
  const issues: SceneQualityIssue[] = [];

  if (scene.conflict.level <= 2) {
    issues.push({
      sceneId: scene.id,
      label: "冲突偏低",
      detail: "这一场的阻碍或选择压力还不够明显，适合补人物目标或时间压力。",
      severity: "warning"
    });
  }

  if (scene.dialogue.length === 0) {
    issues.push({
      sceneId: scene.id,
      label: "缺少对白",
      detail: "如果这是关键场，建议补一句人物选择、试探或场尾钩子。",
      severity: "warning"
    });
  }

  if (scene.characters.length <= 1) {
    issues.push({
      sceneId: scene.id,
      label: "人物关系弱",
      detail: "单人场需要更强动作目标；否则可以加入对手、同盟或压力来源。",
      severity: "warning"
    });
  }

  if (!scene.source.excerpt || scene.source.excerpt.length < 12) {
    issues.push({
      sceneId: scene.id,
      label: "来源依据不足",
      detail: "source.excerpt 太短，评审时不容易看出改编依据。",
      severity: "risk"
    });
  }

  if (scene.revisionNotes.length === 0) {
    issues.push({
      sceneId: scene.id,
      label: "缺少修订建议",
      detail: "建议给作者留下下一轮打磨方向。",
      severity: "risk"
    });
  }

  return issues;
}
