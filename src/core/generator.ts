import type {
  AdaptationStyle,
  CharacterProfile,
  DialogueBeat,
  ParsedChapter,
  Scene,
  ScreenplayYaml,
  SourceLocator
} from "./types";
import { parseChapters } from "./chapters";
import { validateScreenplay } from "./schema";

export interface GenerateScreenplayOptions {
  title?: string;
  style?: AdaptationStyle;
}

const knownLocationWords = ["城", "门", "院", "街", "桥", "楼", "厅", "屋", "山", "河", "驿站", "书房"];
const conflictWords = ["争", "怒", "喊", "杀", "逃", "疑", "逼", "急", "断", "泪", "血", "火", "秘密"];

interface SceneDraft {
  chapter: ParsedChapter;
  beatIndex: number;
  paragraphIndexes: number[];
  paragraphs: string[];
}

export function generateScreenplayYamlModel(
  input: string,
  options: GenerateScreenplayOptions = {}
): ScreenplayYaml {
  const chapters = parseChapters(input);
  if (chapters.length === 0) {
    throw new Error("请先输入小说正文，再生成剧本草稿。");
  }

  const characters = extractCharacters(chapters);
  const sceneDrafts = chapters.flatMap((chapter) => splitChapterIntoSceneDrafts(chapter));
  const scenes = sceneDrafts.map((draft, index) =>
    buildScene(draft, index + 1, characters, options.style ?? "balanced")
  );
  const dialogueCount = scenes.reduce((sum, scene) => sum + scene.dialogue.length, 0);
  const averageConflict = Number(
    (scenes.reduce((sum, scene) => sum + scene.conflict.level, 0) / scenes.length).toFixed(2)
  );
  const highConflictSceneIds = scenes
    .filter((scene) => scene.conflict.level >= 4)
    .map((scene) => scene.id);

  const model: ScreenplayYaml = {
    work: {
      title: options.title?.trim() || inferWorkTitle(input),
      adaptationStyle: options.style ?? "balanced",
      logline: buildLogline(chapters),
      sourceChapterCount: chapters.length,
      generatedBy: "jujiang-local-draft-engine"
    },
    adaptationPlan: buildAdaptationPlan(chapters, scenes, options.style ?? "balanced"),
    characters,
    chapterMappings: chapters.map((chapter) => ({
      chapterIndex: chapter.index,
      novelTitle: chapter.title,
      sceneIds: scenes.filter((scene) => scene.chapterIndex === chapter.index).map((scene) => scene.id),
      summary: summarizeParagraphs(chapter.paragraphs),
      sourceLines: [chapter.startLine, chapter.endLine]
    })),
    scenes,
    rhythmStats: {
      sceneCount: scenes.length,
      dialogueCount,
      averageConflict,
      highConflictSceneIds
    },
    storyDiagnostics: buildStoryDiagnostics(chapters, scenes),
    validationHints: [
      "可以先从短篇片段开始生成草稿，也可以继续补充正文让结构更完整。",
      "每个 scene.source 保留章节、段落和行号，便于回到原文继续改编。",
      "conflict.level、pacing 与 rhythmStats 可帮助作者判断节奏起伏。"
    ]
  };

  const validation = validateScreenplay(model);
  if (!validation.success) {
    throw new Error(validation.error.issues.map((issue) => issue.message).join("; "));
  }

  return model;
}

