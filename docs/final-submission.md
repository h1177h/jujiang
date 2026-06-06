# 剧匠最终提交说明

## 一句话介绍

剧匠把小说文本转换成可编辑、可校验、可复制/下载的结构化剧本 YAML。作者可以先贴一段短篇素材起稿，也可以输入多章长文继续打磨。自动生成依赖 OpenAI-compatible API；没有 AI 时只提供示例 YAML 的查看、编辑和校验。

## 本地演示闭环

1. `npm install`
2. `npm run dev`
3. 打开 Vite 本地地址。
4. 使用内置多章示例，上传 `examples/sample-novel.md`，或直接粘贴一段短篇素材。
5. 如果展示真实 API，先运行 `npm run proxy`，页面勾选“AI 生成”和“本地 proxy”，填写 API Key 或让 proxy 从 `JUJIANG_API_KEY` 读取。
6. 点击“测试连接”，确认本地 proxy 已启动、上游地址和 key 状态正常。
7. 点击“生成结构化剧本 YAML”。
8. 观察生成任务面板，确认连接检查、事件抽取、故事圣经、剧本生成、Schema 修复和 YAML 写入都有阶段状态。
9. 查看页面底部作者审稿台：改编计划、故事诊断、角色关系、节奏指标、章节映射、冲突曲线和质量检查。
10. 点击章节映射、冲突柱或质量检查项，定位到对应场景。
11. 在场景编辑器里修改目标、地点、对白、冲突等级或修订建议，确认 YAML 同步更新。
12. 有真实 API 时，点击“AI 补强”局部重写当前场景，并确认版本历史新增快照。
13. 手动编辑右侧 YAML，观察 Schema 校验提示。
14. 刷新页面，确认标题、原文、YAML、选中场景和版本历史会恢复；再点击重置工作区，回到示例草稿。
15. 保存和恢复一个版本，再点击复制或下载 YAML。
16. 对照 `docs/yaml-schema.md` 讲字段设计。
17. 对照 `docs/reference-analysis.md` 讲参考项目借鉴和独立改写。

## 评分点对应

40% 作品完整度与创新性：

- 短篇片段、多章小说输入和上传。
- 自动章节识别和文本清洗。
- 生成剧本 YAML，字段覆盖作品、角色、章节事件图谱、故事圣经、改编策略、章节映射、场景、动作、对白、转场、情绪、冲突和原文来源。
- YAML 可编辑、可校验、可复制、可下载。
- 非 YAML 场景编辑器可直接修改场景内容，并同步回结构化 YAML。
- 故事分析区支持章节事件图谱、章节到场景映射、冲突曲线和质量检查，点击即可定位场景。
- 无 API key 时保留示例 YAML 的编辑、校验、复制和下载，不伪造剧情生成。
- OpenAI-compatible API 接入，可配置 Base URL、API Key 和 Model。
- API 设置可选择记住在本机浏览器，减少本地反复调试时的输入成本。
- 创作工作区会自动保存在本机浏览器，刷新后可以继续编辑原文、YAML、当前场景和版本历史。
- 本地 API proxy 是推荐调用链路，可使用页面提供的 key，也可从环境变量读取 key，避免浏览器直连 provider 时被 CORS 或系统代理拦截。
- 生成前提供连接测试，能区分 proxy 未启动、proxy 未读到 key 和浏览器直连失败。
- 长篇小说会逐章抽取事件，再合并故事圣经和改编策略，避免把整篇小说直接塞进一次 prompt。
- API 返回结构不完整时，会触发一次 Schema 修复回合，把校验错误反馈给模型修正。
- 生成任务面板会记录每次调用的阶段、耗时、章节进度和失败位置，长篇生成不再是黑盒等待。
- 支持单场 AI 补强，可以只重写当前场景的对白、冲突和场尾钩子，不必整篇重跑。
- 提供轻量版本历史，可保存和恢复关键 YAML 快照。
- 可操作创新点：长篇逐章事件抽取、故事圣经合并、Schema 修复回合、生成任务面板、单场 AI 补强、轻量版本历史、工作区草稿自动保存、章节事件图谱、场景级工作台编辑、章节到场景映射、冲突曲线、质量检查、角色关系摘要、原文追溯、改编风格选择、节奏统计。

40% 开发过程与质量：

- Vite + React + TypeScript + Zod + YAML，结构轻，方便评审阅读。
- 核心逻辑放在 `src/core/`，UI 和转换逻辑分开。
- Zod Schema 和 `docs/yaml-schema.md` 对齐。
- 测试覆盖章节解析、YAML 生成结构、Schema 校验、API provider、场景编辑同步、故事分析，以及角色抽取误判回归。
- 通过多个小 PR 分阶段推进，没有直推 main。

