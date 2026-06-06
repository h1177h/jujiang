import { describe, expect, it } from "vitest";
import { buildGenerationInputPlan, splitParagraphsForGeneration } from "../generationPlan";

describe("generation input plan", () => {
  it("classifies short text as a compact two-stage generation", () => {
    const plan = buildGenerationInputPlan(
      [
        "第一章 雾港",
        "沈知夏收到匿名信。",
        "第二章 旧账",
        "林砚发现账册被调包。"
      ].join("\n")
    );

    expect(plan.mode).toBe("compact");
    expect(plan.chapterCount).toBe(2);
    expect(plan.extractionUnitCount).toBe(2);
    expect(plan.oversizedChapterCount).toBe(0);
  });

  it("classifies three or more normal chapters as staged chapter extraction", () => {
    const plan = buildGenerationInputPlan(
      [
        "第一章 起风",
        "林砚发现码头起风。",
        "第二章 账册",
        "沈知夏拿到账册。",
        "第三章 钟楼",
        "众人进入钟楼。"
      ].join("\n")
    );

    expect(plan.mode).toBe("staged");
    expect(plan.chapterCount).toBe(3);
    expect(plan.extractionUnitCount).toBe(3);
  });

  it("classifies oversized chapters as chunked extraction before calling the model", () => {
    const paragraphs = Array.from(
      { length: 18 },
      (_, index) => `第 ${index + 1} 段，线索继续推进。${"冲突".repeat(40)}`
    );
    const plan = buildGenerationInputPlan(
      [
        "第一章 起风",
        ...paragraphs,
        "第二章 账册",
        ...paragraphs,
        "第三章 钟楼",
        ...paragraphs
      ].join("\n")
    );

    expect(plan.mode).toBe("chunked");
    expect(plan.oversizedChapterCount).toBe(3);
    expect(plan.extractionUnitCount).toBeGreaterThan(plan.chapterCount);
    expect(plan.chapterPlans[0]).toEqual(
      expect.objectContaining({
        chapterIndex: 1,
        chunkCount: expect.any(Number),
        paragraphCount: 18
      })
    );
  });

  it("splits paragraph arrays by paragraph count and character budget", () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => ({
      paragraphIndex: index + 1,
      text: `段落 ${index + 1}：${"内容".repeat(60)}`
    }));

    const chunks = splitParagraphsForGeneration(paragraphs);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThan(paragraphs.length);
  });
});
