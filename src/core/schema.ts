import { z } from "zod";

export const sourceLocatorSchema = z.object({
  chapterIndex: z.number().int().positive(),
  chapterTitle: z.string().min(1),
  paragraphIndexes: z.array(z.number().int().nonnegative()).min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  excerpt: z.string().min(1)
});

export const storyBlueprintSchema = z.object({
  chapterEvents: z
    .array(
      z.object({
        chapterIndex: z.number().int().positive(),
        chapterTitle: z.string().min(1),
        chapterGoal: z.string().min(1),
        events: z
          .array(
            z.object({
              id: z.string().min(1),
              summary: z.string().min(1),
              characters: z.array(z.string()).min(1),
              location: z.string().min(1),
              conflict: z.string().min(1),
              emotionalTurn: z.string().min(1),
              source: sourceLocatorSchema
            })
          )
          .min(1)
      })
    )
    .min(1),
  storyBible: z.object({
    worldview: z.string().min(1),
    coreConflict: z.string().min(1),
    timeline: z.array(z.string()).min(1),
    characterArcs: z
      .array(
        z.object({
          character: z.string().min(1),
          arc: z.string().min(1),
          firstEventId: z.string().min(1),
          lastEventId: z.string().min(1)
        })
      )
      .min(1)
  }),
  adaptationStrategy: z.object({
    format: z.string().min(1),
    pacing: z.string().min(1),
    sceneRules: z.array(z.string()).min(1),
    riskControls: z.array(z.string()).min(1)
  })
});

export const sceneSchema = z.object({
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
});

export const screenplaySchema = z
  .object({
  work: z.object({
    title: z.string().min(1),
    adaptationStyle: z.enum(["balanced", "cinematic", "stage", "short_drama"]),
    logline: z.string().min(1),
    sourceChapterCount: z.number().int().min(1),
    generatedBy: z.string().min(1)
  }),
  adaptationPlan: z.object({
    premise: z.string().min(1),
    tone: z.string().min(1),
    targetAudience: z.string().min(1),
    structure: z.array(z.string()).min(1),
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
  chapterEvents: storyBlueprintSchema.shape.chapterEvents,
  storyBible: storyBlueprintSchema.shape.storyBible,
  adaptationStrategy: storyBlueprintSchema.shape.adaptationStrategy,
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
    .min(1),
  scenes: z.array(sceneSchema).min(1),
  rhythmStats: z.object({
    sceneCount: z.number().int().min(1),
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
})
  .superRefine((screenplay, ctx) => {
    const sourceChapterCount = screenplay.work.sourceChapterCount;
    const sceneIds = new Set(screenplay.scenes.map((scene) => scene.id));
    const characterRefs = new Set(screenplay.characters.flatMap((character) => [character.id, character.name]));
    const addChapterRangeIssue = (path: (string | number)[], chapterIndex: number) => {
      if (chapterIndex > sourceChapterCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `chapterIndex must be within sourceChapterCount (${sourceChapterCount})`
        });
      }
    };
    const addSceneReferenceIssue = (path: (string | number)[], sceneId: string) => {
      if (!sceneIds.has(sceneId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `sceneId must reference an existing scene (${sceneId})`
        });
      }
    };
    const addCharacterReferenceIssue = (path: (string | number)[], characterRef: string) => {
      if (!characterRefs.has(characterRef)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `character must reference an existing character (${characterRef})`
        });
      }
    };

    screenplay.chapterEvents.forEach((group, groupIndex) => {
      addChapterRangeIssue(["chapterEvents", groupIndex, "chapterIndex"], group.chapterIndex);
      group.events.forEach((event, eventIndex) => {
        addChapterRangeIssue(
          ["chapterEvents", groupIndex, "events", eventIndex, "source", "chapterIndex"],
          event.source.chapterIndex
        );
        event.characters.forEach((character, characterIndex) => {
          addCharacterReferenceIssue(
            ["chapterEvents", groupIndex, "events", eventIndex, "characters", characterIndex],
            character
          );
        });
      });
    });

    screenplay.characters.forEach((character, characterIndex) => {
      addChapterRangeIssue(["characters", characterIndex, "firstSeenChapter"], character.firstSeenChapter);
    });

    screenplay.storyBible.characterArcs.forEach((arc, arcIndex) => {
      addCharacterReferenceIssue(["storyBible", "characterArcs", arcIndex, "character"], arc.character);
    });

    screenplay.chapterMappings.forEach((mapping, mappingIndex) => {
      addChapterRangeIssue(["chapterMappings", mappingIndex, "chapterIndex"], mapping.chapterIndex);
      mapping.sceneIds.forEach((sceneId, sceneIdIndex) => {
        addSceneReferenceIssue(["chapterMappings", mappingIndex, "sceneIds", sceneIdIndex], sceneId);
      });
    });

    screenplay.rhythmStats.highConflictSceneIds.forEach((sceneId, sceneIdIndex) => {
      addSceneReferenceIssue(["rhythmStats", "highConflictSceneIds", sceneIdIndex], sceneId);
    });

    addSceneReferenceIssue(
      ["storyDiagnostics", "strongestConflictSceneId"],
      screenplay.storyDiagnostics.strongestConflictSceneId
    );

    screenplay.scenes.forEach((scene, sceneIndex) => {
      addChapterRangeIssue(["scenes", sceneIndex, "chapterIndex"], scene.chapterIndex);
      addChapterRangeIssue(["scenes", sceneIndex, "source", "chapterIndex"], scene.source.chapterIndex);
      scene.characters.forEach((character, characterIndex) => {
        addCharacterReferenceIssue(["scenes", sceneIndex, "characters", characterIndex], character);
      });
      scene.dialogue.forEach((line, lineIndex) => {
        addCharacterReferenceIssue(["scenes", sceneIndex, "dialogue", lineIndex, "speaker"], line.speaker);
        addChapterRangeIssue(
          ["scenes", sceneIndex, "dialogue", lineIndex, "source", "chapterIndex"],
          line.source.chapterIndex
        );
      });
    });
  });

export type ScreenplaySchema = z.infer<typeof screenplaySchema>;
export type StoryBlueprintSchema = z.infer<typeof storyBlueprintSchema>;

export function validateScreenplay(value: unknown) {
  return screenplaySchema.safeParse(value);
}

export function validateStoryBlueprint(value: unknown) {
  return storyBlueprintSchema.safeParse(value);
}

export function validateScene(value: unknown) {
  return sceneSchema.safeParse(value);
}