function buildScene(
  draft: SceneDraft,
  globalIndex: number,
  characters: CharacterProfile[],
  style: AdaptationStyle
): Scene {
  const text = draft.paragraphs.join("\n");
  const source = makeSource(draft.chapter, draft.paragraphIndexes);
  const chapterCharacters = pickChapterCharacters(text, characters);
  const dialogue = extractDialogue(draft.chapter, chapterCharacters, text);
  const conflictLevel = estimateConflict(text, dialogue.length, style);
  const beatType = inferBeatType(draft);

  return {
    id: `scene-${String(globalIndex).padStart(2, "0")}`,
    chapterIndex: draft.chapter.index,
    beatIndex: draft.beatIndex,
    beatType,
    title: `${draft.chapter.title} / ${buildSceneTitle(draft.paragraphs)}`,
    goal: buildSceneGoal(draft.chapter, beatType, style),
    location: inferLocation(text),
    time: inferTime(text),
    characters: chapterCharacters.map((character) => character.name),
    action: buildActionBeats(draft.paragraphs),
    dialogue,
    narrationOrTransition: buildTransition(draft, style),
    emotion: inferEmotion(text),
    pacing: inferPacing(conflictLevel, beatType, dialogue.length),
    conflict: {
      level: conflictLevel,
      reason: buildConflictReason(conflictLevel, text)
    },
    revisionNotes: buildRevisionNotes(beatType, conflictLevel, dialogue.length),
    source
  };
}

function splitChapterIntoSceneDrafts(chapter: ParsedChapter): SceneDraft[] {
  const paragraphCount = chapter.paragraphs.length;
  if (paragraphCount <= 2) {
    return [
      {
        chapter,
        beatIndex: 1,
        paragraphIndexes: chapter.paragraphs.map((_, index) => index),
        paragraphs: chapter.paragraphs
      }
    ];
  }

  const midpoint = Math.ceil(paragraphCount / 2);
  const chunks = [chapter.paragraphs.slice(0, midpoint), chapter.paragraphs.slice(midpoint)].filter(
    (chunk) => chunk.length > 0
  );

  return chunks.map((paragraphs, index) => {
    const offset = index === 0 ? 0 : midpoint;
    return {
      chapter,
      beatIndex: index + 1,
      paragraphIndexes: paragraphs.map((_, paragraphIndex) => paragraphIndex + offset),
      paragraphs
    };
  });
}

function buildAdaptationPlan(chapters: ParsedChapter[], scenes: Scene[], style: AdaptationStyle) {
  const styleTone: Record<AdaptationStyle, string> = {
    balanced: "悬疑叙事和人物选择并重",
    cinematic: "偏影视化悬疑，重画面、动作和钩子",
    stage: "偏舞台调度，重空间压迫和台词张力",
    short_drama: "偏短剧节奏，重反转和场尾悬念"
  };

  return {
    premise: buildLogline(chapters),
    tone: styleTone[style],
    targetAudience: "需要快速判断改编方向的小说作者、短剧编剧和内容策划",
    structure: chapters.map((chapter) => {
      const sceneCount = scenes.filter((scene) => scene.chapterIndex === chapter.index).length;
      return `${chapter.title}：拆为 ${sceneCount} 个场景，保留章节事件并补足戏剧节奏。`;
    }),
    nextRevisionFocus: [
      "逐场确认人物动机是否清楚。",
      "把 source.excerpt 中的叙述句继续改成可拍摄动作。",
      "优先打磨 highConflictSceneIds 中的场尾钩子。"
    ]
  };
}

function buildStoryDiagnostics(chapters: ParsedChapter[], scenes: Scene[]) {
  const paragraphCount = chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0);
  const strongest = [...scenes].sort((a, b) => b.conflict.level - a.conflict.level)[0];
  const quietScenes = scenes.filter((scene) => scene.pacing === "quiet").length;
  const warnings = [
    chapters.length === 1 ? "当前素材较短，已生成短篇草稿；继续补充正文后可获得更完整的结构判断。" : "",
    quietScenes > scenes.length / 2 ? "低冲突场景偏多，建议增加选择压力或明确阻碍。" : "",
    scenes.some((scene) => scene.dialogue.length === 0) ? "部分场景没有对白，录屏时可展示为动作场。" : ""
  ].filter(Boolean);

  return {
    paragraphCount,
    sourceCoverage: `${chapters.length} 章 / ${paragraphCount} 段原文已映射到 ${scenes.length} 个场景。`,
    strongestConflictSceneId: strongest?.id ?? scenes[0]?.id ?? "scene-01",
    pacingSummary: `共 ${scenes.length} 场，平均冲突 ${(
      scenes.reduce((sum, scene) => sum + scene.conflict.level, 0) / scenes.length
    ).toFixed(2)}，高冲突场景 ${scenes.filter((scene) => scene.conflict.level >= 4).length} 场。`,
    warnings
  };
}

