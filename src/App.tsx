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
import { countChapters } from "./core/chapters";
import type { AdaptationStyle, Scene, ScreenplayYaml } from "./core/types";
import { generateScreenplayWithApi } from "./core/aiProvider";
import { generateWorkspaceDraft } from "./core/generationWorkflow";
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
import { screenplayToYaml, validateScreenplayYaml } from "./core/yaml";
import sampleOutputYaml from "../examples/sample-output.yaml?raw";

const styles: { value: AdaptationStyle; label: string }[] = [
  { value: "balanced", label: "均衡" },
  { value: "cinematic", label: "影视感" },
  { value: "stage", label: "舞台" },
  { value: "short_drama", label: "短剧" }
];
const directApiBaseUrl = "https://api.openai.com/v1";
const localProxyBaseUrl = "http://127.0.0.1:8787/v1";

export default function App() {
  const [novelText, setNovelText] = useState(sampleNovel);
  const [title, setTitle] = useState("雾港来信");
  const [style, setStyle] = useState<AdaptationStyle>("cinematic");
  const [useApi, setUseApi] = useState(false);
  const [useLocalProxy, setUseLocalProxy] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(directApiBaseUrl);
  const [apiModel, setApiModel] = useState("gpt-4.1-mini");
  const [apiKey, setApiKey] = useState("");
  const [generationStatus, setGenerationStatus] = useState("请配置 AI 后生成剧本");
  const [yamlText, setYamlText] = useState(sampleOutputYaml);
  const [copyLabel, setCopyLabel] = useState("复制");
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

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
    return countChapters(novelText);
  }, [novelText]);
  const sceneCount = preview?.scenes.length ?? 0;
  const selectedScene =
    preview?.scenes.find((scene) => scene.id === selectedSceneId) ?? preview?.scenes[0] ?? null;

  async function handleGenerate() {
    const apiKeyForRequest = useLocalProxy ? "proxy-managed-key" : apiKey.trim();
    const apiReady = Boolean(apiKeyForRequest);
    setGenerationStatus(useApi && apiReady ? `正在调用 ${apiModel}...` : "等待 AI 配置...");

    const result = await generateWorkspaceDraft(
      {
        title,
        style,
        novelText,
        useApi,
        apiReady,
        model: apiModel
      },
      () =>
        generateScreenplayWithApi(
          {
            baseUrl: apiBaseUrl,
            apiKey: apiKeyForRequest,
            model: apiModel
          },
          {
            title,
            style,
            novelText
          }
        )
    );

    if (result.screenplay) {
      setYamlText(screenplayToYaml(result.screenplay));
      setSelectedSceneId(result.screenplay.scenes[0]?.id ?? null);
    }
    setGenerationStatus(result.status);
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
      setSelectedSceneId(sceneId);
      setGenerationStatus(`已同步 ${sceneId} 到 YAML`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "场景同步失败";
      setGenerationStatus(message);
    }
  }

  function handleProxyToggle(checked: boolean) {
    setUseLocalProxy(checked);
    if (checked) {
      setUseApi(true);
    }
    if (checked && apiBaseUrl === directApiBaseUrl) {
      setApiBaseUrl(localProxyBaseUrl);
    }
    if (!checked && apiBaseUrl === localProxyBaseUrl) {
      setApiBaseUrl(directApiBaseUrl);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Jujiang Studio</p>
          <h1>剧匠 AI 小说转剧本工作台</h1>
        </div>
        <div className="status-strip">
          <span>{chapterCount} 章识别</span>
          <span>{sceneCount} 场剧本</span>
          <span className={validation.ok ? "valid" : "invalid"}>
            {validation.ok ? "YAML 校验通过" : "YAML 待修正"}
          </span>
        </div>
      </header>

      <section className="studio-shell">
        <aside className="source-rail" aria-label="原文与生成设置">
          <section className="panel input-panel">
            <div className="panel-header">
              <div>
                <p className="section-kicker">Source</p>
                <h2>原文与生成设置</h2>
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
              <div className="switch-row">
                <label className="toggle-line">
                  <input type="checkbox" checked={useApi} onChange={(event) => setUseApi(event.target.checked)} />
                  <span>AI 生成</span>
                </label>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={useLocalProxy}
                    onChange={(event) => handleProxyToggle(event.target.checked)}
                  />
                  <span>本地 proxy</span>
                </label>
              </div>
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
                    disabled={useLocalProxy}
                    placeholder={useLocalProxy ? "由本地 proxy 从环境变量读取" : "只保存在当前浏览器页面状态"}
                  />
                </div>
              </label>
              <p className="status-note">
                {useLocalProxy
                  ? "本地 proxy 需先运行 npm run proxy，并设置 JUJIANG_API_KEY 或 OPENAI_API_KEY。"
                  : "前端直连适合本地 demo；公开部署时建议使用本地 proxy 或后端代理。"}
              </p>
              <p className="status-note strong">{generationStatus}</p>
            </div>

            <textarea
              className="novel-editor"
              value={novelText}
              onChange={(event) => setNovelText(event.target.value)}
              spellCheck={false}
            />

            <button className="primary-action" type="button" onClick={handleGenerate}>
              <Sparkles size={18} />
              {useApi ? "调用 AI 生成剧本" : "配置 AI 后生成"}
            </button>
          </section>
        </aside>

        <section className="review-stage" aria-label="审稿工作区">
          <section className="product-flow" aria-label="创作流程">
            <span className="active">1. 原文解析</span>
            <span className={sceneCount > 0 ? "active" : ""}>2. 分场改编</span>
            <span className={preview ? "active" : ""}>3. 作者审稿</span>
            <span className={validation.ok ? "active" : ""}>4. YAML 交付</span>
          </section>
          <ScreenplayReview
            screenplay={preview}
            selectedSceneId={selectedScene?.id ?? null}
            onSelectScene={setSelectedSceneId}
          />
        </section>

        <aside className="delivery-rail" aria-label="交付与场景编辑">
          <section className="panel output-panel">
            <div className="panel-header">
              <div>
                <p className="section-kicker">Delivery</p>
                <h2>YAML 交付</h2>
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
                <p>{validation.ok ? "当前 YAML 可复制、下载和继续改写。" : validation.errors.slice(0, 3).join("；")}</p>
              </div>
            </div>
          </section>

          {selectedScene ? (
            <SceneInspector
              scene={selectedScene}
              onPatch={(patch) => handleScenePatch(selectedScene.id, patch)}
            />
          ) : (
            <section className="scene-inspector empty">
              <h3>场景编辑器</h3>
              <p>生成并选中场景后，这里会显示可编辑字段和原文依据。</p>
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}

function ScreenplayReview({
  screenplay,
  selectedSceneId,
  onSelectScene
}: {
  screenplay: ScreenplayYaml | null;
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
}) {
  const analysis = useMemo(() => (screenplay ? analyzeScreenplay(screenplay) : null), [screenplay]);

  if (!screenplay || !analysis) {
    return (
      <section className="review-empty">
        <div>
          <p className="section-kicker">Review</p>
          <h2>作者审稿台</h2>
          <p>YAML 校验通过后，这里会显示改编计划、故事诊断和分场审稿卡。</p>
        </div>
      </section>
    );
  }

  const selectedScene = screenplay.scenes.find((scene) => scene.id === selectedSceneId) ?? screenplay.scenes[0];

  return (
    <section className="structured-preview" aria-label="作者审稿台">
      <div className="preview-heading">
        <div>
          <p className="section-kicker">Author Review</p>
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
        onSelectScene={onSelectScene}
      />

      <div className="review-board">
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

        <div className="scene-grid">
          {screenplay.scenes.map((scene) => (
            <button
              key={scene.id}
              className={scene.id === selectedScene.id ? "scene-card selected" : "scene-card"}
              type="button"
              onClick={() => onSelectScene(scene.id)}
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
      </div>
    </section>
  );
}

function SceneInspector({ scene, onPatch }: { scene: Scene; onPatch: (patch: ScenePatch) => void }) {
  return (
    <section className="scene-inspector">
      <div className="scene-card-top">
        <span>{scene.id}</span>
        <strong>{scene.pacing}</strong>
      </div>
      <div className="editor-heading">
        <PencilLine size={18} />
        <h3>场景编辑器</h3>
      </div>
      <p className="sync-note">修改会立即同步到 YAML，并触发 Schema 校验。</p>

      <label>
        场景标题
        <input value={scene.title} onChange={(event) => onPatch({ title: event.target.value })} />
      </label>
      <label>
        场景目标
        <textarea
          className="compact-editor"
          value={scene.goal}
          onChange={(event) => onPatch({ goal: event.target.value })}
        />
      </label>
      <div className="inspector-grid">
        <label>
          地点
          <input value={scene.location} onChange={(event) => onPatch({ location: event.target.value })} />
        </label>
        <label>
          时间
          <input value={scene.time} onChange={(event) => onPatch({ time: event.target.value })} />
        </label>
      </div>
      <div className="inspector-grid">
        <label>
          冲突等级
          <select
            value={scene.conflict.level}
            onChange={(event) =>
              onPatch({
                conflict: {
                  ...scene.conflict,
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
            value={scene.pacing}
            onChange={(event) => onPatch({ pacing: event.target.value as ScenePatch["pacing"] })}
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
          value={scene.conflict.reason}
          onChange={(event) =>
            onPatch({
              conflict: {
                ...scene.conflict,
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
          value={scene.characters.join("\n")}
          onChange={(event) => onPatch({ characters: parseListInput(event.target.value) })}
        />
      </label>
      <label>
        动作描写
        <textarea
          className="compact-editor tall"
          value={scene.action.join("\n")}
          onChange={(event) => onPatch({ action: parseListInput(event.target.value) })}
        />
      </label>
      <label>
        对白
        <textarea
          className="compact-editor tall"
          value={serializeDialogueInput(scene.dialogue)}
          onChange={(event) => onPatch({ dialogue: parseDialogueInput(event.target.value, scene) })}
        />
      </label>
      <label>
        旁白 / 转场
        <textarea
          className="compact-editor"
          value={scene.narrationOrTransition}
          onChange={(event) => onPatch({ narrationOrTransition: event.target.value })}
        />
      </label>
      <label>
        情绪
        <input value={scene.emotion} onChange={(event) => onPatch({ emotion: event.target.value })} />
      </label>
      <label>
        修订建议
        <textarea
          className="compact-editor tall"
          value={scene.revisionNotes.join("\n")}
          onChange={(event) => onPatch({ revisionNotes: parseListInput(event.target.value) })}
        />
      </label>
      <h4>原文依据</h4>
      <p className="source-note">
        第 {scene.source.chapterIndex} 章，段落 {scene.source.paragraphIndexes.join("、")}，行 {scene.source.lineStart}-
        {scene.source.lineEnd}
      </p>
      <blockquote className="source-excerpt">{scene.source.excerpt}</blockquote>
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
