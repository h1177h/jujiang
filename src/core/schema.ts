import { z } from "zod";

export const sourceLocatorSchema = z.object({
  chapterIndex: z.number().int().positive(),
  chapterTitle: z.string().min(1),
  paragraphIndexes: z.array(z.number().int().nonnegative()).min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  excerpt: z.string().min(1)
});

export const screenplaySchema = z.object({
  work: z.object({
    title: z.string().min(1),
    adaptationStyle: z.enum(["balanced", "cinematic", "stage", "short_drama"]),
    logline: z.string().min(1),
    sourceChapterCount: z.number().int().min(3),
    generatedBy: z.literal("jujiang-fallback-engine")
  }),
  adaptationPlan: z.object({
    premise: z.string().min(1),
    tone: z.string().min(1),
    targetAudience: z.string().min(1),
    structure: z.array(z.string()).min(3),
    nextRevisionFocus: z.array(z.string()).min(1)
  }),
  characters: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        role: z.enum(["protagonist", "supporting", "unknown"]),
        traits: z.array(z.string()).min(1),
        firstSeenChapter: z.number().int().positive(),
        relationshipSummary: z.string().min(1)
      })
    )
    .min(1),
  chapterMappings: z
    .array(
      z.object({
        chapterIndex: z.number().int().positive(),
        novelTitle: z.string().min(1),
        sceneIds: z.array(z.string()).min(1),
        summary: z.string().min(1),
        sourceLines: z.tuple([z.number().int().positive(), z.number().int().positive()])
      })
    )
    .min(3),
  scenes: z
    .array(
      z.object({
        id: z.string().min(1),
        chapterIndex: z.number().int().positive(),
        beatIndex: z.number().int().positive(),
        beatType: z.enum(["setup", "turning_point", "payoff"]),
        title: z.string().min(1),
        goal: z.string().min(1),
        location: z.string().min(1),
        time: z.string().min(1),
        characters: z.array(z.string()).min(1),
        action: z.array(z.string()).min(1),
        dialogue: z.array(
          z.object({
            speaker: z.string().min(1),
            line: z.string().min(1),
            intent: z.string().min(1),
            emotion: z.string().min(1),
            source: sourceLocatorSchema
          })
        ),
        narrationOrTransition: z.string().min(1),
        emotion: z.string().min(1),
        pacing: z.enum(["quiet", "steady", "tense", "cliffhanger"]),
        conflict: z.object({
          level: z.union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5)
          ]),
          reason: z.string().min(1)
        }),
        revisionNotes: z.array(z.string()).min(1),
        source: sourceLocatorSchema
      })
    )
    .min(3),
  rhythmStats: z.object({
    sceneCount: z.number().int().min(3),
    dialogueCount: z.number().int().nonnegative(),
    averageConflict: z.number().min(1).max(5),
    highConflictSceneIds: z.array(z.string())
  }),
  storyDiagnostics: z.object({
    paragraphCount: z.number().int().positive(),
    sourceCoverage: z.string().min(1),
    strongestConflictSceneId: z.string().min(1),
    pacingSummary: z.string().min(1),
    warnings: z.array(z.string())
  }),
  validationHints: z.array(z.string())
});

export type ScreenplaySchema = z.infer<typeof screenplaySchema>;

export function validateScreenplay(value: unknown) {
  return screenplaySchema.safeParse(value);
}