20% 演示与表达：

- `docs/demo-script.md` 提供 3 到 4 分钟录屏脚本。
- `examples/sample-novel.md` 和 `examples/sample-output.yaml` 可直接用于演示。
- README 包含安装、运行、架构和 demo 步骤。
- 已做桌面和移动视口 QA，分场卡片无横向溢出。

## PR 与 commit 分布

- PR #1 `feat(core): add screenplay generation workspace`：工程基础、本地转换、工作台、测试。
- PR #2 `docs(deliverables): add competition materials`：README、Schema 文档、参考分析、demo 脚本。
- PR #3 `feat(ui): add screenplay preview cards`：结构化预览、分场卡片、浏览器 QA。
- PR #4 `fix(parser): avoid false character names`：修复角色抽取误判。
- PR #5 `fix(parser): infer dialogue speakers from speech cues`：修复对白归属。
- PR #6 `docs(submission): add final package summary`：最终提交说明和示例文件。
- PR #7 `feat(workspace): build author review workflow`：多场景拆分、改编计划、故事诊断和作者审稿台。
- PR #8 `feat(api): add openai compatible generation`：OpenAI-compatible API 配置、调用和失败回退。
- PR #9 `feat(workspace): add scene editor sync`：非 YAML 场景编辑和 YAML 同步。
- PR #10 `feat(analysis): add story dashboard`：章节映射、冲突曲线和质量检查。
- PR #11 `feat(api): add local proxy mode`：本地 API proxy 和页面 proxy 模式。
- PR #12 `docs(submission): refresh final summary`：刷新最终说明和验证记录。
- PR #13 `feat(ui): refresh workbench design`：第一次工作台视觉整理。
- PR #14 `feat(ui): rebuild studio layout`：重建作者审稿台、YAML 交付和场景编辑布局。
- PR #15 `style(ui): loosen studio layout density`：降低界面密度，让输入、审稿和交付区更有层次。
- PR #16 `fix(workflow): require ai for screenplay generation`：移除本地规则剧情生成，AI 不可用时不伪造剧本。
- PR #17 `fix(api): add proxy env support`：补本地 proxy、网络代理和重复章节清洗。
- PR #18 `fix(parser): align chapter recognition with generation`：修正章节识别与生成上下文不一致。
- PR #19 `feat(api): add staged story generation`：加入章节事件图谱、故事圣经和两阶段 AI 改编。
- PR #20 `feat(api): persist provider settings`：本机浏览器记住 API 设置。
- PR #21 `fix(api): add provider connection diagnostics`：把本地 proxy 调整为推荐 AI 调用链路，补连接测试和 `Failed to fetch` 分层诊断。
- PR #22 `feat(ai): add longform generation pipeline`：把 AI 生成升级为长篇逐章事件流水线，并加入 Schema 修复回合。
- PR #23 `feat(workspace): add scene regeneration history`：补单场 AI 补强和轻量版本历史。
- PR #24 `feat(workspace): persist local drafts`：补工作区草稿自动保存、恢复和重置。
- 本轮产品打磨：参考成熟项目的任务队列和状态反馈，把 AI 生成过程改成可见的任务面板。

## 已运行验证

- `npm audit`：found 0 vulnerabilities。
- `npm test`：9 个测试文件、41 个测试用例通过。
- `npm run build`：通过。
- proxy health check：`http://127.0.0.1:8787/health` 返回 `ok:true`，可显示 target 和 key 加载状态。
- 本地浏览器 QA：1440px 和 390px 视口检查过，场景编辑器、故事分析区和 YAML 区没有横向溢出。
- Playwright 交互 QA：点击质量检查项可定位到对应场景；勾选“本地 proxy”会自动启用 AI 生成并切换 Base URL。

## 剩余风险

- 自动生成质量依赖真实 AI provider；当前没有离线剧情生成能力。
- 本地 proxy 可读取环境变量 key，也可使用页面填写并保存在本机浏览器的 key；公开演示或共享电脑上建议使用环境变量。
- 浏览器直连 provider 仍可能被 CORS 或网络策略拦截，正式演示建议使用本地 proxy。
- 当前已支持长篇逐章事件抽取和单场补强，但复杂小说仍需要作者继续调整分场边界。
- 版本历史目前是轻量快照，还没有做逐字段差异对比。
- 工作区草稿保存在当前浏览器 localStorage，还不是跨设备项目库；公开演示机器上可用重置工作区清理草稿。
- 角色抽取已经为示例做了回归，但面对更复杂小说仍可能需要 AI 或更强 NLP 补充。
