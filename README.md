# 剧匠 Jujiang

剧匠是一个轻量的 AI 小说转剧本工作台。配置 AI 后，它可以从一段试写、一个短篇片段或多章小说开始，生成可编辑、可校验、可复制/下载的结构化剧本 YAML，让作者先拿到能继续打磨的改编初稿。

当前版本支持 OpenAI-compatible API 生成。没有配置 AI 时，页面只提供示例 YAML 的查看、编辑和校验，不会用本地规则伪造剧情理解。

## 功能

- 输入或上传小说文本：短篇片段和多章长文都可以交给 AI 生成剧本草稿。
- 自动识别章节并清洗文本。
- AI 生成采用分层流水线：短篇走事件图谱 + 剧本生成；长篇会逐章抽取事件，再合并故事圣经和改编策略，最后生成完整剧本 YAML。
- 生成任务面板会记录 AI 调用的阶段、耗时、章节进度和失败位置；失败任务可直接重试，最近生成记录会随工作区草稿一起恢复。
- 生成结构化剧本 YAML，包含作品元信息、角色表、章节映射、场景列表、场景目标、地点、时间、出场人物、动作、对白、旁白/转场、情绪/冲突和原文来源定位。
- 提供非 YAML 的场景编辑器，可修改场景目标、地点、时间、人物、动作、对白、转场、冲突等级和修订建议，并同步回 YAML。
- 支持选中单场后用 AI 补强对白、冲突压力和场尾钩子，不必整篇重新生成。
- 提供故事分析区，可点击查看章节事件图谱、章节到场景映射、冲突曲线和场景质量检查。
- 提供可编辑 YAML 区域，编辑后实时 Schema 校验。
- 支持复制、下载 YAML，并保留轻量版本历史，可保存、恢复和对比关键版本。
- 工作区草稿会自动保存在本机浏览器：小说正文、标题、改编风格、YAML、选中场景、版本历史和生成记录刷新后仍可恢复，也可以一键重置工作区。
- 内置多章示例小说《雾港来信》和示例 YAML，无 API key 也能演示编辑、校验、复制和下载。
- 可选择 Provider，填写 Base URL、API Key 和 Model，调用兼容 `/v1/chat/completions` 的模型生成剧本；整套 API 配置可记住在本机浏览器。
- 页面始终通过应用内 AI 服务转发到当前 Provider，上游 Base URL 会随请求传入服务端，避免“页面填了但实际没用”的配置错位。
- 支持“测试连接”：生成前会检查应用内 AI 服务、当前上游地址和 API Key 状态。
- API 返回结构不完整时，会把 Schema 错误反馈给模型尝试修复一次，不直接吞掉坏结果。
- 创新点：长篇逐章事件抽取、故事圣经合并、Schema 修复回合、生成任务面板、单场 AI 补强、轻量版本历史与版本对比、工作区草稿自动保存、章节事件图谱、场景级工作台编辑、章节到场景映射、冲突曲线、质量检查、角色关系摘要、原文追溯、改编风格选择、节奏统计、改编计划。

## 技术栈

- Vite + React + TypeScript：轻量前端工作台。
- Zod：剧本结构校验。
- YAML：结构化剧本序列化与编辑。
- Vitest：核心转换逻辑测试。

## 安装与运行

```bash
npm install
npm run dev:app
```

浏览器打开 Vite 输出的本地地址后，可以先查看和编辑内置示例 YAML。自动生成需要配置 AI。

`npm run dev:app` 会同时启动前端工作台和应用内 AI 服务。页面里只需要选择 Provider，填写 Base URL、Model 和 API Key，然后点击“测试连接”或直接生成；不需要再理解浏览器直连、CORS 或 proxy 端口。

内置 Provider 预设：

- OpenAI-compatible：适合大多数中转站或自建兼容服务。
- OpenAI：默认 `https://api.openai.com/v1`。
- DeepSeek：默认 `https://api.deepseek.com/v1`。
- Qwen compatible：默认 DashScope 兼容模式。
- Doubao / Volcengine：默认火山方舟兼容地址。

勾选“记住 API Key”后，剧匠会把 Provider、Base URL、Model 和 API Key 写入本机浏览器的 `localStorage`，下次打开同一浏览器会自动带出。公开演示或共享电脑上，可以不在页面保存 key，改用环境变量：