function extractCharacters(chapters: ParsedChapter[]): CharacterProfile[] {
  const counts = new Map<string, { count: number; firstChapter: number }>();

  for (const chapter of chapters) {
    for (const match of collectCharacterCandidates(chapter.text)) {
      if (isIgnoredCharacterCandidate(match)) {
        continue;
      }
      const existing = counts.get(match);
      counts.set(match, {
        count: (existing?.count ?? 0) + 1,
        firstChapter: existing?.firstChapter ?? chapter.index
      });
    }
  }

  const names = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6);

  if (names.length === 0) {
    names.push(["主角", { count: 1, firstChapter: 1 }]);
  }

  return names.map(([name, meta], index) => ({
    id: `char-${index + 1}`,
    name,
    role: index === 0 ? "protagonist" : "supporting",
    traits: index === 0 ? ["推动情节", "承载视角"] : ["制造关系张力"],
    firstSeenChapter: meta.firstChapter,
    relationshipSummary:
      index === 0 ? "主要视角人物，与其他角色共同推动章节目标。" : `与${names[0][0]}形成行动或情绪上的牵引关系。`
  }));
}

function collectCharacterCandidates(text: string): string[] {
  const candidates = new Set<string>();

  for (const sentence of text.split(/[。！？\n]/).map((item) => item.trim()).filter(Boolean)) {
    const patterns = [
      /^([一-龥]{2,4})从[^，。！？]{0,12}(?:走来|走出|出来)/,
      /^([一-龥]{2,4})(?:说|问|答|喊|道|笑道|低声说|声音发紧)/,
      /^([一-龥]{2,4})(?:忽然)?(?:抱着|看着|夺过|举起|拔刀|推门|翻身|把)/,
      /(黑伞男人|许掌柜)(?:忽然|把|拔刀|推门|翻身)?/
    ];

    for (const pattern of patterns) {
      const match = sentence.match(pattern);
      if (match) {
        candidates.add(match[1]);
      }
    }
  }

  return [...candidates];
}

function isIgnoredCharacterCandidate(candidate: string): boolean {
  const ignored = new Set([
    "众人",
    "有人",
    "他们",
    "我们",
    "这个",
    "那个",
    "低声",
    "声音",
    "身后",
    "灯下",
    "账册",
    "街上",
    "里面",
    "码头",
    "钟楼",
    "忽然",
    "举起火",
    "清晨",
    "大雾",
    "夜色",
    "夜色压"
  ]);

  return ignored.has(candidate) || /从|灯|声|门而|边翻|重新|只有|忽然|举起/.test(candidate);
}

function pickChapterCharacters(text: string, characters: CharacterProfile[]) {
  const inChapter = characters.filter((character) => text.includes(character.name));
  return inChapter.length > 0 ? inChapter : characters.slice(0, 1);
}

function extractDialogue(chapter: ParsedChapter, characters: CharacterProfile[], sceneText: string): DialogueBeat[] {
  const dialoguePattern = /[“"]([^”"]{2,80})[”"]/g;
  const beats: DialogueBeat[] = [];
  let match: RegExpExecArray | null;

  while ((match = dialoguePattern.exec(sceneText)) && beats.length < 4) {
    const before = sceneText.slice(Math.max(0, match.index - 40), match.index);
    const speaker = inferDialogueSpeaker(before, characters.map((character) => character.name));
    beats.push({
      speaker,
      line: match[1],
      intent: inferIntent(match[1]),
      emotion: inferEmotion(match[1]),
      source: makeSource(chapter, [findParagraphIndex(chapter, match[1])])
    });
  }

  return beats;
}

