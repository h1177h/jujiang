import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { countChapters, parseChapters, summarizeSourceDraft } from "../chapters";
import { editorIssueFromYamlDiagnostic, patchTouchesEditorIssueField } from "../editorIssues";
import { sampleNovel } from "../sampleNovel";
import { isEditorReadyScene, updateScreenplaySceneYaml } from "../sceneEditor";
import { validateScreenplay } from "../schema";
import { buildSourceTrace } from "../sourceTrace";
import { analyzeScreenplay, findSceneIdForChapterEvent, formatStoryAnalysisPanelLabels } from "../storyAnalysis";
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

  it("summarizes source draft readiness without blocking short drafts", () => {
    expect(summarizeSourceDraft(sampleNovel)).toEqual(
      expect.objectContaining({
        status: "ready",
        chapterCount: 3,
        paragraphCount: 12,
        lineCount: 19,
        canGenerate: true
      })
    );

    const shortDraft = summarizeSourceDraft("她推开门。\n\n屋里没有灯。");

    expect(shortDraft).toEqual(
      expect.objectContaining({
        status: "short",
        chapterCount: 1,
        paragraphCount: 2,
        lineCount: 3,
        canGenerate: true
      })
    );
    expect(shortDraft.detail).toContain("素材偏短");

    expect(summarizeSourceDraft("   \n\n ")).toEqual(
      expect.objectContaining({
        status: "empty",
        chapterCount: 0,
        paragraphCount: 0,
        lineCount: 0,
        canGenerate: false
      })
    );
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

  it("rejects screenplay references outside the imported source chapter range", () => {
    const parsed = parse(sampleOutputYaml);
    parsed.chapterEvents[0].chapterIndex = 4;
    parsed.chapterEvents[0].events[0].source.chapterIndex = 4;
    parsed.characters[0].firstSeenChapter = 4;
    parsed.chapterMappings[0].chapterIndex = 4;
    parsed.scenes[0].chapterIndex = 4;
    parsed.scenes[0].source.chapterIndex = 4;
    parsed.scenes[0].dialogue[0].source.chapterIndex = 4;

    const validation = validateScreenplay(parsed);

    expect(validation.success).toBe(false);
    if (validation.success) return;
    const paths = validation.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining([
        "chapterEvents.0.chapterIndex",
        "chapterEvents.0.events.0.source.chapterIndex",
        "characters.0.firstSeenChapter",
        "chapterMappings.0.chapterIndex",
        "scenes.0.chapterIndex",
        "scenes.0.source.chapterIndex",
        "scenes.0.dialogue.0.source.chapterIndex"
      ])
    );
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
          targetField: "goal",
          actionHint: "在场景编辑器中补齐场景目标后会同步回 YAML。",
          suggestion: "补充这一场的戏剧目标，让作者知道本场要推动什么。"
        }),
        expect.objectContaining({
          path: "scenes.0.source.excerpt",
          sceneId: "scene-01",
          fieldLabel: "原文摘录",
          severity: "error",
          targetField: "source",
          actionHint: "核对原文依据区；如果摘录缺失，需要用真实 AI 重新生成或手动修正 YAML 来源字段。",
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

  it("builds line-level source trace evidence for a selected scene", () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const trace = buildSourceTrace(validation.data.scenes[0].source, sampleNovel);

    expect(trace.locationLabel).toBe("第 1 章 迟到的渡船 · 段落 1、2 · 行 3-8");
    expect(trace.lines.map((line) => line.lineNumber)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(trace.lines.filter((line) => line.isMatched).map((line) => line.text)).toEqual([
      "夜色压在雾港的石桥上，林砚抱着旧皮箱，听见钟楼敲过十下。",
      "沈知夏从灯下走来，低声说：“你不该回来。”"
    ]);
    expect(trace.matchedLineCount).toBe(2);
  });

  it("accepts schema-invalid scenes only when they are still safe to edit", () => {
    const parsed = parse(sampleOutputYaml);
    parsed.scenes[0].goal = "";

    expect(isEditorReadyScene(parsed.scenes[0])).toBe(true);

    delete parsed.scenes[0].source.lineEnd;
    expect(isEditorReadyScene(parsed.scenes[0])).toBe(false);
  });

  it("only clears editor issues when a patch touches the editable target field", () => {
    expect(patchTouchesEditorIssueField({ dialogue: [] }, "dialogue")).toBe(true);
    expect(patchTouchesEditorIssueField({ conflict: { level: 4, reason: "阻碍升级" } }, "conflict")).toBe(true);
    expect(patchTouchesEditorIssueField({ goal: "新的场景目标" }, "dialogue")).toBe(false);
    expect(patchTouchesEditorIssueField({ title: "改标题" }, "source")).toBe(false);
  });

  it("converts scene-level yaml diagnostics into editor issues", () => {
    const result = validateScreenplayYaml("scenes:\n  - id: scene-01\n    goal: ''\n");
    const diagnostic = result.issues?.find((issue) => issue.sceneId === "scene-01" && issue.targetField === "goal");

    expect(diagnostic).toBeTruthy();
    if (!diagnostic) return;

    expect(editorIssueFromYamlDiagnostic(diagnostic)).toEqual({
      sceneId: "scene-01",
      label: diagnostic.fieldLabel,
      detail: diagnostic.suggestion,
      severity: "error",
      targetField: "goal",
      actionHint: diagnostic.actionHint
    });
    expect(editorIssueFromYamlDiagnostic({ ...diagnostic, sceneId: undefined })).toBeNull();
    expect(editorIssueFromYamlDiagnostic({ ...diagnostic, targetField: undefined })).toBeNull();
  });

  it("maps quality issues to editable scene fields", () => {
    const validation = validateScreenplay(parse(sampleOutputYaml));
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const analysis = analyzeScreenplay(validation.data);

    expect(analysis.qualityIssues.some((issue) => issue.targetField === "dialogue")).toBe(true);
    expect(analysis.qualityIssues.some((issue) => issue.targetField === "characters")).toBe(true);
    expect(analysis.qualityIssues.every((issue) => issue.actionHint.length > 0)).toBe(true);
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
    expect(formatStoryAnalysisPanelLabels(analysis)).toEqual({
      sourceCoverage: "100% 覆盖",
      readyScenes: "5 场可继续打磨",
      qualityIssues: "3 项"
    });
    expect(findSceneIdForChapterEvent(screenplay.chapterEvents[0].events[1], screenplay.scenes)).toBe("scene-02");
    expect(findSceneIdForChapterEvent(screenplay.chapterEvents[0].events[0], screenplay.scenes)).toBe("scene-01");
  });
});
