# 剧匠最终提交说明

## 一句话介绍

剧匠把三章以上小说文本转换成可编辑、可校验、可复制/下载的结构化剧本 YAML。它不依赖 API key，打开本地页面就能完成 demo。

## 本地演示闭环

1. `npm install`
2. `npm run dev`
3. 打开 Vite 本地地址。
4. 使用内置三章示例，或上传 `examples/sample-novel.md`。
5. 点击“生成结构化剧本 YAML”。
6. 查看右侧 YAML，手动编辑并观察 Schema 校验提示。
7. 查看页面底部角色关系、节奏指标和分场卡片。
8. 点击复制或下载 YAML。
9. 对照 `docs/yaml-schema.md` 讲字段设计。
10. 对照 `docs/reference-analysis.md` 讲参考项目借鉴和独立改写。

## 评分点对应

40% 作品完整度与创新性：

- 三章以上输入和上传。
- 自动章节识别和文本清洗。
- 生成剧本 YAML，字段覆盖作品、角色、章节映射、场景、动作、对白、转场、情绪、冲突和原文来源。
- YAML 可编辑、可校验、可复制、可下载。
- 无 API key fallback demo。
- 展示型创新点：角色关系摘要、冲突强度、原文追溯、改编风格选择、节奏统计、分场卡片预览。

40% 开发过程与质量：

- Vite + React + TypeScript + Zod + YAML，结构轻，方便评审阅读。
- 核心逻辑放在 `src/core/`，UI 和转换逻辑分开。
- Zod Schema 和 `docs/yaml-schema.md` 对齐。
- 测试覆盖章节解析、YAML 生成结构、Schema 校验，以及角色抽取误判回归。
- 通过 4 个 PR 分阶段推进，没有直推 main。

20% 演示与表达：

- `docs/demo-script.md` 提供 3 到 4 分钟录屏脚本。
- `examples/sample-novel.md` 和 `examples/sample-output.yaml` 可直接用于演示。
- README 包含安装、运行、架构和 demo 步骤。
- 已做桌面和移动视口 QA，分场卡片无横向溢出。

## PR 与 commit 分布

- PR #1 `feat(core): add screenplay generation workspace`：工程基础、fallback 转换、工作台、测试。
- PR #2 `docs(deliverables): add competition materials`：README、Schema 文档、参考分析、demo 脚本。
- PR #3 `feat(ui): add screenplay preview cards`：结构化预览、分场卡片、浏览器 QA。
- PR #4 `fix(parser): avoid false character names`：修复角色抽取误判。

## 已运行验证

- `npm audit`：found 0 vulnerabilities。
- `npm test`：通过。
- `npm run build`：通过。
- 本地浏览器 QA：`http://127.0.0.1:5173` 返回 200；1440px 和 390px 视口检查过，没有横向溢出。

## 剩余风险

- 当前 fallback 引擎是启发式规则，适合稳定 demo。真实 AI provider 可以后续接入。
- 每章目前生成一个场景，后续可以扩展成一章多场。
- 角色抽取已经为示例做了回归，但面对更复杂小说仍可能需要 AI 或更强 NLP 补充。
