import { parseChapters } from "./chapters";

export const generationChunkParagraphLimit = 8;
export const generationChunkCharLimit = 1800;

export interface GenerationParagraph {
  paragraphIndex: number;
  text: string;
}

export interface ChapterGenerationPlan {
  chapterIndex: number;
  chapterTitle: string;
  paragraphCount: number;
  characterCount: number;
  chunkCount: number;
}

export interface GenerationInputPlan {
  mode: "compact" | "staged" | "chunked";
  chapterCount: number;
  paragraphCount: number;
  characterCount: number;
  extractionUnitCount: number;
  oversizedChapterCount: number;
  summary: string;
  chapterPlans: ChapterGenerationPlan[];
}

export function buildGenerationInputPlan(novelText: string): GenerationInputPlan {
  const chapters = parseChapters(novelText);
  const chapterPlans = chapters.map((chapter) => {
    const paragraphs = chapter.paragraphs.map((text, index) => ({ paragraphIndex: index + 1, text }));
    const chunks = splitParagraphsForGeneration(paragraphs);
    return {
      chapterIndex: chapter.index,
      chapterTitle: chapter.title,
      paragraphCount: paragraphs.length,
      characterCount: paragraphs.reduce((total, paragraph) => total + paragraph.text.length, 0),
      chunkCount: chunks.length
    };
  });
  const extractionUnitCount = chapterPlans.reduce((total, chapter) => total + chapter.chunkCount, 0);
  const oversizedChapterCount = chapterPlans.filter((chapter) => chapter.chunkCount > 1).length;
  const mode =
    oversizedChapterCount > 0 ? "chunked" : chapters.length >= 3 ? "staged" : "compact";

  return {
    mode,
    chapterCount: chapters.length,
    paragraphCount: chapterPlans.reduce((total, chapter) => total + chapter.paragraphCount, 0),
    characterCount: chapterPlans.reduce((total, chapter) => total + chapter.characterCount, 0),
    extractionUnitCount,
    oversizedChapterCount,
    summary: buildPlanSummary(mode, chapters.length, extractionUnitCount, oversizedChapterCount),
    chapterPlans
  };
}

export function splitParagraphsForGeneration<T extends GenerationParagraph>(paragraphs: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const paragraph of paragraphs) {
    const paragraphChars = paragraph.text.length;
    const shouldStartNextChunk =
      current.length > 0 &&
      (current.length >= generationChunkParagraphLimit ||
        currentChars + paragraphChars > generationChunkCharLimit);

    if (shouldStartNextChunk) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(paragraph);
    currentChars += paragraphChars;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [paragraphs];
}

function buildPlanSummary(
  mode: GenerationInputPlan["mode"],
  chapterCount: number,
  extractionUnitCount: number,
  oversizedChapterCount: number
): string {
  if (mode === "compact") {
    return "短文本会先抽取故事蓝图，再生成剧本。";
  }
  if (mode === "staged") {
    return `将按 ${chapterCount} 章逐章抽取事件，再合并故事蓝图。`;
  }
  return `检测到 ${oversizedChapterCount} 个长章节，将拆成 ${extractionUnitCount} 个片段逐步抽取。`;
}
