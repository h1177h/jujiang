import type { ParsedChapter } from "./types";

const chapterHeadingPattern =
  /^(?:第\s*[0-9一二三四五六七八九十百千万]+\s*[章节回幕]|chapter\s+\d+|第\s*\d+\s*章)[\s:：、.-]*(.*)$/i;

export function normalizeNovelText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/\u3000/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseChapters(input: string): ParsedChapter[] {
  const text = normalizeNovelText(input);
  if (!text) {
    return [];
  }

  const lines = text.split("\n");
  const headingIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => chapterHeadingPattern.test(line));

  if (headingIndexes.length === 0) {
    return [
      buildChapter(1, "正文", "正文", lines.join("\n"), 1, lines.length)
    ];
  }

  return headingIndexes.map((heading, arrayIndex) => {
    const next = headingIndexes[arrayIndex + 1];
    const start = heading.index;
    const endExclusive = next ? next.index : lines.length;
    const headingText = lines[start];
    const titleMatch = headingText.match(chapterHeadingPattern);
    const title = titleMatch?.[1]?.trim() || `第 ${arrayIndex + 1} 章`;
    const chapterText = lines.slice(start + 1, endExclusive).join("\n");

    return buildChapter(
      arrayIndex + 1,
      title,
      headingText,
      chapterText,
      start + 1,
      endExclusive
    );
  });
}

function buildChapter(
  index: number,
  title: string,
  heading: string,
  text: string,
  startLine: number,
  endLine: number
): ParsedChapter {
  const paragraphs = text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return {
    index,
    title,
    heading,
    text: paragraphs.join("\n"),
    startLine,
    endLine,
    paragraphs
  };
}
