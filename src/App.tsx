import { useEffect, useMemo, useState } from "react";
import {
  FileInput,
  KeyRound,
  Sparkles,
  Trash2,
} from "lucide-react";
import { parse } from "yaml";
import {
  clearSavedAiSettings,
  getBrowserStorage,
  loadSavedAiSettings,
  saveAiSettings
} from "./core/apiSettings";
import {
  defaultLocalProxyBaseUrl,
  diagnoseAiConnection,
  resolveAiRequestBaseUrl
} from "./core/apiConnection";
import { apiProviderPresets, findApiProviderPreset } from "./core/apiProviders";
import { summarizeSourceDraft } from "./core/chapters";
import type { AdaptationStyle, Scene, ScreenplayYaml } from "./core/types";
import {
  generateScreenplayWithApi,
  regenerateSceneWithApi
} from "./core/aiProvider";
import { generateWorkspaceDraft } from "./core/generationWorkflow";
import { createRevision, pushRevision, type ScreenplayRevision } from "./core/revisionHistory";
import {
  clearSavedWorkspaceDraft,
  loadSavedWorkspaceDraft,
  saveWorkspaceDraft
} from "./core/workspaceDraft";
import {
  completeGenerationRun,
  createGenerationRun,
  failGenerationRun,
  formatAiGenerationProgress,
  markGenerationRunConnection,
  pushGenerationRunHistory,
  updateGenerationRunStage,
  type GenerationRun
} from "./core/generationRun";
import { SceneInspector } from "./components/SceneInspector";
import { GenerationRunPanel } from "./components/GenerationRunPanel";
import { StoryAnalysisPanel } from "./components/StoryAnalysisPanel";
import { sampleNovel } from "./core/sampleNovel";
import { validateScreenplay } from "./core/schema";
import {
  isEditorReadyScene,
  updateScreenplaySceneYaml,
  type ScenePatch
} from "./core/sceneEditor";
import {
  editorIssueFromYamlDiagnostic,
  patchTouchesEditorIssueField,
  type ActiveEditorIssue
} from "./core/editorIssues";
import { analyzeScreenplay, findSceneIdForChapterEvent, type SceneQualityIssue } from "./core/storyAnalysis";
import { screenplayToYaml, validateScreenplayYaml, type ScreenplayYamlDiagnostic } from "./core/yaml";
import { DeliveryPanel } from "./components/DeliveryPanel";
import sampleOutputYaml from "../examples/sample-output.yaml?raw";

const styles: { value: AdaptationStyle; label: string }[] = [
  { value: "balanced", label: "均衡" },
  { value: "cinematic", label: "影视感" },
  { value: "stage", label: "舞台" },
  { value: "short_drama", label: "短剧" }
];
const localProxyBaseUrl = defaultLocalProxyBaseUrl;

