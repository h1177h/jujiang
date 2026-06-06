# Provider Proxy Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jujiang's AI setup feel like a normal product setting: choose a provider, enter Base URL/API Key/Model once, then generate through the app proxy without learning proxy/direct/CORS details.

**Architecture:** Keep the lightweight Vite + React + Node proxy stack. Treat the local proxy as the app's backend gateway: the browser always calls `http://127.0.0.1:18787/v1`, while the user-entered upstream provider Base URL is passed to the proxy per request and health check. Provider presets live in the frontend settings layer and are persisted in browser storage.

**Tech Stack:** React, TypeScript, Vitest, Node HTTP proxy, undici.

---

### Task 1: Reference Findings and Product Direction

**Files:**
- Modify: `docs/reference-analysis.md`
- Create: `docs/superpowers/plans/2026-06-06-provider-proxy-profile.md`

- [x] **Step 1: Confirm reference patterns**

Inspected the local reference clones under `C:\Users\11\AppData\Local\Temp\jujiang-ref-repos`.

Findings:
- LocalMiniDrama stores provider, Base URL, API Key, model, and default model as an AI service config, with provider presets and endpoint preview in its settings UI.
- novelvids stores active model configs server-side and downstream generation controllers read only the active config.
- Toonflow-app defines vendor inputs, default config, model lists, and model test routes; the app hides transport details behind vendor adapters.
- LumenX uses a provider registry and environment-backed provider routing rather than asking users to reason about raw request transport.

- [x] **Step 2: Identify Jujiang's concrete gap**

Current Jujiang stores `baseUrl` as if it were both the provider URL and request transport URL. In local proxy mode, `resolveAiRequestBaseUrl()` changes a user-entered provider URL into `http://127.0.0.1:18787/v1`, but `scripts/api-proxy.mjs` still forwards to the environment/default upstream. This makes a page-entered custom provider look configured while the proxy may call the wrong upstream.

### Task 2: Test Provider URL Forwarding

**Files:**
- Modify: `scripts/api-proxy.test.mjs`
- Modify: `src/core/__tests__/apiConnection.test.ts`
- Modify: `src/core/__tests__/apiSettings.test.ts`
- Modify: `src/core/__tests__/aiProvider.test.ts`

- [x] **Step 1: Add failing proxy tests**

Add tests proving `/health` and `/v1/chat/completions` accept a browser-provided upstream Base URL via a Jujiang header and forward to that upstream.

- [x] **Step 2: Add failing frontend core tests**

Add tests proving saved AI settings persist provider profile fields, diagnostics pass provider Base URL to the proxy, and AI provider requests include the upstream Base URL header.

### Task 3: Implement Provider Profile Gateway

**Files:**
- Modify: `scripts/api-proxy.mjs`
- Modify: `src/core/apiConnection.ts`
- Modify: `src/core/apiSettings.ts`
- Modify: `src/core/aiProvider.ts`

- [x] **Step 1: Add per-request upstream routing**

Read `X-Jujiang-Target-Base-Url` in the proxy, normalize it with the existing compatible `/v1` rule, reject invalid non-http URLs, and use it for health and chat completion forwarding.

- [x] **Step 2: Separate app transport from provider profile**

Keep `defaultLocalProxyBaseUrl` as the app gateway transport. Add `providerBaseUrl` to diagnostics and AI provider settings so the page can keep the user-entered provider URL intact.

- [x] **Step 3: Persist provider profile**

Extend saved settings with `providerId`, `providerName`, and `providerBaseUrl`, while migrating old saved settings that only have `baseUrl`.

### Task 4: Simplify Product UI and Startup

**Files:**
- Modify: `src/App.tsx`
- Create: `scripts/dev-app.mjs`
- Modify: `package.json`

- [x] **Step 1: Replace proxy/direct controls**

Remove the visible local proxy toggle. Show provider preset, Base URL, model, API Key, remember setting, and connection test. The status copy should talk about app service/provider connection, not CORS or proxy internals.

- [x] **Step 2: Add provider presets**

Add presets for OpenAI-compatible custom, OpenAI, DeepSeek, Qwen compatible, and Doubao/Volcengine compatible. Selecting a preset fills Base URL and a reasonable default model but still allows editing.

- [x] **Step 3: Add one-command dev startup**

Add `npm run dev:app` to start both `scripts/api-proxy.mjs` and Vite, so a local demo does not require two terminal commands.

### Task 5: Docs, Verification, PR

**Files:**
- Modify: `README.md`
- Modify: `docs/reference-analysis.md`

- [x] **Step 1: Update docs**

Rewrite API setup docs around `npm run dev:app`, provider profile fields, remembered key behavior, and optional environment variables for shared/demo machines.

- [x] **Step 2: Verify**

Run:
- `npm test`
- `npm run build`
- `npm audit --audit-level=moderate`
- `git diff --check`

- [ ] **Step 3: PR**

Commit with a Conventional Commits message, push the branch, create a PR with an English Conventional Commits title and a Chinese, specific, human PR body.