```bash
$env:JUJIANG_API_KEY="你的 API Key"
$env:JUJIANG_API_BASE_URL="https://api.openai.com/v1"
npm run dev:app
```

页面填写的 Base URL 优先级高于 `JUJIANG_API_BASE_URL`。环境变量更适合固定演示环境；普通作者只需要在页面里配置一次。

如果你的网络需要代理，可以显式传给应用内 AI 服务：

```bash
$env:JUJIANG_NETWORK_PROXY="http://127.0.0.1:7897"
npm run dev:app
```

`JUJIANG_NETWORK_PROXY` 优先级高于 `HTTPS_PROXY` / `HTTP_PROXY`。生成前可以先点击“测试连接”，确认应用服务、上游地址和 key 状态正常。

如果 `18787` 端口被其他本地服务占用，可以改端口启动应用内 AI 服务：

```bash
$env:JUJIANG_PROXY_PORT="18788"
npm run dev:app
```

当前页面默认使用 `18787`；如需自定义端口，需要同步调整代码或环境中的应用网关地址。日常演示建议保持默认端口，避免误连到其他本地服务。

创作工作区也会自动保存到同一浏览器的 `localStorage`：标题、原文、改编风格、YAML、当前场景和版本历史都会随编辑更新。页面右上角的重置按钮只重置工作区草稿，不会清除 API 设置。

## 验证命令

```bash
npm audit
npm test
npm run build
```

当前已验证结果：

- `npm audit`：found 0 vulnerabilities。
- `npm test`：9 个测试文件、46 个测试用例通过。
- `npm run build`：TypeScript 检查和 Vite 生产构建通过。

## 架构

```text
src/
  App.tsx                  # 工作台 UI
  core/
    chapters.ts            # 章节识别与文本清洗
    apiSettings.ts         # 浏览器端 AI 设置持久化
    workspaceDraft.ts      # 本机工作区草稿持久化
    generationRun.ts       # 生成任务阶段、失败、完成和历史状态
    schema.ts              # Zod Schema 校验
    sceneEditor.ts         # 场景编辑与 YAML 同步
    storyAnalysis.ts       # 章节映射、冲突曲线和质量检查
    yaml.ts                # YAML 序列化与解析校验
    sampleNovel.ts         # 多章示例小说
    types.ts               # 剧本数据结构
    __tests__/             # 核心测试
scripts/
  api-proxy.mjs             # 应用内 OpenAI-compatible AI 服务
docs/
  yaml-schema.md           # YAML Schema 说明
  reference-analysis.md    # 参考项目分析与 no copied code 说明
  demo-script.md           # 比赛演示脚本
```

## Demo 步骤

1. 运行 `npm run dev:app`。
2. 打开本地页面，确认左侧已有示例小说，也可以直接粘贴短篇片段。
3. 切换改编风格，例如“影视感”或“短剧”。
4. 如需真实 AI 生成，在 AI 配置区选择 Provider，确认 Base URL 和 Model，填写 API Key；勾选“记住 API Key”后刷新页面仍会保留。
5. 点击“生成结构化剧本 YAML”。
6. 观察生成任务面板：连接、事件抽取、故事圣经、剧本生成、Schema 修复和 YAML 写入都会留下状态；失败后可以保留记录并直接重试。
7. 在右侧查看并编辑 YAML，确认校验状态实时变化。
8. 查看页面底部作者审稿台：改编计划、章节事件图谱、故事诊断、角色关系和节奏指标。
9. 在故事分析区点击章节事件、章节映射、冲突曲线或质量检查项，定位到对应场景。
10. 在场景编辑器里修改目标、地点、对白或冲突等级，确认右侧 YAML 和校验状态同步更新。
11. 有真实 API 时，点击“AI 补强”只重写当前场景，确认 YAML 和版本历史更新；在版本历史里选择旧版本，查看当前 YAML 相比旧版新增、删除和变更的行。
12. 刷新页面，确认原文、YAML、选中场景、版本历史和生成记录仍在；再点击重置工作区，确认可以回到示例草稿。
13. 点击保存、恢复版本、复制或下载 YAML。
14. 对照 [YAML Schema 文档](docs/yaml-schema.md) 解释字段设计。
15. 展示 [参考项目分析](docs/reference-analysis.md) 中的独立改写说明。

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
