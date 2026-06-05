import { useMemo, useState, type CSSProperties } from "react";
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileInput,
  KeyRound,
  PencilLine,
  RefreshCw,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import { parse } from "yaml";
import type { AdaptationStyle } from "./core/types";
import type { ScreenplayYaml } from "./core/types";
import { generateScreenplayWithApi } from "./core/aiProvider";
import { sampleNovel } from "./core/sampleNovel";
import { validateScreenplay } from "./core/schema";
import {
  parseDialogueInput,
  parseListInput,
  serializeDialogueInput,
  updateScreenplaySceneYaml,
  type ScenePatch
} from "./core/sceneEditor";
import { analyzeScreenplay, type StoryAnalysis } from "./core/storyAnalysis";
import { generateScreenplayYaml, screenplayToYaml, validateScreenplayYaml } from "./core/yaml";

const styles: { value: AdaptationStyle; label: string }[] = [
  { value: "balanced", label: "均衡" },
  { value: "cinematic", label: "影视感" },
  { value: "stage", label: "舞台" },
  { value: "short_drama", label: "短剧" }
];

export default function App() {
  const [novelText, setNovelText] = useState(sampleNovel);
  const [title, setTitle] = useState("雾港来信");
  const [style, setStyle] = useState<AdaptationStyle>("cinematic");
  const [useApi, setUseApi] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState("https://api.openai.com/v1");
  const [apiModel, setApiModel] = useState("gpt-4.1-mini");
  const [apiKey, setApiKey] = useState("");
  const [generationStatus, setGenerationStatus] = useState("fallback 本地生成就绪");
  const [yamlText, setYamlText] = useState(() =>
    generateScreenplayYaml(sampleNovel, { title: "雾港来信", style: "cinematic" })
  );
  const [copyLabel, setCopyLabel] = useState("复制");

  const validation = useMemo(() => validateScreenplayYaml(yamlText), [yamlText]);
  const preview = useMemo(() => {
    try {
      const parsed = parse(yamlText);
      const result = validateScreenplay(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }, [yamlText]);
  const chapterCount = useMemo(() => {
    const matches = novelText.match(/(^|\n)\s*(第\s*[0-9一二三四五六七八九十百千万]+\s*[章节回幕]|chapter\s+\d+)/gi);
    return matches?.length ?? 0;
  }, [novelText]);
  const sceneCount = preview?.scenes.length ?? 0;

  async function handleGenerate() {
    try {
      if (useApi && apiKey.trim()) {
        setGenerationStatus(`正在调用 ${apiModel}...`);
        const screenplay = await generateScreenplayWithApi(
          {
            baseUrl: apiBaseUrl,
            apiKey,
            model: apiModel
          },
          {
            title,
            style,
            novelText
          }
        );
        setYamlText(screenplayToYaml(screenplay));
        setGenerationStatus(`API 生成完成：${apiModel}`);
        return;
      }

      setYamlText(generateScreenplayYaml(novelText, { title, style }));
      setGenerationStatus(useApi ? "未填写 API key，已使用 fallback 生成" : "fallback 本地生成完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败";
      setYamlText(generateScreenplayYaml(novelText, { title, style }));
      setGenerationStatus(`API 失败，已回退 fallback：${message}`);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(yamlText);
    setCopyLabel("已复制");
    window.setTimeout(() => setCopyLabel("复制"), 1600);
  }

  function handleDownload() {
    const blob = new Blob([yamlText], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title || "jujiang-screenplay"}.yaml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileUpload(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setNovelText(text);
  }

  function handleScenePatch(sceneId: string, patch: ScenePatch) {
    try {
      setYamlText((current) => updateScreenplaySceneYaml(current, sceneId, patch));
      setGenerationStatus(`已同步 ${sceneId} 到 YAML`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "场景同步失败";
      setGenerationStatus(message);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Jujiang</p>
          <h1>剧匠 AI 小说转剧本工作台</h1>
        </div>
        <div className="status-strip">
          <span>{chapterCount} 章识别</span>
          <span>{sceneCount} 场剧本</span>
          <span className={validation.ok ? "valid" : "invalid"}>
            {validation.ok ? "YAML 校验通过" : "YAML 待修正"}
          </span>
        </div>
      </section>

      <section className="product-flow" aria-label="创作流程">
        <span className="active">1. 原文解析</span>
        <span className={sceneCount > 0 ? "active" : ""}>2. 分场改编</span>
        <span className={preview ? "active" : ""}>3. 作者审稿</span>
        <span className={validation.ok ? "active" : ""}>4. YAML 交付</span>
      </section>

      <section className="workspace">
        <section className="panel input-panel" aria-label="小说输入">
          <div className="panel-header">
            <div>
              <h2>小说输入</h2>
              <p>粘贴或上传三章以上文本，可调用 API，也可离线 fallback。</p>
            </div>
            <label className="icon-button file-button" title="上传文本文件">
              <FileInput size={18} />
              <input type="file" accept=".txt,.md" onChange={(event) => handleFileUpload(event.target.files?.[0] ?? null)} />
            </label>
          </div>

          <div className="field-row">
            <label>
              作品名
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              改编风格
              <select value={style} onChange={(event) => setStyle(event.target.value as AdaptationStyle)}>
                {styles.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="api-box">
            <label className="toggle-line">
              <input type="checkbox" checked={useApi} onChange={(event) => setUseApi(event.target.checked)} />
              <span>使用 API 生成</span>
            </label>
            <div className="api-grid">
              <label>
                Base URL
                <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
              </label>
              <label>
                Model
                <input value={apiModel} onChange={(event) => setApiModel(event.target.value)} />
              </label>
            </div>
            <label>
              API Key
              <div className="secret-field">
                <KeyRound size={16} />
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="只保存在当前浏览器页面状态"
                />
              </div>
            </label>
            <p className="status-note">{generationStatus}</p>
          </div>

          <textarea
            className="novel-editor"
            value={novelText}
            onChange={(event) => setNovelText(event.target.value)}
            spellCheck={false}
          />

          <button className="primary-action" type="button" onClick={handleGenerate}>
            <Sparkles size={18} />
            {useApi ? "调用 API 生成剧本 YAML" : "生成结构化剧本 YAML"}
          </button>
        </section>

        <section className="panel output-panel" aria-label="YAML 输出">
          <div className="panel-header">
            <div>
              <h2>可编辑 YAML</h2>
              <p>修改后实时校验 Schema，可复制或下载交付。</p>
            </div>
            <div className="toolbar">
              <button className="icon-button" type="button" onClick={handleGenerate} title="重新生成">
                <RefreshCw size={18} />
              </button>
              <button className="icon-button text-button" type="button" onClick={handleCopy} title="复制 YAML">
                <Clipboard size={18} />
                {copyLabel}
              </button>
              <button className="icon-button text-button" type="button" onClick={handleDownload} title="下载 YAML">
                <Download size={18} />
                下载
              </button>
            </div>
          </div>

          <textarea
            className="yaml-editor"
            value={yamlText}
            onChange={(event) => setYamlText(event.target.value)}
            spellCheck={false}
          />

          <div className={validation.ok ? "validation-box ok" : "validation-box error"}>
            {validation.ok ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
            <div>
              <strong>{validation.ok ? "Schema 校验通过" : "Schema 校验失败"}</strong>
              <p>{validation.ok ? "当前 YAML 可用于复制、下载和继续改写。" : validation.errors.slice(0, 3).join("；")}</p>
            </div>
          </div>
        </section>
      </section>

      <section className="preview-band">
        <article>
          <h2>创新点 1：原文追溯</h2>
          <p>每场戏写入 chapter、paragraph 和 line 范围，作者可以从 YAML 直接回到小说依据。</p>
        </article>
        <article>
          <h2>创新点 2：冲突节奏</h2>
          <p>场景级 conflict.level 与全局 rhythmStats 帮助快速判断三章改编后的节奏起伏。</p>
        </article>
        <article>
          <h2>创新点 3：风格切换</h2>
          <p>均衡、影视感、舞台、短剧四种轻量策略影响场景目标和转场表达。</p>
        </article>
      </section>

      <ScreenplayPreview screenplay={preview} onScenePatch={handleScenePatch} />
    </main>
  );
}

function ScreenplayPreview({
  screenplay,
  onScenePatch
}: {
  screenplay: ScreenplayYaml | null;
  onScenePatch: (sceneId: string, patch: ScenePatch) => void;
}) {
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  if (!screenplay) {
    return (
      <section className="structured-preview empty">
        <div>
          <h2>作者审稿台</h2>
          <p>YAML 校验通过后，这里会显示改编计划、故事诊断和分场审稿卡。</p>
        </div>
      </section>
    );
  }

  const selectedScene =
    screenplay.scenes.find((scene) => scene.id === selectedSceneId) ?? screenplay.scenes[0];
  const applyPatch = (patch: ScenePatch) => onScenePatch(selectedScene.id, patch);
  const analysis = useMemo(() => analyzeScreenplay(screenplay), [screenplay]);

  return (
    <section className="structured-preview" aria-label="作者审稿台">
      <div className="preview-heading">
        <div>
          <p className="eyebrow">Author Review</p>
          <h2>{screenplay.work.title} 审稿台</h2>
        </div>
        <div className="metric-grid">
          <Metric label="场景" value={screenplay.rhythmStats.sceneCount} />
          <Metric label="对白" value={screenplay.rhythmStats.dialogueCount} />
          <Metric label="平均冲突" value={screenplay.rhythmStats.averageConflict} />
        </div>
      </div>

      <div className="brief-grid">
        <article className="brief-card">
          <span>改编方向</span>
          <h3>{screenplay.adaptationPlan.tone}</h3>
          <p>{screenplay.adaptationPlan.premise}</p>
        </article>
        <article className="brief-card">
          <span>来源覆盖</span>
          <h3>{screenplay.storyDiagnostics.sourceCoverage}</h3>
          <p>{screenplay.storyDiagnostics.pacingSummary}</p>
        </article>
        <article className="brief-card">
          <span>下一轮修订</span>
          <ul>
            {screenplay.adaptationPlan.nextRevisionFocus.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>

      <StoryAnalysisPanel
        analysis={analysis}
        selectedSceneId={selectedScene.id}
        onSelectScene={setSelectedSceneId}
      />

      <div className="preview-columns">
        <aside className="character-rail">
          <h3>角色关系</h3>
          {screenplay.characters.slice(0, 5).map((character) => (
            <article key={character.id} className="character-item">
              <strong>{character.name}</strong>
              <span>{character.role}</span>
              <p>{character.relationshipSummary}</p>
            </article>
          ))}
        </aside>

        <div className="scene-review-layout">
          <div className="scene-grid">
            {screenplay.scenes.map((scene) => (
              <button
                key={scene.id}
                className={scene.id === selectedScene.id ? "scene-card selected" : "scene-card"}
                type="button"
                onClick={() => setSelectedSceneId(scene.id)}
              >
              <div className="scene-card-top">
                <span>{scene.id} / {scene.beatType}</span>
                <strong>冲突 {scene.conflict.level}/5</strong>
              </div>
              <h3>{scene.title}</h3>
              <p>{scene.goal}</p>
              <dl>
                <div>
                  <dt>地点</dt>
                  <dd>{scene.location}</dd>
                </div>
                <div>
                  <dt>时间</dt>
                  <dd>{scene.time}</dd>
                </div>
                <div>
                  <dt>人物</dt>
                  <dd>{scene.characters.join("、")}</dd>
                </div>
              </dl>
              <blockquote>{scene.source.excerpt}</blockquote>
              </button>
            ))}
          </div>

          <aside className="scene-inspector">
            <div className="scene-card-top">
              <span>{selectedScene.id}</span>
              <strong>{selectedScene.pacing}</strong>
            </div>
            <div className="editor-heading">
              <PencilLine size={18} />
              <h3>场景编辑器</h3>
            </div>
            <p className="sync-note">修改会立即同步到右侧 YAML，并触发 Schema 校验。</p>

            <label>
              场景标题
              <input
                value={selectedScene.title}
                onChange={(event) => applyPatch({ title: event.target.value })}
              />
            </label>
            <label>
              场景目标
              <textarea
                className="compact-editor"
                value={selectedScene.goal}
                onChange={(event) => applyPatch({ goal: event.target.value })}
              />
            </label>
            <div className="inspector-grid">
              <label>
                地点
                <input
                  value={selectedScene.location}
                  onChange={(event) => applyPatch({ location: event.target.value })}
                />
              </label>
              <label>
                时间
                <input
                  value={selectedScene.time}
                  onChange={(event) => applyPatch({ time: event.target.value })}
                />
              </label>
            </div>
            <div className="inspector-grid">
              <label>
                冲突等级
                <select
                  value={selectedScene.conflict.level}
                  onChange={(event) =>
                    applyPatch({
                      conflict: {
                        ...selectedScene.conflict,
                        level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5
                      }
                    })
                  }
                >
                  {[1, 2, 3, 4, 5].map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                节奏
                <select
                  value={selectedScene.pacing}
                  onChange={(event) => applyPatch({ pacing: event.target.value as ScenePatch["pacing"] })}
                >
                  <option value="quiet">quiet</option>
                  <option value="steady">steady</option>
                  <option value="tense">tense</option>
                  <option value="cliffhanger">cliffhanger</option>
                </select>
              </label>
            </div>
            <label>
              冲突说明
              <textarea
                className="compact-editor"
                value={selectedScene.conflict.reason}
                onChange={(event) =>
                  applyPatch({
                    conflict: {
                      ...selectedScene.conflict,
                      reason: event.target.value
                    }
                  })
                }
              />
            </label>
            <label>
              出场人物
              <textarea
                className="compact-editor"
                value={selectedScene.characters.join("\n")}
                onChange={(event) => applyPatch({ characters: parseListInput(event.target.value) })}
              />
            </label>
            <label>
              动作描写
              <textarea
                className="compact-editor tall"
                value={selectedScene.action.join("\n")}
                onChange={(event) => applyPatch({ action: parseListInput(event.target.value) })}
              />
            </label>
            <label>
              对白
              <textarea
                className="compact-editor tall"
                value={serializeDialogueInput(selectedScene.dialogue)}
                onChange={(event) =>
                  applyPatch({ dialogue: parseDialogueInput(event.target.value, selectedScene) })
                }
              />
            </label>
            <label>
              旁白 / 转场
              <textarea
                className="compact-editor"
                value={selectedScene.narrationOrTransition}
                onChange={(event) => applyPatch({ narrationOrTransition: event.target.value })}
              />
            </label>
            <label>
              情绪
              <input
                value={selectedScene.emotion}
                onChange={(event) => applyPatch({ emotion: event.target.value })}
              />
            </label>
            <label>
              修订建议
              <textarea
                className="compact-editor tall"
                value={selectedScene.revisionNotes.join("\n")}
                onChange={(event) => applyPatch({ revisionNotes: parseListInput(event.target.value) })}
              />
            </label>
            <h4>原文依据</h4>
            <p className="source-note">
              第 {selectedScene.source.chapterIndex} 章，段落 {selectedScene.source.paragraphIndexes.join("、")}，
              行 {selectedScene.source.lineStart}-{selectedScene.source.lineEnd}
            </p>
            <blockquote className="source-excerpt">{selectedScene.source.excerpt}</blockquote>
          </aside>
        </div>
      </div>
    </section>
  );
}

function StoryAnalysisPanel({
  analysis,
  selectedSceneId,
  onSelectScene
}: {
  analysis: StoryAnalysis;
  selectedSceneId: string;
  onSelectScene: (sceneId: string) => void;
}) {
  return (
    <div className="analysis-board" aria-label="故事分析区">
      <article className="analysis-card chapter-map">
        <div className="analysis-card-head">
          <h3>章节到场景</h3>
          <span>{analysis.sourceCoveragePercent}% 覆盖</span>
        </div>
        <div className="chapter-map-list">
          {analysis.chapterCoverage.map((chapter) => (
            <div key={chapter.chapterIndex} className="chapter-map-row">
              <div>
                <strong>第 {chapter.chapterIndex} 章：{chapter.title}</strong>
                <p>{chapter.coverageLabel}</p>
              </div>
              <div className="scene-chip-list">
                {chapter.sceneIds.map((sceneId) => (
                  <button
                    key={sceneId}
                    className={sceneId === selectedSceneId ? "scene-chip active" : "scene-chip"}
                    type="button"
                    onClick={() => onSelectScene(sceneId)}
                  >
                    {sceneId}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="analysis-card conflict-curve">
        <div className="analysis-card-head">
          <h3>冲突曲线</h3>
          <span>{analysis.readySceneCount} 场可继续打磨</span>
        </div>
        <div className="curve-bars">
          {analysis.conflictCurve.map((point) => (
            <button
              key={point.sceneId}
              className={point.sceneId === selectedSceneId ? "curve-bar active" : "curve-bar"}
              style={{ "--level": point.level } as CSSProperties}
              type="button"
              onClick={() => onSelectScene(point.sceneId)}
              title={`${point.sceneId} / ${point.pacing} / 冲突 ${point.level}`}
            >
              <span>{point.level}</span>
              <small>{point.sceneId.replace("scene-", "")}</small>
            </button>
          ))}
        </div>
      </article>

      <article className="analysis-card quality-list">
        <div className="analysis-card-head">
          <h3>质量检查</h3>
          <span>{analysis.qualityIssues.length} 项</span>
        </div>
        {analysis.qualityIssues.length > 0 ? (
          <div className="quality-items">
            {analysis.qualityIssues.slice(0, 6).map((issue) => (
              <button
                key={`${issue.sceneId}-${issue.label}`}
                className={`quality-item ${issue.severity}`}
                type="button"
                onClick={() => onSelectScene(issue.sceneId)}
              >
                <strong>{issue.sceneId} / {issue.label}</strong>
                <span>{issue.detail}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="quality-empty">当前场景结构完整，可以进入下一轮文字打磨。</p>
        )}
      </article>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="metric">
      <strong>{value}</strong>
      {label}
    </span>
  );
}