export default function App() {
  const [initialAiSettings] = useState(() => loadSavedAiSettings(getBrowserStorage()));
  const [initialWorkspaceDraft] = useState(() => loadSavedWorkspaceDraft(getBrowserStorage()));
  const initialProvider = findApiProviderPreset(initialAiSettings?.providerId);
  const [novelText, setNovelText] = useState(initialWorkspaceDraft?.novelText ?? sampleNovel);
  const [title, setTitle] = useState(initialWorkspaceDraft?.title ?? "雾港来信");
  const [style, setStyle] = useState<AdaptationStyle>(initialWorkspaceDraft?.style ?? "cinematic");
  const [useApi, setUseApi] = useState(initialAiSettings?.useApi ?? true);
  const useLocalProxy = true;
  const [providerId, setProviderId] = useState(initialAiSettings?.providerId ?? initialProvider.id);
  const selectedProvider = useMemo(() => findApiProviderPreset(providerId), [providerId]);
  const [apiBaseUrl] = useState(localProxyBaseUrl);
  const [providerBaseUrl, setProviderBaseUrl] = useState(
    initialAiSettings?.providerBaseUrl ??
      (initialAiSettings?.useLocalProxy === false ? initialAiSettings.baseUrl : initialProvider.baseUrl)
  );
  const [apiModel, setApiModel] = useState(initialAiSettings?.model ?? initialProvider.defaultModel);
  const [apiKey, setApiKey] = useState(initialAiSettings?.apiKey ?? "");
  const [rememberApiKey, setRememberApiKey] = useState(initialAiSettings ? Boolean(initialAiSettings.apiKey) : true);
  const [generationStatus, setGenerationStatus] = useState(
    initialWorkspaceDraft
      ? "已载入本机工作区草稿"
      : initialAiSettings
        ? "已载入已保存的 AI 设置"
        : "请配置 AI 后生成剧本"
  );
  const [yamlText, setYamlText] = useState(initialWorkspaceDraft?.yamlText ?? sampleOutputYaml);
  const [revisionHistory, setRevisionHistory] = useState<ScreenplayRevision[]>(() => [
    ...(initialWorkspaceDraft?.revisionHistory.length
      ? initialWorkspaceDraft.revisionHistory
      : [createRevision("示例 YAML", sampleOutputYaml)])
  ]);
  const [copyLabel, setCopyLabel] = useState("复制");
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    initialWorkspaceDraft?.selectedSceneId ?? null
  );
  const [activeEditorIssue, setActiveEditorIssue] = useState<ActiveEditorIssue | null>(null);
  const [generationRunHistory, setGenerationRunHistory] = useState<GenerationRun[]>(
    initialWorkspaceDraft?.generationRuns ?? []
  );
  const [generationRun, setGenerationRun] = useState<GenerationRun | null>(
    initialWorkspaceDraft?.generationRuns[0] ?? null
  );

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
  const draftScreenplay = useMemo(() => {
    if (preview) return preview;
    try {
      const parsed = parse(yamlText) as Partial<ScreenplayYaml>;
      return Array.isArray(parsed.scenes) && parsed.scenes.every(isEditorReadyScene)
        ? (parsed as ScreenplayYaml)
        : null;
    } catch {
      return null;
    }
  }, [preview, yamlText]);
  const sourceSummary = useMemo(() => summarizeSourceDraft(novelText), [novelText]);
  const sceneCount = draftScreenplay?.scenes.length ?? 0;
  const selectedScene =
    draftScreenplay?.scenes.find((scene) => scene.id === selectedSceneId) ?? draftScreenplay?.scenes[0] ?? null;

  useEffect(() => {
    if (!rememberApiKey || !apiKey.trim()) return;

    saveAiSettings(
      {
        useApi,
        useLocalProxy,
        providerId,
        providerName: selectedProvider.name,
        baseUrl: apiBaseUrl,
        providerBaseUrl,
        model: apiModel,
        apiKey: apiKey.trim()
      },
      getBrowserStorage()
    );
  }, [apiBaseUrl, apiKey, apiModel, providerBaseUrl, providerId, rememberApiKey, selectedProvider.name, useApi, useLocalProxy]);

  useEffect(() => {
    saveWorkspaceDraft(
      {
        title,
        style,
        novelText,
        yamlText,
        selectedSceneId,
        revisionHistory,
        generationRuns: generationRunHistory
      },
      getBrowserStorage()
    );
  }, [generationRunHistory, novelText, revisionHistory, selectedSceneId, style, title, yamlText]);

  useEffect(() => {
    if (!generationRun) return;
    setGenerationRunHistory((current) => pushGenerationRunHistory(current, generationRun));
  }, [generationRun]);

  async function handleGenerate() {
    const apiKeyForRequest = apiKey.trim();
    const apiReady = Boolean(apiKeyForRequest);
    const requestBaseUrl = resolveAiRequestBaseUrl(apiBaseUrl, useLocalProxy);
    const run = createGenerationRun({
      title,
      model: apiModel,
      chapterCount: sourceSummary.chapterCount
    });
    setGenerationRun(run);
    setGenerationRunHistory((current) => pushGenerationRunHistory(current, run));

    if (!sourceSummary.canGenerate) {
      const failedRun = failGenerationRun(run, sourceSummary.detail);
      setGenerationRun(failedRun);
      setGenerationRunHistory((current) => pushGenerationRunHistory(current, failedRun));
      setGenerationStatus(sourceSummary.detail);
      return;
    }

    setGenerationStatus(useApi && apiReady ? `正在调用 ${apiModel}...` : "等待 AI 配置...");

    if (useApi && apiReady) {
      const connection = await diagnoseAiConnection({
        baseUrl: requestBaseUrl,
        useLocalProxy,
        providerBaseUrl,
        apiKey: apiKeyForRequest
      });

      if (!connection.ok) {
        setGenerationStatus(connection.message);
        setGenerationRun((current) => (current ? failGenerationRun(current, connection.message) : current));
        return;
      }

      if (useLocalProxy) {
        setGenerationStatus(`${connection.message}，正在调用 ${apiModel}...`);
      }
      setGenerationRun((current) =>
        current ? markGenerationRunConnection(current, connection.message) : current
      );
    }

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
            baseUrl: requestBaseUrl,
            providerBaseUrl,
            apiKey: apiKeyForRequest,
            model: apiModel
          },
          {
            title,
            style,
            novelText,
            onProgress: (event) => {
              setGenerationStatus(formatAiGenerationProgress(event, apiModel));
              setGenerationRun((current) => (current ? updateGenerationRunStage(current, event) : current));
            }
          }
        )
    );

    if (result.screenplay) {
      const nextYaml = screenplayToYaml(result.screenplay);
      setYamlText(nextYaml);
      setRevisionHistory((current) => pushRevision(current, createRevision("AI 生成", nextYaml)));
      setSelectedSceneId(result.screenplay.scenes[0]?.id ?? null);
      setGenerationRun((current) => (current ? completeGenerationRun(current) : current));
    } else {
      setGenerationRun((current) => (current ? failGenerationRun(current, result.status) : current));
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
      if (
        activeEditorIssue?.sceneId === sceneId &&
        patchTouchesEditorIssueField(patch, activeEditorIssue.targetField)
      ) {
        setActiveEditorIssue(null);
      }
      setGenerationStatus(`已同步 ${sceneId} 到 YAML`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "场景同步失败";
      setGenerationStatus(message);
    }
  }

  function handleSelectScene(sceneId: string) {
    setSelectedSceneId(sceneId);
    setActiveEditorIssue(null);
  }

  function handleSelectQualityIssue(issue: SceneQualityIssue) {
    setSelectedSceneId(issue.sceneId);
    setActiveEditorIssue(issue);
  }

  function handleSelectYamlIssue(issue: ScreenplayYamlDiagnostic) {
    const editorIssue = editorIssueFromYamlDiagnostic(issue);
    if (!editorIssue) return;

    setSelectedSceneId(editorIssue.sceneId);
    setActiveEditorIssue(editorIssue);
  }

  function handleSaveRevision() {
    setRevisionHistory((current) => pushRevision(current, createRevision("手动保存", yamlText)));
    setGenerationStatus("已保存当前 YAML 版本");
  }

  function handleRestoreRevision(revision: ScreenplayRevision) {
    setYamlText(revision.yamlText);
    try {
      const parsed = parse(revision.yamlText);
      const result = validateScreenplay(parsed);
      setSelectedSceneId(result.success ? result.data.scenes[0]?.id ?? null : null);
    } catch {
      setSelectedSceneId(null);
    }
    setGenerationStatus(`已恢复版本：${revision.label}`);
  }

  async function handleRegenerateSelectedScene() {
    if (!preview || !selectedScene) {
      setGenerationStatus("请先生成或载入可编辑的剧本场景。");
      return;
    }

    if (!useApi) {
      setGenerationStatus("请先开启 AI 生成，再补强单场。");
      return;
    }

    const apiKeyForRequest = apiKey.trim();
    const requestBaseUrl = resolveAiRequestBaseUrl(apiBaseUrl, useLocalProxy);
    if (!apiKeyForRequest) {
      setGenerationStatus("请先填写 API Key。");
      return;
    }

    const connection = await diagnoseAiConnection({
      baseUrl: requestBaseUrl,
      useLocalProxy,
      providerBaseUrl,
      apiKey: apiKeyForRequest
    });
    if (!connection.ok) {
      setGenerationStatus(connection.message);
      return;
    }

    setGenerationStatus(`正在用 ${apiModel} 补强 ${selectedScene.id}...`);
    try {
      const revisedScene = await regenerateSceneWithApi(
        {
          baseUrl: requestBaseUrl,
          providerBaseUrl,
          apiKey: apiKeyForRequest,
          model: apiModel
        },
        {
          screenplay: preview,
          sceneId: selectedScene.id,
          instruction: "补强本场对白、冲突压力和场尾钩子，保留原文依据。"
        }
      );
      setYamlText((current) => {
        const nextYaml = updateScreenplaySceneYaml(current, selectedScene.id, sceneToPatch(revisedScene));
        setRevisionHistory((history) =>
          pushRevision(history, createRevision(`AI 补强 ${selectedScene.id}`, nextYaml))
        );
        return nextYaml;
      });
      setSelectedSceneId(selectedScene.id);
      setGenerationStatus(`已补强 ${selectedScene.id} 并同步到 YAML`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "单场补强失败";
      setGenerationStatus(`AI 补强失败：${message}`);
    }
  }

  function handleProviderChange(nextProviderId: string) {
    const nextProvider = findApiProviderPreset(nextProviderId);
    setProviderId(nextProvider.id);
    setProviderBaseUrl(nextProvider.baseUrl);
    setApiModel(nextProvider.defaultModel);
  }

  function handleRememberApiKey(checked: boolean) {
    setRememberApiKey(checked);
    if (!checked) {
      clearSavedAiSettings(getBrowserStorage());
      setGenerationStatus("已清除浏览器保存的 API 设置");
      return;
    }

    if (apiKey.trim()) {
      saveAiSettings(
        {
          useApi,
          useLocalProxy,
          providerId,
          providerName: selectedProvider.name,
          baseUrl: apiBaseUrl,
          providerBaseUrl,
          model: apiModel,
          apiKey: apiKey.trim()
        },
        getBrowserStorage()
      );
      setGenerationStatus("已在本机浏览器记住 API 设置");
    }
  }

  function handleClearSavedAiSettings() {
    clearSavedAiSettings(getBrowserStorage());
    setRememberApiKey(false);
    setApiKey("");
    setGenerationStatus("已清除浏览器保存的 API 设置");
  }

  function handleResetWorkspace() {
    const nextHistory = [createRevision("示例 YAML", sampleOutputYaml)];
    clearSavedWorkspaceDraft(getBrowserStorage());
    setNovelText(sampleNovel);
    setTitle("雾港来信");
    setStyle("cinematic");
    setYamlText(sampleOutputYaml);
    setRevisionHistory(nextHistory);
    setSelectedSceneId(null);
    setGenerationRun(null);
    setGenerationRunHistory([]);
    setGenerationStatus("已重置工作区草稿");
  }

  async function handleCheckConnection() {
    const apiKeyForRequest = apiKey.trim();
    const requestBaseUrl = resolveAiRequestBaseUrl(apiBaseUrl, useLocalProxy);
    if (!apiKeyForRequest) {
      setGenerationStatus("请先填写 API Key，再测试连接。");
      return;
    }

    setGenerationStatus("正在检查 AI 连接...");
    const connection = await diagnoseAiConnection({
      baseUrl: requestBaseUrl,
      useLocalProxy,
      providerBaseUrl,
      apiKey: apiKeyForRequest
    });
    setGenerationStatus(connection.message);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Jujiang Studio</p>
          <h1>剧匠 AI 小说转剧本工作台</h1>
        </div>
        <div className="status-strip">
          <span>{sourceSummary.chapterCount} 章识别</span>
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
              <div className="header-actions">
                <label className="icon-button file-button" title="上传文本文件">
                  <FileInput size={18} />
                  <input
                    type="file"
                    accept=".txt,.md"
                    onChange={(event) => handleFileUpload(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button className="icon-button" type="button" onClick={handleResetWorkspace} title="重置工作区草稿">
                  <Trash2 size={18} />
                </button>
              </div>
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
                <span className="connection-pill">应用内 AI 服务</span>
              </div>
              <div className="api-grid">
                <label>
                  Provider
                  <select value={providerId} onChange={(event) => handleProviderChange(event.target.value)}>
                    {apiProviderPresets.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Base URL
                  <input value={providerBaseUrl} onChange={(event) => setProviderBaseUrl(event.target.value)} />
                </label>
                <label>
                  Model
                  <input list="api-model-presets" value={apiModel} onChange={(event) => setApiModel(event.target.value)} />
                  <datalist id="api-model-presets">
                    {selectedProvider.models.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
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
                    placeholder="输入一次后可记住在本机浏览器"
                  />
                </div>
              </label>
              <div className="remember-row">
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={rememberApiKey}
                    onChange={(event) => handleRememberApiKey(event.target.checked)}
                  />
                  <span>记住 API Key</span>
                </label>
                <button className="ghost-action" type="button" onClick={handleClearSavedAiSettings}>
                  清除
                </button>
              </div>
              <button className="secondary-action" type="button" onClick={handleCheckConnection}>
                测试连接
              </button>
              <p className="status-note">
                推荐用 npm run dev:app 启动完整应用。页面会把当前 provider 配置交给应用内 AI 服务，不需要单独配置上游环境变量。
              </p>
              <p className="status-note strong">{generationStatus}</p>
              <GenerationRunPanel
                run={generationRun}
                history={generationRunHistory}
                onRetry={handleGenerate}
                onSelectRun={setGenerationRun}
              />
            </div>

            <div className="source-editor-column">
              <div className={`source-health ${sourceSummary.status}`}>
                <div className="source-health-head">
                  <div>
                    <strong>{sourceSummary.headline}</strong>
                    <p>{sourceSummary.detail}</p>
                  </div>
                  <span>{sourceSummary.canGenerate ? "可生成" : "待补充"}</span>
                </div>
                <div className="source-stat-grid">
                  <span>
                    <strong>{sourceSummary.chapterCount}</strong>
                    章节
                  </span>
                  <span>
                    <strong>{sourceSummary.paragraphCount}</strong>
                    段落
                  </span>
                  <span>
                    <strong>{sourceSummary.lineCount}</strong>
                    行
                  </span>
                </div>
              </div>

              <textarea
                className="novel-editor"
                value={novelText}
                onChange={(event) => setNovelText(event.target.value)}
                spellCheck={false}
              />
            </div>

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
            activeEditorIssue={activeEditorIssue}
            onSelectScene={handleSelectScene}
            onSelectIssue={handleSelectQualityIssue}
          />
        </section>

        <aside className="delivery-rail" aria-label="交付与场景编辑">
          <DeliveryPanel
            copyLabel={copyLabel}
            revisionHistory={revisionHistory}
            validation={validation}
            yamlText={yamlText}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onGenerate={handleGenerate}
            onRestoreRevision={handleRestoreRevision}
            onSaveRevision={handleSaveRevision}
            onSelectYamlIssue={handleSelectYamlIssue}
            onYamlChange={setYamlText}
          />

          {selectedScene ? (
            <SceneInspector
              scene={selectedScene}
              novelText={novelText}
              activeEditorIssue={activeEditorIssue?.sceneId === selectedScene.id ? activeEditorIssue : null}
              onPatch={(patch) => handleScenePatch(selectedScene.id, patch)}
              onRegenerate={handleRegenerateSelectedScene}
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

function sceneToPatch(scene: Scene): ScenePatch {
  return {
    title: scene.title,
    goal: scene.goal,
    location: scene.location,
    time: scene.time,
    characters: scene.characters,
    action: scene.action,
    dialogue: scene.dialogue,
    narrationOrTransition: scene.narrationOrTransition,
    emotion: scene.emotion,
    pacing: scene.pacing,
    conflict: scene.conflict,
    revisionNotes: scene.revisionNotes
  };
}

function ScreenplayReview({
  screenplay,
  selectedSceneId,
  activeEditorIssue,
  onSelectScene,
  onSelectIssue
}: {
  screenplay: ScreenplayYaml | null;
  selectedSceneId: string | null;
  activeEditorIssue: ActiveEditorIssue | null;
  onSelectScene: (sceneId: string) => void;
  onSelectIssue: (issue: SceneQualityIssue) => void;
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

      <section className="event-board" aria-label="章节事件图谱">
        <div className="analysis-card-head">
          <h3>章节事件图谱</h3>
          <span>{analysis.eventCoverage.map((item) => item.eventCount).reduce((sum, count) => sum + count, 0)} 个事件</span>
        </div>
        <div className="event-grid">
          {screenplay.chapterEvents.map((chapter) => (
            <article key={chapter.chapterIndex} className="event-column">
              <div>
                <strong>第 {chapter.chapterIndex} 章：{chapter.chapterTitle}</strong>
                <p>{chapter.chapterGoal}</p>
              </div>
              {chapter.events.map((event) => (
                <button
                  key={event.id}
                  className="event-item"
                  type="button"
                  onClick={() => {
                    const matchedSceneId = findSceneIdForChapterEvent(event, screenplay.scenes);
                    if (matchedSceneId) onSelectScene(matchedSceneId);
                  }}
                >
                  <span>{event.id}</span>
                  <strong>{event.summary}</strong>
                  <small>{event.conflict}</small>
                </button>
              ))}
            </article>
          ))}
        </div>
      </section>

      <StoryAnalysisPanel
        analysis={analysis}
        selectedSceneId={selectedScene.id}
        activeEditorIssue={activeEditorIssue}
        onSelectScene={onSelectScene}
        onSelectIssue={onSelectIssue}
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="metric">
      <strong>{value}</strong>
      {label}
    </span>
  );
}
