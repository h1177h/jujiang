import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { countChapters, parseChapters } from "../chapters";
import { sampleNovel } from "../sampleNovel";
import { updateScreenplaySceneYaml } from "../sceneEditor";
import { validateScreenplay } from "../schema";
import { analyzeScreenplay } from "../storyAnalysis";
import { validateScreenplayYaml } from "../yaml";
import sampleOutputYaml from "../../../examples/sample-output.yaml?raw";

describe("chapter parsing", () => {
  it("detects at least three Chinese chapter headings", () => {
    const chapters = parseChapters(sampleNovel);

    expect(chapters).toHaveLength(3);
    expect(chapters[0].title).toBe("迟到的渡船");
    expect(chapters[2].paragraphs.join(" ")).toContain("第十一声钟");
  });

  it("merges duplicated heading lines from scraped novel text", () => {
    const chapters = parseChapters(
      [
        "第一章 他叫白小纯",
        "第一章",
        "白小纯离开村子。",
        "第二章 火灶房",
        "第二章",
        "灵溪宗火灶房里，众人看着白小纯。",
        "第三章 六句真言",
        "第三章",
        "白小纯开始背诵六句真言。"
      ].join("\n")
    );

    expect(chapters.map((chapter) => chapter.title)).toEqual(["他叫白小纯", "火灶房", "六句真言"]);
    expect(chapters).toHaveLength(3);
    expect(chapters[1].paragraphs.join(" ")).toContain("火灶房里");
  });

  it("counts chapters with the same parser used for generation", () => {
    const count = countChapters(
      [
        "第一章 他叫白小纯",
        "白小纯离开村子。",
        "第二章 火灶房",
        "",
        "第二章",
        "火灶房里烟火正旺。",
        "第三章 六句真言",
        "",
        "第三章",
        "钟声响起。"
      ].join("\n")
    );

    expect(count).toBe(3);
  });
});

describe("screenplay schema and review helpers", () => {
  it("accepts the checked-in sample screenplay YAML", () => {
    const screenplay = parse(sampleOutputYaml);
    const validation = validateScreenplay(screenplay);

    expect(validation.success).toBe(true);
    if (!validation.success) return;
    expect(validation.data.work.title).toBe("雾港来信");
    expect(validation.data.work.sourceChapterCount).toBe(3);
    expect(screenplay.work.sourceChapterCount).toBe(3);
    expect(screenplay.characters.length).toBeGreaterThan(0);
    expect(validation.data.chapterEvents).toHaveLength(3);
    expect(validation.data.chapterEvents[0].events[0]).toEqual(
      expect.objectContaining({
        id: "event-01-01",
        summary: expect.stringContaining("渡船")
      })
    );
    expect(validation.data.storyBible.coreConflict).toContain("信");
    expect(validation.data.adaptationStrategy.sceneRules.length).toBeGreaterThan(0);
    expect(screenplay.chapterMappings).toHaveLength(3);
    expect(screenplay.scenes).toHaveLength(6);
    expect(screenplay.rhythmStats.sceneCount).toBe(6);
  });

  it("reports schema validation errors for incomplete YAML", () => {
    const result = validateScreenplayYaml("work:\n  title: only-title\n");

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("Required");
  });

  it("returns structured diagnostics that point authors to the broken scene field", () => {
    const parsed = parse(sampleOutputYaml);
    parsed.scenes[0].goal = "";
    delete parsed.scenes[0].source.excerpt;

    const result = validateScreenplayYaml(stringify(parsed));

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "scenes.0.goal",
          sceneId: "scene-01",
          fieldLabel: "场景目标",
          severity: "error",
          suggestion: "补充这一场的戏剧目标，让作者知道本场要推动什么。"
        }),
        expect.objectContaining({
          path: "scenes.0.source.excerpt",
          sceneId: "scene-01",
          fieldLabel: "原文摘录",
          severity: "error",
          suggestion: "补充可追溯的原文摘录，避免场景失去改编依据。"
        })
      ])
    );
    expect(result.errors.join("\n")).toContain("scene-01");
  });

  it("syncs scene editor changes back into valid YAML", () => {
    const sourceScreenplay = validateScreenplay(parse(sampleOutputYaml));
    expect(sourceScreenplay.success).toBe(true);
    if (!sourceScreenplay.success) return;

    const updatedYaml = updateScreenplaySceneYaml(sampleOutputYaml, "scene-01", {
      goal: "让林砚在开场主动发现账册异常，并把选择压力推到台面上。",
      location: "雾港码头外景",
      characters: ["林砚", "沈知夏"],
      dialogue: [
        {
          speaker: "林砚",
          line: "这本账册不是给掌柜看的，是给凶手看的。",
          intent: "抛出判断",
          emotion: "警觉",
          source: sourceScreenplay.data.scenes[0].source
        }
      ],
      conflict: {
        level: 5,
        reason: "主角直接指出账册异常，外部危险和信息压力同时抬升。"
      }
    });

    const parsed = parse(updatedYaml);
    const validation = validateScreenplay(parsed);

    expect(validation.success).toBe(true);
    if (!validation.success) return;
    expect(validation.data.scenes[0].goal).toContain("账册异常");
    expect(validation.data.scenes[0].location).toBe("雾港码头外景");
    expect(validation.data.scenes[0].dialogue[0].speaker).toBe("林砚");
    expect(validation.data.rhythmStats.highConflictSceneIds).toContain("scene-01");
    expect(validateScreenplayYaml(updatedYaml)).toEqual({ ok: true, errors: [] });
  });

  it("builds actionable story analysis from the screenplay", () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const screenplay = validation.data;
    const analysis = analyzeScreenplay(screenplay);

    expect(analysis.sourceCoveragePercent).toBe(100);
    expect(analysis.eventCoverage).toEqual([
      { chapterIndex: 1, eventCount: 2, label: "2 个事件" },
      { chapterIndex: 2, eventCount: 2, label: "2 个事件" },
      { chapterIndex: 3, eventCount: 2, label: "2 个事件" }
    ]);
    expect(analysis.chapterCoverage).toHaveLength(3);
    expect(analysis.chapterCoverage[0].sceneIds).toEqual(["scene-01", "scene-02"]);
    expect(analysis.conflictCurve.map((point) => point.sceneId)).toEqual(
      screenplay.scenes.map((scene) => scene.id)
    );
    expect(analysis.qualityIssues.map((issue) => issue.label)).toEqual(
      expect.arrayContaining(["缺少对白", "人物关系弱"])
    );
  });
});
