import type { ParsedChapter } from "./types";

const chapterHeadingPattern =
  /^(第\s*[0-9一二三四五六七八九十百千万]+\s*[章节回幕]|chapter\s+\d+|第\s*\d+\s*章)[\s:：、.-]*(.*)$/i;

interface ChapterHeading {
  index: number;
  marker: string;
  title: string;
  line: string;
  contentStart: number;
}

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
    .map(({ line, index }) => {
      const match = line.match(chapterHeadingPattern);
      return match
        ? {
            line,
            index,
            marker: normalizeChapterMarker(match[1]),
            title: match[2]?.trim() ?? "",
            contentStart: index + 1
          }
        : null;
    })
    .filter((heading): heading is ChapterHeading => Boolean(heading));

  if (headingIndexes.length === 0) {
    return [
      buildChapter(1, "正文", "正文", lines.join("\n"), 1, lines.length)
    ];
  }

  const headings = mergeDuplicatedHeadings(headingIndexes, lines);

  return headings.map((heading, arrayIndex) => {
    const nextKept = headings[arrayIndex + 1];
    const endExclusive = nextKept ? nextKept.index : lines.length;
    const title = heading.title || `第 ${arrayIndex + 1} 章`;
    const chapterText = lines.slice(heading.contentStart, endExclusive).join("\n");

    return buildChapter(
      arrayIndex + 1,
      title,
      heading.line,
      chapterText,
      heading.contentStart + 1,
      endExclusive
    );
  });
}

export function countChapters(input: string): number {
  return parseChapters(input).length;
}

function mergeDuplicatedHeadings(headings: ChapterHeading[], lines: string[]): ChapterHeading[] {
  const merged: ChapterHeading[] = [];

  for (let index = 0; index < headings.length; index++) {
    const current = { ...headings[index] };
    const next = headings[index + 1];
    const blankBetween =
      next && lines.slice(current.index + 1, next.index).every((line) => !line.trim());

    if (next && current.marker === next.marker && blankBetween) {
      if (current.title && !next.title) {
        current.contentStart = next.index + 1;
        merged.push(current);
        index++;
        continue;
      }

      if (!current.title && next.title) {
        merged.push({
          ...next,
          contentStart: next.index + 1
        });
        index++;
        continue;
      }
    }

    merged.push(current);
  }

  return merged.filter((heading, index) => {
    const next = merged[index + 1];
    const endExclusive = next ? next.index : lines.length;
    return lines.slice(heading.contentStart, endExclusive).some((line) => line.trim());
  });
}

function normalizeChapterMarker(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
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
