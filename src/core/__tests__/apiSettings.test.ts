import { describe, expect, it } from "vitest";
import {
  clearSavedAiSettings,
  loadSavedAiSettings,
  saveAiSettings,
  type AiSettingsStorage
} from "../apiSettings";

function createMemoryStorage(): AiSettingsStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

describe("AI settings persistence", () => {
  it("saves and loads remembered direct API settings", () => {
    const storage = createMemoryStorage();

    saveAiSettings(
      {
        useApi: true,
        useLocalProxy: false,
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "sk-test"
      },
      storage
    );

    expect(loadSavedAiSettings(storage)).toEqual({
      useApi: true,
      useLocalProxy: false,
      baseUrl: "https://api.example.com/v1",
      model: "gpt-4.1-mini",
      apiKey: "sk-test"
    });
  });

  it("clears saved settings", () => {
    const storage = createMemoryStorage();

    saveAiSettings(
      {
        useApi: true,
        useLocalProxy: false,
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "sk-test"
      },
      storage
    );
    clearSavedAiSettings(storage);

    expect(loadSavedAiSettings(storage)).toBeNull();
  });

  it("ignores corrupted storage values", () => {
    const storage = createMemoryStorage();
    storage.setItem("jujiang.aiSettings", "{bad json");

    expect(loadSavedAiSettings(storage)).toBeNull();
  });
});
