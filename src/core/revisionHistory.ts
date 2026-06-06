export interface ScreenplayRevision {
  id: string;
  label: string;
  yamlText: string;
  createdAt: string;
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

function slugLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
    .slice(0, 32) || "revision";
}
