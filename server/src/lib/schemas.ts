import { z } from 'zod';

export const idSchema = z.string().min(1).max(100);
export const emptyBodySchema = z.object({}).strict().optional().transform((value) => value ?? {});
const safeGeneratedText = (maximumLength: number) => z.string().trim().min(1).max(maximumLength).refine(
  (text) => !/\b(?:diagnos(?:e|is|ed|ing)|medicat(?:e|ion|ions|ed|ing)|prescrib(?:e|ed|ing)|dosage|dose of|treat(?:ment|s|ed|ing)?|cur(?:e|es|ed|ing)|slow(?:s|ed|ing)? dementia)\b/i.test(text),
  'Generated text contains medical advice or a medical claim.',
);
export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
}).strict();

export const patientCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
}).strict();

export const captionSchema = z.object({
  caption: z.string().trim().min(1).max(500),
}).strict();

export const externalImageSchema = z.object({
  url: z.string().url(),
  sourcePageUrl: z.string().url(),
  licenseName: z.string().trim().min(1).max(100),
  licenseUrl: z.string().url(),
  attribution: z.string().trim().min(1).max(400),
}).strict();

export const storyGenerateSchema = z.object({
  prompt: z.string().trim().min(5).max(2000),
}).strict();

const baseSceneSchema = z.object({
  photoId: idSchema.nullable(),
  imageSearchQuery: z.string().trim().min(1).max(120).optional(),
  externalImage: externalImageSchema.optional(),
  narration: z.string().trim().min(1).max(600),
  recallQuestion: z.string().trim().min(1).max(240),
  expectedAnswer: z.string().trim().min(1).max(200),
  answerOptions: z.array(z.string().trim().min(1).max(200)).min(2).max(3),
}).strict();

const uniqueAnswerOptions = (scene: { answerOptions: string[] }) =>
  new Set(scene.answerOptions).size === scene.answerOptions.length;

export const sceneSchema = baseSceneSchema.refine(uniqueAnswerOptions, {
  message: 'Answer choices must be different.',
});

const generatedSceneSchema = baseSceneSchema.extend({
  imageSearchQuery: safeGeneratedText(120),
}).strict().refine(uniqueAnswerOptions, {
  message: 'Answer choices must be different.',
});

export const storyDraftUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(5).max(2000),
  scenes: z.array(sceneSchema).min(1).max(8),
  experienceMode: z.enum(['STORY', '3D']).default('STORY'),
}).strict();

export const assignStorySchema = z.object({ patientId: idSchema }).strict();
export const sessionCreateSchema = z.object({
  storyId: idSchema,
  caregiverPresent: z.literal(true),
}).strict();

export const sessionCompleteSchema = z.object({
  answers: z.array(z.object({
    sceneIndex: z.number().int().min(0).max(7),
    selectedAnswer: z.string().trim().min(1).max(200),
  }).strict()).min(1).max(8),
}).strict();

export const alertFallbackSchema = z.object({ fallbackShown: z.literal(true) }).strict();

export const patientStoryTranslateSchema = z.object({
  storyIds: z.array(idSchema).min(1).max(20).refine((ids) => new Set(ids).size === ids.length),
  locale: z.literal('hi-IN'),
}).strict();

export const careGoalCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  measure: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(40),
  baselineValue: z.number().finite().min(-10000000).max(10000000).optional(),
  targetValue: z.number().finite().min(-10000000).max(10000000).optional(),
  reviewDate: z.string().date().optional(),
  notes: z.string().trim().max(600).optional(),
}).strict();

export const careMeasurementSchema = z.object({
  value: z.number().finite().min(-10000000).max(10000000),
  measuredAt: z.string().datetime().optional(),
  note: z.string().trim().max(300).optional(),
}).strict();

export const medicalRecordAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(1600),
  observations: z.array(z.object({
    recordedAt: z.string().date().nullable(),
    category: z.enum(['measurement', 'symptom', 'medication', 'diagnosis', 'procedure', 'other']),
    label: z.string().trim().min(1).max(100),
    detail: z.string().trim().min(1).max(400),
    numericValue: z.number().finite().min(-10000000).max(10000000).nullable(),
    unit: z.string().trim().max(40),
    sourceExcerpt: z.string().trim().max(240),
  }).strict()).max(30),
}).strict();

const hindiText = (maximumLength: number) => z.string().trim().min(1).max(maximumLength).refine(
  (text) => /[\u0900-\u097f]/u.test(text),
  'Hindi translation must use Devanagari script.',
);

export const patientStoryTranslationSchema = z.object({
  stories: z.array(z.object({
    id: idSchema,
    title: hindiText(160),
    scenes: z.array(z.object({
      narration: hindiText(600),
      recallQuestion: hindiText(240),
      expectedAnswer: hindiText(200),
      answerOptions: z.array(hindiText(200)).min(2).max(3),
    }).strict().refine((scene) => scene.answerOptions.includes(scene.expectedAnswer), {
      message: 'Translated choices must include the expected answer.',
    })).min(1).max(8),
  }).strict()).max(20),
}).strict();

export const geminiStorySchema = z.object({
  title: safeGeneratedText(160),
  scenes: z.array(generatedSceneSchema).min(1).max(8),
}).strict().superRefine((story, context) => {
  story.scenes.forEach((scene, index) => {
    const textFields = [
      ...(scene.imageSearchQuery ? [['imageSearchQuery', scene.imageSearchQuery] as const] : []),
      ['narration', scene.narration],
      ['recallQuestion', scene.recallQuestion],
      ['expectedAnswer', scene.expectedAnswer],
    ] as const;
    for (const [field, text] of textFields) {
      if (!safeGeneratedText(1200).safeParse(text).success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, field],
          message: 'Generated text contains medical advice or a medical claim.',
        });
      }
    }
    scene.answerOptions.forEach((answer, answerIndex) => {
      if (!safeGeneratedText(200).safeParse(answer).success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', index, 'answerOptions', answerIndex],
          message: 'Generated text contains medical advice or a medical claim.',
        });
      }
    });
    if (!scene.answerOptions.includes(scene.expectedAnswer)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenes', index, 'answerOptions'],
        message: 'Answer choices must include the expected answer.',
      });
    }
  });
});

export const geminiSummarySchema = z.object({
  summary: safeGeneratedText(1200),
  concerns: z.array(safeGeneratedText(240)).max(5),
  doctorReviewNote: safeGeneratedText(300),
}).strict();
