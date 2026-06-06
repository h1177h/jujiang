export type AdaptationStyle = "balanced" | "cinematic" | "stage" | "short_drama";

export interface ParsedChapter {
  index: number;
  title: string;
  heading: string;
  text: string;
  startLine: number;
  endLine: number;
  paragraphs: string[];
}

export interface SourceLocator {
  chapterIndex: number;
  chapterTitle: string;
  paragraphIndexes: number[];
  lineStart: number;
  lineEnd: number;
  excerpt: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  role: "protagonist" | "supporting" | "unknown";
  traits: string[];
  firstSeenChapter: number;
  relationshipSummary: string;
}

export interface ChapterEvent {
  id: string;
  summary: string;
  characters: string[];
  location: string;
  conflict: string;
  emotionalTurn: string;
  source: SourceLocator;
}

export interface ChapterEventGroup {
  chapterIndex: number;
  chapterTitle: string;
  chapterGoal: string;
  events: ChapterEvent[];
}

export interface StoryBible {
  worldview: string;
  coreConflict: string;
  timeline: string[];
  characterArcs: Array<{
    character: string;
    arc: string;
    firstEventId: string;
    lastEventId: string;
  }>;
}

export interface AdaptationStrategyBrief {
  format: string;
  pacing: string;
  sceneRules: string[];
  riskControls: string[];
}

export interface StoryBlueprint {
  chapterEvents: ChapterEventGroup[];
  storyBible: StoryBible;
  adaptationStrategy: AdaptationStrategyBrief;
}

export interface DialogueBeat {
  speaker: string;
  line: string;
  intent: string;
  emotion: string;
  source: SourceLocator;
}

export interface Scene {
  id: string;
  chapterIndex: number;
  beatIndex: number;
  beatType: "setup" | "turning_point" | "payoff";
  title: string;
  goal: string;
  location: string;
  time: string;
  characters: string[];
  action: string[];
  dialogue: DialogueBeat[];
  narrationOrTransition: string;
  emotion: string;
  pacing: "quiet" | "steady" | "tense" | "cliffhanger";
  conflict: {
    level: 1 | 2 | 3 | 4 | 5;
    reason: string;
  };
  revisionNotes: string[];
  source: SourceLocator;
}

export interface ChapterMapping {
  chapterIndex: number;
  novelTitle: string;
  sceneIds: string[];
  summary: string;
  sourceLines: [number, number];
}

export interface ScreenplayYaml {
  work: {
    title: string;
    adaptationStyle: AdaptationStyle;
    logline: string;
    sourceChapterCount: number;
    generatedBy: string;
  };
  adaptationPlan: {
    premise: string;
    tone: string;
    targetAudience: string;
    structure: string[];
    nextRevisionFocus: string[];
  };
  characters: CharacterProfile[];
  chapterEvents: ChapterEventGroup[];
  storyBible: StoryBible;
  adaptationStrategy: AdaptationStrategyBrief;
  chapterMappings: ChapterMapping[];
  scenes: Scene[];
  rhythmStats: {
    sceneCount: number;
    dialogueCount: number;
    averageConflict: number;
    highConflictSceneIds: string[];
  };
  storyDiagnostics: {
    paragraphCount: number;
    sourceCoverage: string;
    strongestConflictSceneId: string;
    pacingSummary: string;
    warnings: string[];
  };
  validationHints: string[];
}
