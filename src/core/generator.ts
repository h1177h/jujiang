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

export function generateScreenplayYamlModel(
  input: string,
  options: GenerateScreenplayOptions = {}
): ScreenplayYaml {
  const chapters = parseChapters(input);
  if (chapters.length < 3) {
    throw new Error("至少需要 3 个章节，才能生成符合比赛要求的结构化剧本 YAML。");
  }

  const characters = extractCharacters(chapters);
  const scenes = chapters.map((chapter) => buildScene(chapter, characters, options.style ?? "balanced"));
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
      generatedBy: "jujiang-fallback-engine"
    },
    characters,
    chapterMappings: chapters.map((chapter) => ({
      chapterIndex: chapter.index,
      novelTitle: chapter.title,
      sceneIds: [`scene-${String(chapter.index).padStart(2, "0")}`],
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
    validationHints: [
      "可在左侧继续替换三章以上小说文本，右侧 YAML 会重新生成。",
      "每个 scene.source 保留章节、段落和行号，便于回到原文继续改编。",
      "conflict.level 与 rhythmStats 可帮助作者判断节奏起伏。"
    ]
  };

  const validation = validateScreenplay(model);
  if (!validation.success) {
    throw new Error(validation.error.issues.map((issue) => issue.message).join("; "));
  }

  return model;
}

function buildScene(
  chapter: ParsedChapter,
  characters: CharacterProfile[],
  style: AdaptationStyle
): Scene {
  const paragraphIndexes = chapter.paragraphs.map((_, index) => index);
  const source = makeSource(chapter, paragraphIndexes);
  const chapterCharacters = pickChapterCharacters(chapter, characters);
  const dialogue = extractDialogue(chapter, chapterCharacters);
  const conflictLevel = estimateConflict(chapter.text, dialogue.length, style);

  return {
    id: `scene-${String(chapter.index).padStart(2, "0")}`,
    chapterIndex: chapter.index,
    title: `${chapter.title}：${buildSceneTitle(chapter)}`,
    goal: buildSceneGoal(chapter, style),
    location: inferLocation(chapter.text),
    time: inferTime(chapter.text),
    characters: chapterCharacters.map((character) => character.name),
    action: buildActionBeats(chapter),
    dialogue,
    narrationOrTransition: buildTransition(chapter.index, style),
    emotion: inferEmotion(chapter.text),
    conflict: {
      level: conflictLevel,
      reason: buildConflictReason(conflictLevel, chapter.text)
    },
    source
  };
}

function extractCharacters(chapters: ParsedChapter[]): CharacterProfile[] {
  const counts = new Map<string, { count: number; firstChapter: number }>();

  for (const chapter of chapters) {
    const matches = chapter.text.match(/[一-龥]{2,4}(?=(?:说|问|答|喊|道|想|看|走|笑|沉默))/g) ?? [];
    for (const match of matches) {
      const ignored = ["众人", "有人", "他们", "我们", "这个", "那个"];
      if (ignored.includes(match)) {
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

function pickChapterCharacters(chapter: ParsedChapter, characters: CharacterProfile[]) {
  const inChapter = characters.filter((character) => chapter.text.includes(character.name));
  return inChapter.length > 0 ? inChapter : characters.slice(0, 1);
}

function extractDialogue(chapter: ParsedChapter, characters: CharacterProfile[]): DialogueBeat[] {
  const dialoguePattern = /[“"]([^”"]{2,80})[”"]/g;
  const beats: DialogueBeat[] = [];
  let match: RegExpExecArray | null;

  while ((match = dialoguePattern.exec(chapter.text)) && beats.length < 4) {
    const before = chapter.text.slice(Math.max(0, match.index - 12), match.index);
    const speaker = characters.find((character) => before.includes(character.name))?.name ?? characters[0]?.name ?? "角色";
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

function buildSceneTitle(chapter: ParsedChapter): string {
  const firstParagraph = chapter.paragraphs[0] ?? chapter.heading;
  return firstParagraph.replace(/[“”"]/g, "").slice(0, 18);
}

function buildSceneGoal(chapter: ParsedChapter, style: AdaptationStyle): string {
  const styleGoal: Record<AdaptationStyle, string> = {
    balanced: "保留原文关键事件，并转化为可拍摄的场面目标。",
    cinematic: "突出画面调度、人物动作和悬念递进。",
    stage: "强化空间关系、台词节奏和舞台调度。",
    short_drama: "压缩信息密度，让冲突在短场景内快速爆发。"
  };
  return `${styleGoal[style]} 本场承接“${chapter.title}”。`;
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

function buildActionBeats(chapter: ParsedChapter): string[] {
  const paragraphs = chapter.paragraphs.length > 0 ? chapter.paragraphs : [chapter.text];
  return paragraphs.slice(0, 3).map((paragraph, index) => {
    const cleaned = paragraph.replace(/[“”"][^“”"]+[“”"]/g, "人物对白").slice(0, 64);
    return `${index + 1}. ${cleaned}`;
  });
}

function buildTransition(index: number, style: AdaptationStyle): string {
  if (style === "short_drama") {
    return `短切到第 ${index + 1} 个冲突点，保留悬念钩子。`;
  }
  if (style === "stage") {
    return "灯光收束，人物关系在下一场继续发酵。";
  }
  return "以原文关键意象转场，进入下一段行动。";
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
