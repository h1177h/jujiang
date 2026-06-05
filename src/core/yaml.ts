import { parse } from "yaml";
import { stringify } from "yaml";
import { validateScreenplay } from "./schema";
import type { ScreenplayYaml } from "./types";

export function screenplayToYaml(screenplay: ScreenplayYaml): string {
  return stringify(screenplay, {
    collectionStyle: "block",
    lineWidth: 100
  });
}

export function validateScreenplayYaml(yamlText: string): {
  ok: boolean;
  errors: string[];
} {
  try {
    const parsed = parse(yamlText);
    const validation = validateScreenplay(parsed);
    if (validation.success) {
      return { ok: true, errors: [] };
    }

    return {
      ok: false,
      errors: validation.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "YAML 解析失败"]
    };
  }
}
