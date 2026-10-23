import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
import { AIServiceError } from '../lib/errors.js';
import {
  geminiStorySchema,
  geminiSummarySchema,
  medicalRecordAnalysisSchema,
  patientStoryTranslationSchema,
  type sceneSchema,
} from '../lib/schemas.js';
import { z, ZodError } from 'zod';

type Scene = z.infer<typeof sceneSchema>;

const promptDirectory = new URL('../prompts/', import.meta.url);
const generationCache = new Map<string, { expiresAt: number; value: z.infer<typeof geminiStorySchema> }>();
const patientTranslationCache = new Map<string, { expiresAt: number; value: z.infer<typeof patientStoryTranslationSchema> }>();
const model = 'gemini-3.5-flash-lite';
const sceneResponseSchema = {
  type: 'object',
  properties: {
    photoId: { type: ['string', 'null'] },
    imageSearchQuery: { type: 'string' },
    narration: { type: 'string' },
    recallQuestion: { type: 'string' },
    expectedAnswer: { type: 'string' },
    answerOptions: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
  },
  required: ['photoId', 'imageSearchQuery', 'narration', 'recallQuestion', 'expectedAnswer', 'answerOptions'],
  additionalProperties: false,
};
const storyResponseSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    scenes: { type: 'array', items: sceneResponseSchema, minItems: 1, maxItems: 8 },
  },
  required: ['title', 'scenes'],
  additionalProperties: false,
};
const summaryResponseSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    doctorReviewNote: { type: 'string' },
  },
  required: ['summary', 'concerns', 'doctorReviewNote'],
  additionalProperties: false,
};
const translatedStoryResponseSchema = {
  type: 'object',
  properties: {
    stories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                narration: { type: 'string' },
                recallQuestion: { type: 'string' },
                expectedAnswer: { type: 'string' },
                answerOptions: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
              },
              required: ['narration', 'recallQuestion', 'expectedAnswer', 'answerOptions'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'title', 'scenes'],
        additionalProperties: false,
      },
    },
  },
  required: ['stories'],
  additionalProperties: false,
};
const medicalRecordResponseSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    observations: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          recordedAt: { type: ['string', 'null'] },
          category: { type: 'string', enum: ['measurement', 'symptom', 'medication', 'diagnosis', 'procedure', 'other'] },
          label: { type: 'string' },
          detail: { type: 'string' },
          numericValue: { type: ['number', 'null'] },
          unit: { type: 'string' },
          sourceExcerpt: { type: 'string' },
        },
        required: ['recordedAt', 'category', 'label', 'detail', 'numericValue', 'unit', 'sourceExcerpt'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'observations'],
  additionalProperties: false,
};
const promptStopWords = new Set([
  'about', 'after', 'also', 'and', 'are', 'ask', 'at', 'before', 'been', 'being', 'but', 'can',
  'create', 'did', 'do', 'does', 'each', 'exactly', 'for', 'from', 'generate', 'gentle', 'have',
  'into', 'make', 'must', 'not', 'one', 'patient', 'please', 'scene', 'scenes', 'short', 'should',
  'story', 'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this', 'those', 'use', 'was',
  'were', 'what', 'when', 'where', 'which', 'with', 'write', 'you',
]);

function contentKeywords(text: string) {
  return new Set(text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !promptStopWords.has(word))
    .map((word) => word.endsWith('ies') && word.length > 5
      ? `${word.slice(0, -3)}y`
      : word.endsWith('s') && word.length > 4 && !word.endsWith('ss')
        ? word.slice(0, -1)
        : word));
}

export function hasEnoughStoryPromptDetail(prompt: string) {
  return contentKeywords(prompt).size >= 3;
}

export function sceneUsesSourceDetail(sceneText: string, sourceText: string) {
  const sourceKeywords = contentKeywords(sourceText);
  const sceneKeywords = contentKeywords(sceneText);
  return [...sourceKeywords].some((keyword) => sceneKeywords.has(keyword));
}

export function isGenericRecallQuestion(question: string) {
  const normalized = question.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:what do you see|what did you see|what is happening|what happened|what are you doing|what are you looking at|where are you(?: sitting| standing| going)?|what is around you)\b/.test(normalized);
}

