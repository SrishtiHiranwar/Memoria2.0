import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
import { AIServiceError } from '../lib/errors.js';
import {
  geminiStorySchema,
  geminiSummarySchema,
  type sceneSchema,
} from '../lib/schemas.js';
import { z, ZodError } from 'zod';

type Scene = z.infer<typeof sceneSchema>;

const promptDirectory = new URL('../prompts/', import.meta.url);
const generationCache = new Map<string, { expiresAt: number; value: z.infer<typeof geminiStorySchema> }>();
const model = 'gemini-3.5-flash-lite';
const sceneResponseSchema = {
  type: 'object',
  properties: {
    photoId: { type: 'string' },
    narration: { type: 'string' },
    recallQuestion: { type: 'string' },
    expectedAnswer: { type: 'string' },
    answerOptions: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 },
  },
  required: ['photoId', 'narration', 'recallQuestion', 'expectedAnswer', 'answerOptions'],
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
        photoId: keyedPhotos.find((photo) => photo.id === scene.photoId)?.databaseId ?? scene.photoId,
      })),
    };
  }

  const systemPrompt = await readFile(new URL('story-generator.txt', promptDirectory), 'utf8');
  const input = JSON.stringify({
    doctorPrompt: prompt,
    photos: keyedPhotos.map(({ id, caption }) => ({ id, caption })),
  });

  let parsed: z.infer<typeof geminiStorySchema> | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: unknown;
    try {
      response = await generateJson(systemPrompt, input, storyResponseSchema);
      parsed = geminiStorySchema.parse(response);
      const allowedIds = new Set(keyedPhotos.map((photo) => photo.id));
      if (parsed.scenes.some((scene) => !allowedIds.has(scene.photoId))) {
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
    throw new AIServiceError(502, 'The story assistant returned an unusable draft twice. Please adjust the prompt and try again.');
  }

  generationCache.set(key, { expiresAt: Date.now() + 10 * 60 * 1000, value: parsed });
  return {
    title: parsed.title,
    scenes: parsed.scenes.map((scene) => ({
      ...scene,
      photoId: keyedPhotos.find((photo) => photo.id === scene.photoId)!.databaseId,
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
