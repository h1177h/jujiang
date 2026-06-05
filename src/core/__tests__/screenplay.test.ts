import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseChapters } from "../chapters";
import { generateScreenplayYamlModel } from "../generator";
import { sampleNovel } from "../sampleNovel";
import { updateScreenplaySceneYaml } from "../sceneEditor";
import { validateScreenplay } from "../schema";
import { generateScreenplayYaml, validateScreenplayYaml } from "../yaml";

describe("chapter parsing", () => {
  it("detects at least three Chinese chapter headings", () => {
    const chapters = parseChapters(sampleNovel);

    expect(chapters).toHaveLength(3);
    expect(chapters[0].title).toBe("迟到的渡船");
    expect(chapters[2].paragraphs.join(" ")).toContain("第十一声钟");
  });
});

describe("fallback screenplay generation", () => {
  it("generates required screenplay sections from three chapters", () => {
    const screenplay = generateScreenplayYamlModel(sampleNovel, {
      title: "雾港来信",
      style: "cinematic"
    });

    expect(screenplay.work.sourceChapterCount).toBe(3);
    expect(screenplay.characters.length).toBeGreaterThan(0);
    expect(screenplay.characters.map((character) => character.name)).toEqual(
      expect.arrayContaining(["林砚", "沈知夏"])
    );
    expect(screenplay.characters.map((character) => character.name)).not.toEqual(
      expect.arrayContaining(["忽然", "举起火", "低声", "夜色压"])
    );
    expect(screenplay.chapterMappings).toHaveLength(3);
    expect(screenplay.chapterMappings[0].sceneIds).toHaveLength(2);
    expect(screenplay.scenes).toHaveLength(6);
    expect(screenplay.scenes[0].source.excerpt).toContain("雾港");
    expect(screenplay.scenes[1].dialogue[0].speaker).toBe("林砚");
    expect(screenplay.scenes[3].dialogue[0].speaker).toBe("黑伞男人");
    expect(screenplay.scenes[3].beatType).toBe("payoff");
    expect(screenplay.adaptationPlan.structure).toHaveLength(3);
    expect(screenplay.storyDiagnostics.sourceCoverage).toContain("6 个场景");
    expect(screenplay.rhythmStats.sceneCount).toBe(6);
  });

  it("serializes to valid YAML that passes the schema", () => {
    const yamlText = generateScreenplayYaml(sampleNovel, { title: "雾港来信" });
    const parsed = parse(yamlText);

    expect(validateScreenplay(parsed).success).toBe(true);
    expect(validateScreenplayYaml(yamlText)).toEqual({ ok: true, errors: [] });
  });

  it("reports schema validation errors for incomplete YAML", () => {
    const result = validateScreenplayYaml("work:\n  title: only-title\n");

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("Required");
  });

  it("syncs scene editor changes back into valid YAML", () => {
    const yamlText = generateScreenplayYaml(sampleNovel, { title: "雾港来信" });
    const updatedYaml = updateScreenplaySceneYaml(yamlText, "scene-01", {
      goal: "让林砚在开场主动发现账册异常，并把选择压力推到台面上。",
      location: "雾港码头外景",
      characters: ["林砚", "沈知夏"],
      dialogue: [
        {
          speaker: "林砚",
          line: "这本账册不是给掌柜看的，是给凶手看的。",
          intent: "抛出判断",
          emotion: "警觉",
          source: generateScreenplayYamlModel(sampleNovel).scenes[0].source
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
});
