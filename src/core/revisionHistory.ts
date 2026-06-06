export interface ScreenplayRevision {
  id: string;
  label: string;
  yamlText: string;
  createdAt: string;
}

export type RevisionDiffKind = "unchanged" | "changed" | "added" | "removed";

export interface RevisionDiffItem {
  kind: RevisionDiffKind;
  lineNumber: number;
  before?: string;
  after?: string;
}

export interface RevisionDiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export interface RevisionDiff {
  revisionId: string;
  summary: RevisionDiffSummary;
  items: RevisionDiffItem[];
}

export function createRevision(label: string, yamlText: string, date = new Date()): ScreenplayRevision {
  return {
    id: `${date.toISOString()}-${slugLabel(label)}`,
    label,
    yamlText,
    createdAt: date.toISOString()
  };
}

export function pushRevision(
  history: ScreenplayRevision[],
  revision: ScreenplayRevision,
  limit = 6
): ScreenplayRevision[] {
  return [
    revision,
    ...history.filter((item) => item.yamlText !== revision.yamlText && item.id !== revision.id)
  ].slice(0, limit);
}

export function compareRevisionToCurrent(
  revision: ScreenplayRevision,
  currentYaml: string
): RevisionDiff {
  const beforeLines = normalizeLines(revision.yamlText);
  const afterLines = normalizeLines(currentYaml);
  let prefix = 0;

  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  const suffixItems: RevisionDiffItem[] = [];

  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    suffixItems.unshift({
      kind: "unchanged",
      lineNumber: afterSuffix + 1,
      before: beforeLines[beforeSuffix],
      after: afterLines[afterSuffix]
    });
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const items: RevisionDiffItem[] = [];

  for (let index = 0; index < prefix; index += 1) {
    items.push({
      kind: "unchanged",
      lineNumber: index + 1,
      before: beforeLines[index],
      after: afterLines[index]
    });
  }

  const beforeMiddle = beforeLines.slice(prefix, beforeSuffix + 1);
  const afterMiddle = afterLines.slice(prefix, afterSuffix + 1);
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeMiddle.length || afterIndex < afterMiddle.length) {
    const before = beforeMiddle[beforeIndex];
    const after = afterMiddle[afterIndex];

    if (before !== undefined && after !== undefined && lineSignature(before) === lineSignature(after)) {
      items.push({
        kind: "changed",
        lineNumber: prefix + afterIndex + 1,
        before,
        after
      });
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (
      before !== undefined &&
      afterMiddle[afterIndex + 1] !== undefined &&
      lineSignature(before) === lineSignature(afterMiddle[afterIndex + 1])
    ) {
      items.push({
        kind: "added",
        lineNumber: prefix + afterIndex + 1,
        after
      });
      afterIndex += 1;
      continue;
    }

    if (
      after !== undefined &&
      beforeMiddle[beforeIndex + 1] !== undefined &&
      lineSignature(beforeMiddle[beforeIndex + 1]) === lineSignature(after)
    ) {
      items.push({
        kind: "removed",
        lineNumber: prefix + afterIndex + 1,
        before
      });
      beforeIndex += 1;
      continue;
    }

    if (before !== undefined) {
      items.push({
        kind: "removed",
        lineNumber: prefix + afterIndex + 1,
        before
      });
      beforeIndex += 1;
    }

    if (after !== undefined) {
      items.push({
        kind: "added",
        lineNumber: prefix + afterIndex + 1,
        after
      });
      afterIndex += 1;
    }
  }

  items.push(...suffixItems);

  return {
    revisionId: revision.id,
    summary: summarizeDiffItems(items),
    items
  };
}

function slugLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
    .slice(0, 32) || "revision";
}

function normalizeLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function summarizeDiffItems(items: RevisionDiffItem[]): RevisionDiffSummary {
  return items.reduce<RevisionDiffSummary>(
    (summary, item) => {
      summary[item.kind] += 1;
      return summary;
    },
    {
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: 0
    }
  );
}

function lineSignature(line: string): string {
  const match = /^(\s*)(?:-\s*)?([^:]+):/.exec(line);
  if (!match) return line.trim();
  return `${match[1].length}:${match[2].trim()}`;
}
