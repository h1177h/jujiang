import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseChapters } from "../chapters";
import { generateScreenplayYamlModel } from "../generator";
import { sampleNovel } from "../sampleNovel";
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
    expect(screenplay.scenes).toHaveLength(3);
    expect(screenplay.scenes[0].source.excerpt).toContain("雾港");
    expect(screenplay.rhythmStats.sceneCount).toBe(3);
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
});
