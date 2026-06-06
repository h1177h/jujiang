export interface AiSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedAiSettings {
  useApi: boolean;
  useLocalProxy: boolean;
  providerId?: string;
  providerName?: string;
  baseUrl: string;
  providerBaseUrl?: string;
  model: string;
  apiKey: string;
}

export const aiSettingsStorageKey = "jujiang.aiSettings";

export function loadSavedAiSettings(storage: AiSettingsStorage | null): SavedAiSettings | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(aiSettingsStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedAiSettings>;

    if (
      typeof parsed.useApi !== "boolean" ||
      typeof parsed.useLocalProxy !== "boolean" ||
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.model !== "string" ||
      typeof parsed.apiKey !== "string"
    ) {
      return null;
    }

    const providerFields =
      typeof parsed.providerId === "string" &&
      typeof parsed.providerName === "string" &&
      typeof parsed.providerBaseUrl === "string"
        ? {
            providerId: parsed.providerId,
            providerName: parsed.providerName,
            providerBaseUrl: parsed.providerBaseUrl
          }
        : {};

    return {
      useApi: parsed.useApi,
      useLocalProxy: parsed.useLocalProxy,
      ...providerFields,
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      apiKey: parsed.apiKey
    };
  } catch {
    return null;
  }
}

export function saveAiSettings(settings: SavedAiSettings, storage: AiSettingsStorage | null): void {
  if (!storage) return;
  storage.setItem(aiSettingsStorageKey, JSON.stringify(settings));
}

export function clearSavedAiSettings(storage: AiSettingsStorage | null): void {
  if (!storage) return;
  storage.removeItem(aiSettingsStorageKey);
}

export function getBrowserStorage(): AiSettingsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
