import type { SourceLocator } from "./types";

export interface SourceTraceLine {
  lineNumber: number;
  text: string;
  isMatched: boolean;
}

export interface SourceTrace {
  locationLabel: string;
  excerpt: string;
  matchedLineCount: number;
  lines: SourceTraceLine[];
}

export function buildSourceTrace(source: SourceLocator, novelText: string): SourceTrace {
  const lines = novelText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const startIndex = Math.max(0, source.lineStart - 1);
  const endIndex = Math.max(startIndex, Math.min(lines.length - 1, source.lineEnd - 1));
  const excerptFragments = normalizeFragments(source.excerpt);
  const traceLines = lines.slice(startIndex, endIndex + 1).map((text, index) => {
    const lineNumber = source.lineStart + index;
    return {
      lineNumber,
      text,
      isMatched: excerptFragments.some((fragment) => normalizeText(text).includes(fragment))
    };
  });

  return {
    locationLabel: `第 ${source.chapterIndex} 章 ${source.chapterTitle} · 段落 ${source.paragraphIndexes
      .map((index) => index + 1)
      .join("、")} · 行 ${source.lineStart}-${source.lineEnd}`,
    excerpt: source.excerpt,
    matchedLineCount: traceLines.filter((line) => line.isMatched).length,
    lines: traceLines
  };
}

function normalizeFragments(excerpt: string): string[] {
  return excerpt
    .split(/[。！？!?]\s*/)
    .map((fragment) => normalizeText(fragment))
    .filter((fragment) => fragment.length >= 6);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "");
}
