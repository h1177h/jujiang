# 剧匠 Demo 脚本

目标：用 3 到 4 分钟展示“输入三章小说 -> 生成 YAML -> 校验 -> 编辑 -> 复制/下载 -> 解释创新点”的完整闭环。

## 准备

```bash
npm install
npm run dev
```

浏览器打开 Vite 本地地址。建议录制前先运行：

```bash
npm audit
npm test
npm run build
```

## 讲解顺序

### 1. 开场

“这是剧匠，一个小说转结构化剧本 YAML 的轻量工作台。它的重点不是直接生成视频，而是先给作者一个可编辑、可校验、可追溯的剧本初稿。”

展示页面左侧三章示例小说《雾港来信》。

### 2. 输入与风格

说明左侧可以粘贴或上传 `.txt/.md` 小说文本，当前示例已经包含三章。

切换一次改编风格，例如从“影视感”切到“短剧”，说明风格会影响场景目标和转场表达。

### 3. 生成 YAML

点击“生成结构化剧本 YAML”。

讲解右侧 YAML 的核心结构：

- `work`：作品元信息和改编风格。
- `characters`：角色表和角色关系摘要。
- `chapterMappings`：三章小说到场景的映射。
- `scenes`：每场戏的目标、地点、时间、人物、动作、对白、转场、情绪、冲突和来源定位。
- `rhythmStats`：场景数、对白数、平均冲突和高冲突场景。

### 4. 校验与编辑

在 YAML 中临时删除一个必填字段，例如删除某个 scene 的 `goal`。

展示校验失败提示。

撤回或补回字段，展示“Schema 校验通过”。

### 5. 原文追溯

定位到任意 scene 的 `source`：

- `chapterIndex`
- `chapterTitle`
- `paragraphIndexes`
- `lineStart`
- `lineEnd`
- `excerpt`

讲解：“这让作者知道每场戏来自原文哪里，不是凭空生成。”

### 6. 复制与下载

点击复制按钮，再点击下载按钮，说明 YAML 可以交给作者继续编辑，也可以进入后续剧本或分镜流程。

### 7. 文档与质量

打开 README 和 `docs/yaml-schema.md`，说明字段设计和运行方式。

打开 `docs/reference-analysis.md`，说明参考项目只用于产品流程分析，没有复制代码、Prompt、Schema 或样式。

最后展示命令验证结果：

- `npm audit`：0 vulnerabilities。
- `npm test`：测试通过。
- `npm run build`：构建通过。

## 评分点对应

- 作品完整度与创新性：三章输入、自动转换、可编辑 YAML、实时校验、复制下载、角色关系、冲突强度、原文追溯、风格选择。
- 开发过程与质量：轻量架构、Zod Schema、Vitest 覆盖章节解析/YAML 生成/Schema 校验、PR 分阶段提交。
- 演示与表达：内置示例确保无 API key 可录制，Demo 顺序覆盖完整闭环。

## 备用说明

如果网络或 API key 不可用，仍然使用 fallback 引擎完成演示。真实 AI provider 是后续扩展点，不影响当前比赛闭环。