export function isSpecificRecallQuestion(question: string, narration: string) {
  if (isGenericRecallQuestion(question)) return false;
  const questionKeywords = contentKeywords(question);
  const narrationKeywords = contentKeywords(narration);
  return questionKeywords.size >= 2 && [...questionKeywords].some((keyword) => narrationKeywords.has(keyword));
}

export function requestedSceneCount(prompt: string) {
  const match = prompt.match(/\b(?:exactly|create|make|write|generate|with|have|has|contain|contains)\s+(?:exactly\s+)?(1|2|3|4|5|6|7|8|one|two|three|four|five|six|seven|eight)(?:\s+(?:short|brief|gentle|original|custom|story|narrative))?\s+scenes?\b/i);
  if (!match) return undefined;
  const count = match[1].toLowerCase();
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
  };
  return words[count] ?? Number(count);
}

export function requestedExactQuestions(prompt: string) {
  return [...prompt.matchAll(/["“]([^"”]{1,240}\?)["”]/g)]
    .map((match) => match[1]);
}

function recordCall() {
  console.info(JSON.stringify({
    type: 'gemini_call',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  }));
}

function friendlyError(error: unknown): AIServiceError {
  const detail = error instanceof Error ? error.message : '';
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const safeDetail = detail
    .replaceAll(process.env.GEMINI_API_KEY ?? '', '[redacted]')
    .slice(0, 300);
  console.warn(JSON.stringify({
    type: 'gemini_request_failed',
    errorType: error instanceof Error ? error.name : 'UnknownError',
    status: typeof status === 'number' || typeof status === 'string' ? status : undefined,
    code: typeof code === 'number' || typeof code === 'string' ? code : undefined,
    detail: safeDetail,
  }));
  if (/429|resource_exhausted|rate.?limit/i.test(detail)) {
    return new AIServiceError(429, 'The story assistant is busy right now. Please wait a moment and try again.');
  }
  if (!process.env.GEMINI_API_KEY) {
    return new AIServiceError(503, 'Story drafting is unavailable until the server Gemini key is configured.');
  }
  return new AIServiceError(502, 'The story assistant could not complete that request. Please try again.');
}

async function generateJson(systemInstruction: string, contents: string, responseJsonSchema: object) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AIServiceError(503, 'Story drafting is unavailable until the server Gemini key is configured.');
  recordCall();
  const ai = new GoogleGenAI({ apiKey });
  try {
    const result = await ai.models.generateContent({
      model,
      contents,
      config: { responseMimeType: 'application/json', responseJsonSchema, systemInstruction },
    });
    const text = result.text;
    if (!text) throw new Error('Empty AI response');
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function draftStory(
  prompt: string,
  photos: Array<{ id: string; caption: string }>,
): Promise<{ title: string; scenes: Scene[] }> {
  if (!hasEnoughStoryPromptDetail(prompt)) {
    throw new AIServiceError(400, 'Please add concrete story details, such as what happens in each scene and what the patient should remember. A topic alone is not enough to create specific recall questions.');
  }

  const keyedPhotos = photos.map((photo, index) => ({
    id: `photo_${index + 1}`,
    caption: photo.caption,
    databaseId: photo.id,
  }));
  const key = createHash('sha256').update(JSON.stringify({ prompt, photos: keyedPhotos.map(({ id, caption }) => ({ id, caption })) })).digest('hex');
  const cached = generationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      title: cached.value.title,
      scenes: cached.value.scenes.map((scene) => ({
        ...scene,
        photoId: keyedPhotos.find((photo) => photo.id === scene.photoId)?.databaseId ?? null,
      })),
    };
  }

  const systemPrompt = await readFile(new URL('story-generator.txt', promptDirectory), 'utf8');
  const input = JSON.stringify({
    doctorPrompt: prompt,
    photos: keyedPhotos.map(({ id, caption }) => ({ id, caption })),
    photoChoiceNote: keyedPhotos.length > 0
      ? 'Choose a supplied photo ID only when it clearly fits a scene. Otherwise use null and provide generic image search terms.'
      : 'There are no patient photos. Use null for every photoId and provide generic image search terms for each scene.',
  });
  const sceneCount = requestedSceneCount(prompt);
  const exactQuestions = requestedExactQuestions(prompt);
  const sourceText = `${prompt} ${keyedPhotos.map((photo) => photo.caption).join(' ')}`;

  let parsed: z.infer<typeof geminiStorySchema> | undefined;
  let rejectedForSpecificity = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: unknown;
    try {
      const attemptPrompt = attempt === 0 ? systemPrompt : `${systemPrompt}

Your previous draft was rejected because it included generic or off-prompt scenes/questions. Keep every scene grounded in a concrete detail from the doctor's prompt or a supplied photo caption. Every recall question must ask about that scene's specific detail. Do not use generic questions such as "Where are you sitting?" or "What do you see?".`;
      response = await generateJson(attemptPrompt, input, storyResponseSchema);
      const attemptStory = geminiStorySchema.parse(response);
      parsed = attemptStory;
      const allowedIds = new Set(keyedPhotos.map((photo) => photo.id));
      const invalidPhoto = attemptStory.scenes.some((scene) => scene.photoId !== null && !allowedIds.has(scene.photoId));
      const wrongSceneCount = sceneCount !== undefined && attemptStory.scenes.length !== sceneCount;
      const missingExactQuestions = exactQuestions.filter((question) =>
        !attemptStory.scenes.some((scene) => scene.recallQuestion === question));
      const genericQuestions = attemptStory.scenes.some((scene) =>
        !exactQuestions.includes(scene.recallQuestion)
          && !isSpecificRecallQuestion(scene.recallQuestion, scene.narration));
      const ungroundedScenes = attemptStory.scenes.some((scene) =>
        !sceneUsesSourceDetail(`${scene.narration} ${scene.recallQuestion} ${scene.expectedAnswer}`, sourceText));
      rejectedForSpecificity ||= genericQuestions || ungroundedScenes;
      if (invalidPhoto || wrongSceneCount || missingExactQuestions.length > 0 || genericQuestions || ungroundedScenes) {
        if (wrongSceneCount || missingExactQuestions.length > 0 || genericQuestions || ungroundedScenes) {
          console.warn(JSON.stringify({
            type: 'gemini_output_rejected_by_prompt_constraints',
            attempt: attempt + 1,
            expectedSceneCount: sceneCount,
            actualSceneCount: attemptStory.scenes.length,
            exactQuestionCount: exactQuestions.length,
            missingExactQuestionCount: missingExactQuestions.length,
            genericQuestionCount: attemptStory.scenes.filter((scene) =>
              !exactQuestions.includes(scene.recallQuestion)
                && !isSpecificRecallQuestion(scene.recallQuestion, scene.narration)).length,
            ungroundedSceneCount: attemptStory.scenes.filter((scene) => {
              return !sceneUsesSourceDetail(
                `${scene.narration} ${scene.recallQuestion} ${scene.expectedAnswer}`,
                sourceText,
              );
            }).length,
          }));
        }
        parsed = undefined;
      } else {
        break;
      }
    } catch (error) {
      if (error instanceof AIServiceError && error.status !== 502) throw error;
      if (error instanceof ZodError) {
        console.warn(JSON.stringify({
          type: 'gemini_output_rejected',
          attempt: attempt + 1,
          issues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
        }));
      } else if (error instanceof SyntaxError) {
        console.warn(JSON.stringify({ type: 'gemini_invalid_json', attempt: attempt + 1 }));
      }
      parsed = undefined;
    }
  }
  if (!parsed) {
    if (rejectedForSpecificity) {
      throw new AIServiceError(502, 'The story assistant could not create specific, prompt-related scenes and recall questions. Add more scene details or write the exact questions you want, then try again.');
    }
    throw new AIServiceError(502, 'The story assistant returned an unusable draft twice. Please adjust the prompt and try again.');
  }

  generationCache.set(key, { expiresAt: Date.now() + 10 * 60 * 1000, value: parsed });
  return {
    title: parsed.title,
    scenes: parsed.scenes.map((scene) => ({
      ...scene,
      photoId: scene.photoId === null
        ? null
        : keyedPhotos.find((photo) => photo.id === scene.photoId)!.databaseId,
    })),
  };
}