function inferDialogueSpeaker(beforeQuote: string, characterNames: string[]): string {
  const sentenceStart = Math.max(
    beforeQuote.lastIndexOf("。"),
    beforeQuote.lastIndexOf("！"),
    beforeQuote.lastIndexOf("？"),
    beforeQuote.lastIndexOf("\n")
  );
  const cue = beforeQuote.slice(sentenceStart + 1);
  const speechVerbMatch = cue.match(/(?:说|问|答|喊|道|笑道|低声说|声音发紧)[:：]?\s*$/);
  const beforeVerb = speechVerbMatch ? cue.slice(0, speechVerbMatch.index) : cue;
  const candidates = characterNames
    .map((name) => ({ name, index: beforeVerb.indexOf(name) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (candidates.length > 0) {
    return candidates[0].name;
  }

  return characterNames.find((name) => cue.includes(name)) ?? characterNames[0] ?? "角色";
}

function makeSource(chapter: ParsedChapter, paragraphIndexes: number[]): SourceLocator {
  const safeIndexes = paragraphIndexes.length > 0 ? paragraphIndexes : [0];
  const excerpt = safeIndexes
    .map((index) => chapter.paragraphs[index])
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);

  return {
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    paragraphIndexes: safeIndexes,
    lineStart: chapter.startLine,
    lineEnd: chapter.endLine,
    excerpt: excerpt || chapter.heading
  };
}

function findParagraphIndex(chapter: ParsedChapter, needle: string): number {
  return Math.max(
    0,
    chapter.paragraphs.findIndex((paragraph) => paragraph.includes(needle))
  );
}

function inferWorkTitle(input: string): string {
  const firstMeaningfulLine = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^第\s*[0-9一二三四五六七八九十百千万]+\s*[章节回幕]/.test(line));

  return firstMeaningfulLine && firstMeaningfulLine.length <= 20 ? firstMeaningfulLine : "未命名改编剧本";
}

function buildLogline(chapters: ParsedChapter[]): string {
  const first = chapters[0];
  const last = chapters[chapters.length - 1];
  return `围绕“${first.title}”开启的事件一路推进到“${last.title}”，人物在连续冲突中完成选择。`;
}

function summarizeParagraphs(paragraphs: string[]): string {
  const text = paragraphs.join(" ");
  return text.length > 72 ? `${text.slice(0, 72)}...` : text || "本章原文较短，需在改编时补足动作和对白。";
}

function buildSceneTitle(paragraphs: string[]): string {
  const firstParagraph = paragraphs[0] ?? "场景";
  return firstParagraph.replace(/[“”"]/g, "").slice(0, 18);
}

function buildSceneGoal(chapter: ParsedChapter, beatType: Scene["beatType"], style: AdaptationStyle): string {
  const styleGoal: Record<AdaptationStyle, string> = {
    balanced: "保留原文关键事件，并转化为可拍摄的场面目标。",
    cinematic: "突出画面调度、人物动作和悬念递进。",
    stage: "强化空间关系、台词节奏和舞台调度。",
    short_drama: "压缩信息密度，让冲突在短场景内快速爆发。"
  };
  const beatGoal: Record<Scene["beatType"], string> = {
    setup: "建立本章人物关系和空间压力。",
    turning_point: "让信息或行动发生转向。",
    payoff: "收束本章事件并留下下一场钩子。"
  };
  return `${styleGoal[style]} ${beatGoal[beatType]} 本场承接“${chapter.title}”。`;
}

function inferLocation(text: string): string {
  const found = knownLocationWords.find((word) => text.includes(word));
  return found ? `原文提示地点：${found}` : "待定内景或外景";
}

function inferTime(text: string): string {
  if (/夜|月|灯|更/.test(text)) return "夜";
  if (/晨|朝|日出/.test(text)) return "清晨";
  if (/午|正阳/.test(text)) return "白天";
  return "时间未明";
}

function inferEmotion(text: string): string {
  if (/怒|恨|冷笑|逼/.test(text)) return "紧张对峙";
  if (/泪|怕|惊|慌/.test(text)) return "惶惑不安";
  if (/笑|喜|暖/.test(text)) return "短暂松弛";
  return "克制推进";
}

function inferIntent(line: string): string {
  if (/[？?]/.test(line)) return "追问信息";
  if (/不|别|休|停/.test(line)) return "阻止对方";
  if (/走|去|来|跟/.test(line)) return "推动行动";
  return "表达态度";
}

function buildActionBeats(paragraphs: string[]): string[] {
  const source = paragraphs.length > 0 ? paragraphs : ["本场需要补写动作。"];
  return source.slice(0, 3).map((paragraph, index) => {
    const cleaned = paragraph.replace(/[“”"][^“”"]+[“”"]/g, "人物对白").slice(0, 64);
    return `${index + 1}. ${cleaned}`;
  });
}

function buildTransition(draft: SceneDraft, style: AdaptationStyle): string {
  if (style === "short_drama") {
    return `短切到第 ${draft.chapter.index}-${draft.beatIndex + 1} 个冲突点，保留悬念钩子。`;
  }
  if (style === "stage") {
    return "灯光收束，人物关系在下一场继续发酵。";
  }
  return draft.beatIndex === 1 ? "以原文关键意象转入本章后半场。" : "以场尾动作或问题转入下一章。";
}

function inferBeatType(draft: SceneDraft): Scene["beatType"] {
  if (draft.beatIndex === 1) return "setup";
  if (draft.paragraphs.some((paragraph) => /秘密|失火|证据|拔刀|锁死|第十一声/.test(paragraph))) {
    return "payoff";
  }
  return "turning_point";
}

function inferPacing(
  conflictLevel: Scene["conflict"]["level"],
  beatType: Scene["beatType"],
  dialogueCount: number
): Scene["pacing"] {
  if (beatType === "payoff" && conflictLevel >= 4) return "cliffhanger";
  if (conflictLevel >= 4) return "tense";
  if (dialogueCount > 0 || conflictLevel >= 3) return "steady";
  return "quiet";
}

function buildRevisionNotes(
  beatType: Scene["beatType"],
  conflictLevel: Scene["conflict"]["level"],
  dialogueCount: number
): string[] {
  const notes = [
    beatType === "setup" ? "确认开场是否快速交代人物处境。" : "确认这一场是否推动了信息或行动变化。",
    conflictLevel < 3 ? "冲突偏弱，可增加阻碍、误会或时间压力。" : "保留冲突来源，后续可强化场尾动作。",
    dialogueCount === 0 ? "当前没有对白，可补一句人物选择或旁白钩子。" : "对白已抽取，建议继续打磨潜台词。"
  ];

  return notes;
}

function estimateConflict(text: string, dialogueCount: number, style: AdaptationStyle): 1 | 2 | 3 | 4 | 5 {
  const keywordHits = conflictWords.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  const styleBoost = style === "short_drama" || style === "cinematic" ? 1 : 0;
  const score = Math.min(5, Math.max(1, 1 + keywordHits + Math.min(dialogueCount, 2) + styleBoost));
  return score as 1 | 2 | 3 | 4 | 5;
}

function buildConflictReason(level: number, text: string): string {
  if (level >= 4) {
    return "原文出现强动作、质问或危险词，适合改编为高冲突场景。";
  }
  if (/[？?]/.test(text)) {
    return "原文包含信息追问，形成中等张力。";
  }
  return "冲突偏内在，建议通过动作和潜台词继续强化。";
}
