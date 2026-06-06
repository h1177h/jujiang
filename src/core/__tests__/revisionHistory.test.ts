import { describe, expect, it } from "vitest";
import { compareRevisionToCurrent, createRevision, pushRevision } from "../revisionHistory";

describe("revision history", () => {
  it("keeps the newest screenplay snapshots first and limits history length", () => {
    const base = createRevision("初稿", "yaml-1", new Date("2026-06-06T00:00:00Z"));
    const second = createRevision("补强场景", "yaml-2", new Date("2026-06-06T00:01:00Z"));
    const third = createRevision("修订对白", "yaml-3", new Date("2026-06-06T00:02:00Z"));

    const history = pushRevision(pushRevision(pushRevision([], base, 2), second, 2), third, 2);

    expect(history.map((item) => item.label)).toEqual(["修订对白", "补强场景"]);
    expect(history[0].yamlText).toBe("yaml-3");
  });

  it("moves an existing snapshot to the front instead of duplicating identical YAML", () => {
    const first = createRevision("初稿", "same-yaml", new Date("2026-06-06T00:00:00Z"));
    const repeated = createRevision("手动保存", "same-yaml", new Date("2026-06-06T00:05:00Z"));

    const history = pushRevision(pushRevision([], first), repeated);

    expect(history).toHaveLength(1);
    expect(history[0].label).toBe("手动保存");
  });

  it("summarizes line changes between a saved revision and current YAML", () => {
    const revision = createRevision(
      "初稿",
      [
        "work:",
        "  title: 雾港来信",
        "scenes:",
        "  - id: scene-1",
        "    goal: 找到账册",
        "    pacing: steady",
        "    note: 待加强"
      ].join("\n"),
      new Date("2026-06-06T00:00:00Z")
    );
    const currentYaml = [
      "work:",
      "  title: 雾港来信",
      "scenes:",
      "  - id: scene-1",
      "    goal: 当众逼问账册去向",
      "    pacing: tense",
      "    dialogue:",
      "      - speaker: 沈知夏"
    ].join("\n");

    const diff = compareRevisionToCurrent(revision, currentYaml);

    expect(diff.summary).toEqual({
      added: 2,
      removed: 1,
      changed: 2,
      unchanged: 4
    });
    expect(diff.items.map((item) => item.kind)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "changed",
      "changed",
      "removed",
      "added",
      "added"
    ]);
    expect(diff.items.find((item) => item.kind === "changed")).toMatchObject({
      before: "    goal: 找到账册",
      after: "    goal: 当众逼问账册去向"
    });
  });
});