export async function summarizeSession(results: unknown) {
  const systemPrompt = await readFile(new URL('session-summariser.txt', promptDirectory), 'utf8');
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await generateJson(systemPrompt, `Session results:\n${JSON.stringify(results)}`, summaryResponseSchema);
      return geminiSummarySchema.parse(response);
    } catch (error) {
      if (error instanceof AIServiceError && error.status !== 502) throw error;
      lastError = error;
    }
  }
  if (lastError) {
    throw new AIServiceError(502, 'A session summary could not be generated. The session data is saved and can be reviewed later.');
  }
  throw new AIServiceError(502, 'A session summary could not be generated. Please try again.');
}

export async function analyzeMedicalRecord(file: Buffer, mimeType: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AIServiceError(503, 'Medical history extraction is unavailable until the server Gemini key is configured.');
  const systemPrompt = await readFile(new URL('medical-history-extractor.txt', promptDirectory), 'utf8');
  recordCall();
  const ai = new GoogleGenAI({ apiKey });
  try {
    const result = await ai.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [
          { text: 'Extract historical facts from this uploaded medical record. Do not provide advice.' },
          { inlineData: { mimeType, data: file.toString('base64') } },
        ],
      }],
      config: { responseMimeType: 'application/json', responseJsonSchema: medicalRecordResponseSchema, systemInstruction: systemPrompt },
    });
    if (!result.text) throw new Error('Empty AI response');
    return medicalRecordAnalysisSchema.parse(JSON.parse(result.text) as unknown);
  } catch (error) {
    console.warn(JSON.stringify({
      type: 'medical_record_extraction_failed',
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }));
    if (error instanceof AIServiceError) throw error;
    throw new AIServiceError(502, 'AI could not extract this history. The uploaded document is saved; please try again later.');
  }
}

