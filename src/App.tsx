import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CheckCircle2,
  Clipboard,
  Clock3,
  Download,
  FileInput,
  KeyRound,
  PencilLine,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import { parse } from "yaml";
import {
  clearSavedAiSettings,
  getBrowserStorage,
  loadSavedAiSettings,
  saveAiSettings
} from "./core/apiSettings";
import { createAiSettingsSummary } from "./core/apiSettingsPresentation";
import {
  defaultLocalProxyBaseUrl,
  diagnoseAiConnection,
  resolveAiRequestBaseUrl
} from "./core/apiConnection";
import { apiProviderPresets, findApiProviderPreset } from "./core/apiProviders";
import { countChapters } from "./core/chapters";
import type { AdaptationStyle, Scene, ScreenplayYaml } from "./core/types";
import {
  generateScreenplayWithApi,
  regenerateSceneWithApi,
  type AiGenerationProgress
} from "./core/aiProvider";
import { generateWorkspaceDraft } from "./core/generationWorkflow";
import {
  compareRevisionToCurrent,
  createRevision,
  pushRevision,
  type RevisionDiffItem,
  type ScreenplayRevision
} from "./core/revisionHistory";
import {
  clearSavedWorkspaceDraft,
  loadSavedWorkspaceDraft,
  saveWorkspaceDraft
} from "./core/workspaceDraft";
import {
  buildGenerationRunDiagnostic,
  cancelGenerationRun,
  completeGenerationRun,
  createGenerationRun,
  failGenerationRun,
  markGenerationRunConnection,
  pushGenerationRunHistory,
  updateGenerationRunStage,
  type GenerationRun
} from "./core/generationRun";
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
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
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
  const [generationRunHistory, setGenerationRunHistory] = useState<GenerationRun[]>(
    initialWorkspaceDraft?.generationRuns ?? []
  );
  const [generationRun, setGenerationRun] = useState<GenerationRun | null>(
    initialWorkspaceDraft?.generationRuns[0] ?? null
  );
  const generationAbortRef = useRef<AbortController | null>(null);

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
  const aiSettingsSummary = useMemo(
    () =>
      createAiSettingsSummary({
        useApi,
        providerName: selectedProvider.name,
        model: apiModel,
        hasApiKey: Boolean(apiKey.trim())
      }),
    [apiKey, apiModel, selectedProvider.name, useApi]
  );
  const selectedScene =
    preview?.scenes.find((scene) => scene.id === selectedSceneId) ?? preview?.scenes[0] ?? null;

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
    generationAbortRef.current?.abort();
    const abortController = new AbortController();
    generationAbortRef.current = abortController;
    const apiKeyForRequest = apiKey.trim();
    const apiReady = Boolean(apiKeyForRequest);
    const requestBaseUrl = resolveAiRequestBaseUrl(apiBaseUrl, useLocalProxy);
    const run = createGenerationRun({
      title,
      model: apiModel,
      chapterCount
    });
    setGenerationRun(run);
    setGenerationRunHistory((current) => pushGenerationRunHistory(current, run));
    setGenerationStatus(useApi && apiReady ? `正在调用 ${apiModel}...` : "等待 AI 配置...");

    if (useApi && apiReady) {
      const connection = await diagnoseAiConnection({
        baseUrl: requestBaseUrl,
        useLocalProxy,
        providerBaseUrl,
        apiKey: apiKeyForRequest
      });

      if (generationAbortRef.current !== abortController) {
        return;
      }

      if (!connection.ok) {
        setGenerationStatus(connection.message);
        setGenerationRun((current) => (current?.id === run.id ? failGenerationRun(current, connection.message) : current));
        if (generationAbortRef.current === abortController) {
          generationAbortRef.current = null;
        }
        return;
      }

      if (useLocalProxy) {
        setGenerationStatus(`${connection.message}，正在调用 ${apiModel}...`);
      }
      setGenerationRun((current) =>
        current?.id === run.id ? markGenerationRunConnection(current, connection.message) : current
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
            model: apiModel,
            useGenerationTasks: useLocalProxy
          },
          {
            title,
            style,
            novelText,
            signal: abortController.signal,
            onProgress: (event) => {
              if (generationAbortRef.current !== abortController) {
                return;
              }
              setGenerationStatus(formatAiProgress(event, apiModel));
              setGenerationRun((current) => (current?.id === run.id ? updateGenerationRunStage(current, event) : current));
            }
          }
        )
    );

    if (generationAbortRef.current !== abortController) {
      return;
    }

    if (result.screenplay) {
      const nextYaml = screenplayToYaml(result.screenplay);
      setYamlText(nextYaml);
      setRevisionHistory((current) => pushRevision(current, createRevision("AI 生成", nextYaml)));
      setSelectedSceneId(result.screenplay.scenes[0]?.id ?? null);
      setGenerationRun((current) => (current?.id === run.id ? completeGenerationRun(current) : current));
    } else if (result.status.includes("生成任务已取消")) {
      setGenerationRun((current) => (current?.id === run.id ? cancelGenerationRun(current) : current));
    } else {
      setGenerationRun((current) => (current?.id === run.id ? failGenerationRun(current, result.status) : current));
    }
    setGenerationStatus(result.status);
    if (generationAbortRef.current === abortController) {
      generationAbortRef.current = null;
    }
  }

  function handleCancelGeneration() {
    generationAbortRef.current?.abort();
    setGenerationStatus("正在取消生成任务...");
    setGenerationRun((current) => (current ? cancelGenerationRun(current) : current));
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

            <div className="ai-summary-card">
              <div>
                <span className="connection-pill">应用内 AI 服务</span>
                <strong>{aiSettingsSummary.title}</strong>
                <p>{aiSettingsSummary.status} · {generationStatus}</p>
              </div>
              <button className="secondary-action compact" type="button" onClick={() => setIsAiSettingsOpen(true)}>
                <Settings2 size={16} />
                AI 设置
              </button>
            </div>

            <GenerationRunPanel
              run={generationRun}
              history={generationRunHistory}
              onCancel={handleCancelGeneration}
              onRetry={handleGenerate}
              onSelectRun={setGenerationRun}
            />

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
        {isAiSettingsOpen ? (
          <AiSettingsPanel
            apiKey={apiKey}
            apiModel={apiModel}
            generationStatus={generationStatus}
            providerBaseUrl={providerBaseUrl}
            providerId={providerId}
            rememberApiKey={rememberApiKey}
            selectedProvider={selectedProvider}
            useApi={useApi}
            onApiKeyChange={setApiKey}
            onCheckConnection={handleCheckConnection}
            onClearSavedAiSettings={handleClearSavedAiSettings}
            onClose={() => setIsAiSettingsOpen(false)}
            onProviderBaseUrlChange={setProviderBaseUrl}
            onProviderChange={handleProviderChange}
            onRememberApiKeyChange={handleRememberApiKey}
            onModelChange={setApiModel}
            onUseApiChange={setUseApi}
          />
        ) : null}

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
                <button className="icon-button text-button" type="button" onClick={handleSaveRevision} title="保存当前版本">
                  保存
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

            <RevisionHistoryPanel
              currentYaml={yamlText}
              history={revisionHistory}
              onRestore={handleRestoreRevision}
            />
          </section>

          {selectedScene ? (
            <SceneInspector
              scene={selectedScene}
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

interface AiSettingsPanelProps {
  apiKey: string;
  apiModel: string;
  generationStatus: string;
  providerBaseUrl: string;
  providerId: string;
  rememberApiKey: boolean;
  selectedProvider: ReturnType<typeof findApiProviderPreset>;
  useApi: boolean;
  onApiKeyChange: (value: string) => void;
  onCheckConnection: () => void;
  onClearSavedAiSettings: () => void;
  onClose: () => void;
  onModelChange: (value: string) => void;
  onProviderBaseUrlChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onRememberApiKeyChange: (checked: boolean) => void;
  onUseApiChange: (checked: boolean) => void;
}

function AiSettingsPanel({
  apiKey,
  apiModel,
  generationStatus,
  providerBaseUrl,
  providerId,
  rememberApiKey,
  selectedProvider,
  useApi,
  onApiKeyChange,
  onCheckConnection,
  onClearSavedAiSettings,
  onClose,
  onModelChange,
  onProviderBaseUrlChange,
  onProviderChange,
  onRememberApiKeyChange,
  onUseApiChange
}: AiSettingsPanelProps) {
  return (
    <div className="settings-overlay" role="presentation">
      <button className="settings-scrim" type="button" aria-label="关闭 AI 设置" onClick={onClose} />
      <section className="settings-panel" aria-label="AI 设置">
        <div className="settings-panel-head">
          <div>
            <p className="section-kicker">AI Settings</p>
            <h2>AI 设置</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <label className="toggle-line">
          <input type="checkbox" checked={useApi} onChange={(event) => onUseApiChange(event.target.checked)} />
          <span>启用 AI 生成</span>
        </label>

        <div className="api-grid">
          <label>
            Provider
            <select value={providerId} onChange={(event) => onProviderChange(event.target.value)}>
              {apiProviderPresets.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Base URL
            <input value={providerBaseUrl} onChange={(event) => onProviderBaseUrlChange(event.target.value)} />
          </label>
          <label>
            Model
            <input list="api-model-presets" value={apiModel} onChange={(event) => onModelChange(event.target.value)} />
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
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder="输入一次后可记住在本机浏览器"
            />
          </div>
        </label>

        <div className="remember-row">
          <label className="toggle-line">
            <input
              type="checkbox"
              checked={rememberApiKey}
              onChange={(event) => onRememberApiKeyChange(event.target.checked)}
            />
            <span>记住 API Key</span>
          </label>
          <button className="ghost-action" type="button" onClick={onClearSavedAiSettings}>
            清除保存
          </button>
        </div>

        <button className="secondary-action" type="button" onClick={onCheckConnection}>
          测试连接
        </button>

        <p className="status-note strong">{generationStatus}</p>
      </section>
    </div>
  );
}

function formatAiProgress(event: AiGenerationProgress, model: string): string {
  if (event.stage === "chapter_event_extract") {
    return `正在用 ${model} 抽取章节事件：${event.current}/${event.total}`;
  }

  if (event.stage === "story_bible_generate") {
    return `正在用 ${model} 合并故事圣经和改编策略`;
  }

  if (event.stage === "schema_repair") {
    return `正在用 ${model} 修复剧本结构`;
  }

  return `${event.message}：${model}`;
}

function GenerationRunPanel({
  run,
  history,
  onCancel,
  onRetry,
  onSelectRun
}: {
  run: GenerationRun | null;
  history: GenerationRun[];
  onCancel: () => void;
  onRetry: () => void;
  onSelectRun: (run: GenerationRun) => void;
}) {
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const activeRun = run ?? history[0] ?? null;
  if (!activeRun) return null;

  const statusLabel =
    activeRun.status === "completed"
      ? "已完成"
      : activeRun.status === "failed"
        ? "需要处理"
        : activeRun.status === "cancelled"
          ? "已取消"
          : "进行中";
  const elapsedSeconds = Math.max(
    0,
    Math.round(
      ((activeRun.completedAt ? new Date(activeRun.completedAt).getTime() : Date.now()) -
        new Date(activeRun.startedAt).getTime()) /
        1000
    )
  );
  const recentRuns = history.slice(0, 4);

  async function handleCopyDiagnostic() {
    await navigator.clipboard.writeText(buildGenerationRunDiagnostic(activeRun));
    setDiagnosticCopied(true);
    window.setTimeout(() => setDiagnosticCopied(false), 1600);
  }

  return (
    <div className={`generation-run ${activeRun.status}`}>
      <div className="generation-run-head">
        <div>
          <strong>生成任务</strong>
          <span>
            {activeRun.model} · {activeRun.chapterCount} 章 · {elapsedSeconds}s
          </span>
        </div>
        <div className="generation-run-actions">
          {activeRun.status === "running" ? (
            <button type="button" onClick={onCancel} title="取消当前生成任务">
              <X size={13} />
              取消
            </button>
          ) : null}
          {activeRun.status === "failed" ? (
            <>
              <button type="button" onClick={handleCopyDiagnostic} title="复制生成诊断">
                <Clipboard size={13} />
                {diagnosticCopied ? "已复制" : "诊断"}
              </button>
              <button type="button" onClick={onRetry} title="重新调用当前 AI 配置">
                <RefreshCw size={13} />
                重试
              </button>
            </>
          ) : null}
          <em>{statusLabel}</em>
        </div>
      </div>
      <div className="generation-stages">
        {activeRun.stages.map((stage) => (
          <div className={`generation-stage ${stage.status}`} key={stage.id}>
            <span className="stage-dot" />
            <div>
              <strong>{stage.label}</strong>
              <p>
                {stage.message}
                {stage.total ? ` · ${stage.current ?? 0}/${stage.total}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
      {activeRun.error ? (
        <p className="generation-error">
          <TriangleAlert size={14} />
          {activeRun.error}
        </p>
      ) : (
        <p className="generation-meta">
          <Clock3 size={14} />
          阶段记录会保留本次调用路径，便于判断卡在连接、事件抽取、结构修复还是 YAML 写入。
        </p>
      )}
      {recentRuns.length > 1 ? (
        <div className="generation-history">
          <div className="generation-history-head">
            <strong>最近生成</strong>
            <span>{recentRuns.length} 条</span>
          </div>
          <div className="generation-history-list">
            {recentRuns.map((item) => (
              <button
                key={item.id}
                className={item.id === activeRun.id ? "selected" : ""}
                type="button"
                onClick={() => onSelectRun(item)}
              >
                <span className={`history-status ${item.status}`} />
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.model} · {new Date(item.startedAt).toLocaleTimeString()}
                  </span>
                </div>
                <em>{formatRunStatus(item.status)}</em>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatRunStatus(status: GenerationRun["status"]): string {
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  if (status === "running") return "运行中";
  return "待开始";
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

function RevisionHistoryPanel({
  currentYaml,
  history,
  onRestore
}: {
  currentYaml: string;
  history: ScreenplayRevision[];
  onRestore: (revision: ScreenplayRevision) => void;
}) {
  const [selectedRevisionId, setSelectedRevisionId] = useState(history[0]?.id ?? "");
  const selectedRevision = history.find((revision) => revision.id === selectedRevisionId) ?? history[0] ?? null;
  useEffect(() => {
    if (history.length && !history.some((revision) => revision.id === selectedRevisionId)) {
      setSelectedRevisionId(history[0].id);
    }
  }, [history, selectedRevisionId]);
  const diff = useMemo(
    () => (selectedRevision ? compareRevisionToCurrent(selectedRevision, currentYaml) : null),
    [currentYaml, selectedRevision]
  );
  const visibleDiffItems = diff?.items.filter((item) => item.kind !== "unchanged").slice(0, 6) ?? [];

  return (
    <div className="revision-history">
      <div className="analysis-card-head">
        <h3>版本历史</h3>
        <span>{history.length} 个版本</span>
      </div>
      <div className="revision-list">
        {history.map((revision) => (
          <article className={revision.id === selectedRevision?.id ? "selected" : ""} key={revision.id}>
            <button type="button" onClick={() => setSelectedRevisionId(revision.id)}>
              <strong>{revision.label}</strong>
              <span>{new Date(revision.createdAt).toLocaleString()}</span>
            </button>
            <button className="restore-revision" type="button" onClick={() => onRestore(revision)}>
              恢复
            </button>
          </article>
        ))}
      </div>
      {diff ? (
        <div className="revision-diff">
          <div className="revision-diff-head">
            <strong>与当前 YAML 对比</strong>
            <span>
              +{diff.summary.added} / -{diff.summary.removed} / 改 {diff.summary.changed}
            </span>
          </div>
          {visibleDiffItems.length ? (
            <div className="revision-diff-list">
              {visibleDiffItems.map((item, index) => (
                <RevisionDiffRow item={item} key={`${item.kind}-${item.lineNumber}-${index}`} />
              ))}
            </div>
          ) : (
            <p className="revision-diff-empty">当前 YAML 和这个版本没有内容差异。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RevisionDiffRow({ item }: { item: RevisionDiffItem }) {
  const label = item.kind === "added" ? "新增" : item.kind === "removed" ? "删除" : "变更";

  return (
    <div className={`revision-diff-row ${item.kind}`}>
      <span>{label}</span>
      <code>{item.kind === "added" ? item.after : item.kind === "removed" ? item.before : item.after}</code>
      {item.kind === "changed" ? <small>原：{item.before}</small> : null}
    </div>
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
                    const matchedScene = screenplay.scenes.find(
                      (scene) => scene.chapterIndex === chapter.chapterIndex
                    );
                    if (matchedScene) onSelectScene(matchedScene.id);
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

function SceneInspector({
  scene,
  onPatch,
  onRegenerate
}: {
  scene: Scene;
  onPatch: (patch: ScenePatch) => void;
  onRegenerate: () => void;
}) {
  return (
    <section className="scene-inspector">
      <div className="scene-card-top">
        <span>{scene.id}</span>
        <strong>{scene.pacing}</strong>
      </div>
      <div className="editor-heading">
        <PencilLine size={18} />
        <h3>场景编辑器</h3>
        <button className="secondary-action compact" type="button" onClick={onRegenerate}>
          AI 补强
        </button>
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
