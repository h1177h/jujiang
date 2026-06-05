import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileInput,
  RefreshCw,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import type { AdaptationStyle } from "./core/types";
import { sampleNovel } from "./core/sampleNovel";
import { generateScreenplayYaml, validateScreenplayYaml } from "./core/yaml";

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
  const [yamlText, setYamlText] = useState(() =>
    generateScreenplayYaml(sampleNovel, { title: "雾港来信", style: "cinematic" })
  );
  const [copyLabel, setCopyLabel] = useState("复制");

  const validation = useMemo(() => validateScreenplayYaml(yamlText), [yamlText]);
  const chapterCount = useMemo(() => {
    const matches = novelText.match(/(^|\n)\s*(第\s*[0-9一二三四五六七八九十百千万]+\s*[章节回幕]|chapter\s+\d+)/gi);
    return matches?.length ?? 0;
  }, [novelText]);

  function handleGenerate() {
    try {
      setYamlText(generateScreenplayYaml(novelText, { title, style }));
    } catch (error) {
      setYamlText(
        `validation_error:\n  message: ${JSON.stringify(
          error instanceof Error ? error.message : "生成失败"
        )}\n`
      );
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

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Jujiang</p>
          <h1>剧匠 AI 小说转剧本工作台</h1>
        </div>
        <div className="status-strip">
          <span>{chapterCount} 章识别</span>
          <span className={validation.ok ? "valid" : "invalid"}>
            {validation.ok ? "YAML 校验通过" : "YAML 待修正"}
          </span>
        </div>
      </section>

      <section className="workspace">
        <section className="panel input-panel" aria-label="小说输入">
          <div className="panel-header">
            <div>
              <h2>小说输入</h2>
              <p>粘贴或上传三章以上文本，fallback 引擎会保留原文追溯。</p>
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

          <textarea
            className="novel-editor"
            value={novelText}
            onChange={(event) => setNovelText(event.target.value)}
            spellCheck={false}
          />

          <button className="primary-action" type="button" onClick={handleGenerate}>
            <Sparkles size={18} />
            生成结构化剧本 YAML
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
    </main>
  );
}