export async function translatePatientStories(stories: Array<{
  id: string;
  title: string;
  scenes: Array<{
    narration: string;
    recallQuestion: string;
    expectedAnswer: string;
    answerOptions: string[];
  }>;
}>): Promise<z.infer<typeof patientStoryTranslationSchema>> {
  if (stories.length === 0) return { stories: [] };
  const cacheKey = createHash('sha256').update(JSON.stringify(stories)).digest('hex');
  const cached = patientTranslationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const systemPrompt = await readFile(new URL('patient-translator.txt', promptDirectory), 'utf8');
  const fictionalizedStories = stories.map((story, index) => ({
    id: `story_${index + 1}`,
    title: story.title,
    scenes: story.scenes,
  }));
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await generateJson(
        systemPrompt,
        JSON.stringify({ stories: fictionalizedStories }),
        translatedStoryResponseSchema,
      );
      const translated = patientStoryTranslationSchema.parse(response);
      if (translated.stories.length !== stories.length) throw new ZodError([]);
      const validTranslations = translated.stories.every((translation, index) => {
        const source = stories[index];
        return translation.id === fictionalizedStories[index].id
          && translation.scenes.length === source.scenes.length
          && translation.scenes.every((scene, sceneIndex) =>
            scene.answerOptions.length === source.scenes[sceneIndex].answerOptions.length);
      });
      if (!validTranslations) throw new ZodError([]);
      const result = {
        stories: translated.stories.map((story, index) => ({
          ...story,
          id: stories[index].id,
        })),
      };
      patientTranslationCache.set(cacheKey, { expiresAt: Date.now() + 60 * 60 * 1000, value: result });
      return result;
    } catch (error) {
      if (error instanceof AIServiceError && error.status !== 502) throw error;
      lastError = error;
      console.warn(JSON.stringify({
        type: 'patient_story_translation_rejected',
        attempt: attempt + 1,
        errorType: error instanceof ZodError ? 'validation' : error instanceof SyntaxError ? 'json' : 'service',
      }));
    }
  }
  if (lastError) {
    throw new AIServiceError(502, 'Hindi translation could not be prepared. Please switch to English or try again.');
  }
  throw new AIServiceError(502, 'Hindi translation could not be prepared. Please switch to English or try again.');
}
