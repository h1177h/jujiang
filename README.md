# 剧匠 Jujiang

剧匠是一个轻量的 AI 小说转剧本工作台。它把三章以上小说文本转换成可编辑、可校验、可复制/下载的结构化剧本 YAML，让作者先拿到能继续打磨的改编初稿。

当前版本支持 OpenAI-compatible API 生成，也保留无 API key 的 fallback 引擎。比赛现场即使没有网络，也能完成章节识别、多场景拆分、角色摘要、冲突节奏、改编诊断和原文追溯。

## 功能

- 输入或上传三章以上小说文本。
- 自动识别章节并清洗文本。
- 生成结构化剧本 YAML，包含作品元信息、角色表、章节映射、场景列表、场景目标、地点、时间、出场人物、动作、对白、旁白/转场、情绪/冲突和原文来源定位。
- 提供非 YAML 的场景编辑器，可修改场景目标、地点、时间、人物、动作、对白、转场、冲突等级和修订建议，并同步回 YAML。
- 提供故事分析区，可点击查看章节到场景映射、冲突曲线和场景质量检查。
- 提供可编辑 YAML 区域，编辑后实时 Schema 校验。
- 支持复制和下载 YAML。
- 内置三章示例小说《雾港来信》，无 API key 也能演示。
- 可填写 Base URL、API Key 和 Model，调用兼容 `/v1/chat/completions` 的模型生成剧本。
- 可选本地 API proxy：API key 放在环境变量里，前端只请求 `http://127.0.0.1:8787/v1`。
- 创新点：场景级工作台编辑、章节到场景映射、冲突曲线、质量检查、角色关系摘要、原文追溯、改编风格选择、节奏统计、改编计划。

## 技术栈

- Vite + React + TypeScript：轻量前端工作台。
- Zod：剧本结构校验。
- YAML：结构化剧本序列化与编辑。
- Vitest：核心转换逻辑测试。

## 安装与运行

```bash
npm install
npm run dev
```

浏览器打开 Vite 输出的本地地址后，可以直接使用内置示例生成 YAML。

如需通过本地 proxy 调用真实模型：

```bash
$env:JUJIANG_API_KEY="你的 API Key"
$env:JUJIANG_API_BASE_URL="https://api.openai.com/v1"
npm run proxy
```

然后在页面里勾选“使用 API 生成”和“使用本地 proxy”。前端会请求 `http://127.0.0.1:8787/v1/chat/completions`，真实 key 不会填进浏览器表单。

## 验证命令

```bash
npm audit
npm test
npm run build
```

当前已验证结果：

- `npm audit`：found 0 vulnerabilities。
- `npm test`：3 个测试文件、10 个测试用例通过。
- `npm run build`：TypeScript 检查和 Vite 生产构建通过。

## 架构

```text
src/
  App.tsx                  # 工作台 UI
  core/
    chapters.ts            # 章节识别与文本清洗
    generator.ts           # fallback 剧本生成引擎
    schema.ts              # Zod Schema 校验
    sceneEditor.ts         # 场景编辑与 YAML 同步
    storyAnalysis.ts       # 章节映射、冲突曲线和质量检查
    yaml.ts                # YAML 序列化与解析校验
    sampleNovel.ts         # 三章示例小说
    types.ts               # 剧本数据结构
    __tests__/             # 核心测试
scripts/
  api-proxy.mjs             # 本地 OpenAI-compatible API proxy
docs/
  yaml-schema.md           # YAML Schema 说明
  reference-analysis.md    # 参考项目分析与 no copied code 说明
  demo-script.md           # 比赛演示脚本
```

## Demo 步骤

1. 运行 `npm run dev`。
2. 打开本地页面，确认左侧已有三章示例小说。
3. 切换改编风格，例如“影视感”或“短剧”。
4. 如需真实 AI 生成，可直接填写 Base URL、API Key 和 Model；也可以先运行 `npm run proxy`，再勾选“使用本地 proxy”。
5. 点击“生成结构化剧本 YAML”。
6. 在右侧查看并编辑 YAML，确认校验状态实时变化。
7. 查看页面底部作者审稿台：改编计划、故事诊断、角色关系和节奏指标。
8. 在故事分析区点击章节映射、冲突曲线或质量检查项，定位到对应场景。
9. 在场景编辑器里修改目标、地点、对白或冲突等级，确认右侧 YAML 和校验状态同步更新。
10. 点击复制或下载 YAML。
11. 对照 [YAML Schema 文档](docs/yaml-schema.md) 解释字段设计。
12. 展示 [参考项目分析](docs/reference-analysis.md) 中的独立改写说明。

## 文档

- [YAML Schema 设计](docs/yaml-schema.md)
- [参考项目分析](docs/reference-analysis.md)
- [Demo 脚本](docs/demo-script.md)
- [最终提交说明](docs/final-submission.md)

示例文件：

- [示例小说输入](examples/sample-novel.md)
- [示例 YAML 输出](examples/sample-output.yaml)

## 开发原则

剧匠没有复制或 vendor 参考项目代码。参考项目只用于理解成熟产品的流程、边界和演示方式；本仓库的数据结构、转换逻辑、UI 和文档均围绕比赛题目独立实现。
