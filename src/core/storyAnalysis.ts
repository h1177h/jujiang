import type { ChapterEvent, Scene, ScreenplayYaml, SourceLocator } from "./types";

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
  targetField: "goal" | "characters" | "dialogue" | "conflict" | "source" | "revisionNotes";
  actionHint: string;
}

export interface StoryAnalysis {
  chapterCoverage: ChapterSceneCoverage[];
  eventCoverage: Array<{
    chapterIndex: number;
    eventCount: number;
    label: string;
  }>;
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
  const eventCoverage = screenplay.chapterEvents.map((chapter) => ({
    chapterIndex: chapter.chapterIndex,
    eventCount: chapter.events.length,
    label: `${chapter.events.length} 个事件`
  }));

  const qualityIssues = screenplay.scenes.flatMap((scene) => buildSceneIssues(scene));
  const readySceneCount = screenplay.scenes.length - new Set(qualityIssues.map((issue) => issue.sceneId)).size;

  return {
    chapterCoverage,
    eventCoverage,
    conflictCurve,
    qualityIssues,
    sourceCoveragePercent:
      screenplay.scenes.length === 0
        ? 0
        : Math.round((coveredSceneIds.size / screenplay.scenes.length) * 100),
    readySceneCount
  };
}

export function formatStoryAnalysisPanelLabels(analysis: StoryAnalysis): {
  sourceCoverage: string;
  readyScenes: string;
  qualityIssues: string;
} {
  return {
    sourceCoverage: `${analysis.sourceCoveragePercent}% 覆盖`,
    readyScenes: `${analysis.readySceneCount} 场可继续打磨`,
    qualityIssues: `${analysis.qualityIssues.length} 项`
  };
}

export function findSceneIdForChapterEvent(event: ChapterEvent, scenes: Scene[]): string | null {
  const chapterScenes = scenes.filter((scene) => scene.chapterIndex === event.source.chapterIndex);
  const sourceMatchedScene = chapterScenes.find((scene) => sourceOverlaps(scene.source, event.source));
  return sourceMatchedScene?.id ?? chapterScenes[0]?.id ?? null;
}

function buildSceneIssues(scene: Scene): SceneQualityIssue[] {
  const issues: SceneQualityIssue[] = [];

  if (scene.conflict.level <= 2) {
    issues.push({
      sceneId: scene.id,
      label: "冲突偏低",
      detail: "这一场的阻碍或选择压力还不够明显，适合补人物目标或时间压力。",
      severity: "warning",
      targetField: "conflict",
      actionHint: "调整冲突等级和冲突说明，补充本场的阻碍、选择压力或时间压力。"
    });
  }

  if (scene.dialogue.length === 0) {
    issues.push({
      sceneId: scene.id,
      label: "缺少对白",
      detail: "如果这是关键场，建议补一句人物选择、试探或场尾钩子。",
      severity: "warning",
      targetField: "dialogue",
      actionHint: "在对白区补入人物、台词和意图，优先让对白承担选择或信息转折。"
    });
  }

  if (scene.characters.length <= 1) {
    issues.push({
      sceneId: scene.id,
      label: "人物关系弱",
      detail: "单人场需要更强动作目标；否则可以加入对手、同盟或压力来源。",
      severity: "warning",
      targetField: "characters",
      actionHint: "检查出场人物列表，再决定是加入对手/同盟，还是强化单人场的动作目标。"
    });
  }

  if (!scene.source.excerpt || scene.source.excerpt.length < 12) {
    issues.push({
      sceneId: scene.id,
      label: "来源依据不足",
      detail: "source.excerpt 太短，评审时不容易看出改编依据。",
      severity: "risk",
      targetField: "source",
      actionHint: "回到原文依据区核对摘录和行号，必要时用真实 AI 重新生成带完整来源的版本。"
    });
  }

  if (scene.revisionNotes.length === 0) {
    issues.push({
      sceneId: scene.id,
      label: "缺少修订建议",
      detail: "建议给作者留下下一轮打磨方向。",
      severity: "risk",
      targetField: "revisionNotes",
      actionHint: "在修订建议中写下下一轮要补强的方向，例如对白、转场或冲突节点。"
    });
  }

  return issues;
}

function sourceOverlaps(sceneSource: SourceLocator, eventSource: SourceLocator): boolean {
  if (sceneSource.excerpt.includes(eventSource.excerpt) || eventSource.excerpt.includes(sceneSource.excerpt)) {
    return true;
  }

  const eventParagraphs = new Set(eventSource.paragraphIndexes);
  return sceneSource.paragraphIndexes.some((paragraphIndex) => eventParagraphs.has(paragraphIndex));
}
