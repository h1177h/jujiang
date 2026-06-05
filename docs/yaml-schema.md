# 剧匠 YAML Schema 设计

本文定义剧匠生成的结构化剧本 YAML。Schema 的目标不是复刻传统剧本格式，而是给小说作者一个可继续编辑、可校验、可追溯的改编初稿。

## 顶层结构

```yaml
work:
  title: 雾港来信
  adaptationStyle: cinematic
  logline: 围绕“迟到的渡船”开启的事件一路推进到“雾中的钟声”，人物在连续冲突中完成选择。
  sourceChapterCount: 3
  generatedBy: jujiang-fallback-engine
characters: []
chapterMappings: []
scenes: []
rhythmStats: {}
validationHints: []
```

必填顶层字段：

- `work`：作品元信息。
- `characters`：角色表。
- `chapterMappings`：小说章节到剧本场景的映射。
- `scenes`：场景列表。
- `rhythmStats`：节奏统计。
- `validationHints`：给作者的校验和改写提示。

## work

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `title` | 是 | string | 改编作品名。 |
| `adaptationStyle` | 是 | enum | `balanced`、`cinematic`、`stage`、`short_drama`。 |
| `logline` | 是 | string | 一句话概括核心推进。 |
| `sourceChapterCount` | 是 | number | 原文识别出的章节数量，比赛要求至少为 3。 |
| `generatedBy` | 是 | literal | 当前固定为 `jujiang-fallback-engine`，便于区分后续 AI provider。 |

设计原因：作品元信息必须能解释这份 YAML 的来源、风格和输入规模。`generatedBy` 保留生成来源，后续接入真实 AI 时可以追踪版本。

## characters

```yaml
characters:
  - id: char-1
    name: 林砚
    role: protagonist
    traits:
      - 推动情节
      - 承载视角
    firstSeenChapter: 1
    relationshipSummary: 主要视角人物，与其他角色共同推动章节目标。
```

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | string | 稳定角色 ID。 |
| `name` | 是 | string | 角色名。 |
| `role` | 是 | enum | `protagonist`、`supporting`、`unknown`。 |
| `traits` | 是 | string[] | 改编时可用的人物标签。 |
| `firstSeenChapter` | 是 | number | 首次出现章节。 |
| `relationshipSummary` | 是 | string | 角色关系摘要。 |

设计原因：角色表让后续场景引用更稳定，也能作为展示创新点。`relationshipSummary` 比单纯列名字更接近作者改稿时需要的信息。

## chapterMappings

```yaml
chapterMappings:
  - chapterIndex: 1
    novelTitle: 迟到的渡船
    sceneIds:
      - scene-01
    summary: 夜色压在雾港的石桥上...
    sourceLines:
      - 3
      - 7
```

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `chapterIndex` | 是 | number | 原文章节序号。 |
| `novelTitle` | 是 | string | 原文章节标题。 |
| `sceneIds` | 是 | string[] | 该章节生成的场景 ID。 |
| `summary` | 是 | string | 章节摘要。 |
| `sourceLines` | 是 | tuple | 原文起止行。 |

设计原因：章节映射是“小说 -> 剧本”的桥，能让评审清楚看到三章以上输入如何被转成场景。

## scenes

```yaml
scenes:
  - id: scene-01
    chapterIndex: 1
    title: 迟到的渡船：夜色压在雾港的石桥上
    goal: 突出画面调度、人物动作和悬念递进。本场承接“迟到的渡船”。
    location: 原文提示地点：桥
    time: 夜
    characters:
      - 林砚
      - 沈知夏
    action:
      - 1. 夜色压在雾港的石桥上，林砚抱着旧皮箱...
    dialogue:
      - speaker: 沈知夏
        line: 你不该回来。
        intent: 表达态度
        emotion: 克制推进
        source:
          chapterIndex: 1
          chapterTitle: 迟到的渡船
          paragraphIndexes: [1]
          lineStart: 3
          lineEnd: 7
          excerpt: 沈知夏从灯下走来，低声说：“你不该回来。”
    narrationOrTransition: 以原文关键意象转场，进入下一段行动。
    emotion: 紧张对峙
    conflict:
      level: 4
      reason: 原文出现强动作、质问或危险词，适合改编为高冲突场景。
    source:
      chapterIndex: 1
      chapterTitle: 迟到的渡船
      paragraphIndexes: [0, 1, 2, 3]
      lineStart: 3
      lineEnd: 7
      excerpt: 夜色压在雾港的石桥上...
```

场景字段说明：

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | string | 场景 ID。 |
| `chapterIndex` | 是 | number | 来源章节。 |
| `title` | 是 | string | 场景标题。 |
| `goal` | 是 | string | 本场戏的改编目标。 |
| `location` | 是 | string | 地点。 |
| `time` | 是 | string | 时间。 |
| `characters` | 是 | string[] | 出场人物。 |
| `action` | 是 | string[] | 动作描写。 |
| `dialogue` | 是 | object[] | 对白列表，可以为空数组但结构固定。 |
| `narrationOrTransition` | 是 | string | 旁白或转场。 |
| `emotion` | 是 | string | 情绪状态。 |
| `conflict.level` | 是 | 1-5 | 冲突强度。 |
| `conflict.reason` | 是 | string | 冲突强度判断原因。 |
| `source` | 是 | object | 原文来源定位。 |

设计原因：场景是最适合编辑和演示的单位，因此字段既覆盖传统剧本要素，也加入 `goal`、`emotion`、`conflict`、`source` 等辅助改稿字段。

## source

`source` 出现在场景和对白中，用来保存原文追溯信息。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `chapterIndex` | 是 | number | 来源章节序号。 |
| `chapterTitle` | 是 | string | 来源章节标题。 |
| `paragraphIndexes` | 是 | number[] | 来源段落下标。 |
| `lineStart` | 是 | number | 来源起始行。 |
| `lineEnd` | 是 | number | 来源结束行。 |
| `excerpt` | 是 | string | 原文摘录。 |

设计原因：小说改编常见问题是“生成结果看起来合理，但找不到依据”。原文追溯让作者能从 YAML 回到小说段落继续修订。

## rhythmStats

```yaml
rhythmStats:
  sceneCount: 3
  dialogueCount: 6
  averageConflict: 3.67
  highConflictSceneIds:
    - scene-02
    - scene-03
```

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `sceneCount` | 是 | number | 总场景数。 |
| `dialogueCount` | 是 | number | 对白数量。 |
| `averageConflict` | 是 | number | 平均冲突强度。 |
| `highConflictSceneIds` | 是 | string[] | 高冲突场景 ID。 |

设计原因：节奏统计是剧匠的展示型创新点之一。它不替代作者判断，但能帮助快速发现三章改编是否平铺直叙。

## 校验规则

当前实现使用 `src/core/schema.ts` 中的 Zod Schema 校验：

- `work.sourceChapterCount` 至少为 3。
- `characters` 至少 1 个角色。
- `chapterMappings` 至少 3 个章节映射。
- `scenes` 至少 3 个场景。
- 每个 scene 必须有目标、地点、时间、人物、动作、情绪、冲突和来源定位。
- `conflict.level` 必须为 1 到 5 的整数。

## 后续扩展

- 增加真实 AI provider 后，可将 `generatedBy` 扩展为 provider/version。
- 增加多场景拆分后，`chapterMappings.sceneIds` 可以映射到多个 scene。
- 增加视觉分镜能力后，可在 scene 下追加 `shots` 字段，但不影响现有 YAML 的兼容性。
