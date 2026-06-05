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
  title: string;
  goal: string;
  location: string;
  time: string;
  characters: string[];
  action: string[];
  dialogue: DialogueBeat[];
  narrationOrTransition: string;
  emotion: string;
  conflict: {
    level: 1 | 2 | 3 | 4 | 5;
    reason: string;
  };
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
    generatedBy: "jujiang-fallback-engine";
  };
  characters: CharacterProfile[];
  chapterMappings: ChapterMapping[];
  scenes: Scene[];
  rhythmStats: {
    sceneCount: number;
    dialogueCount: number;
    averageConflict: number;
    highConflictSceneIds: string[];
  };
  validationHints: string[];
}
