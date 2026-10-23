import { z } from 'zod';
import { AIServiceError } from '../lib/errors.js';
import { externalImageSchema, type sceneSchema } from '../lib/schemas.js';

type Scene = z.infer<typeof sceneSchema>;
type ExternalImage = z.infer<typeof externalImageSchema>;

const imageInfoSchema = z.object({
  url: z.string().url(),
  thumburl: z.string().url().optional(),
  mime: z.string().optional(),
  extmetadata: z.record(z.object({ value: z.unknown().optional() }).passthrough()).optional(),
}).passthrough();

const commonsResponseSchema = z.object({
  query: z.object({
    pages: z.record(z.object({
      pageid: z.number().int().positive(),
      title: z.string(),
      imageinfo: z.array(imageInfoSchema).optional(),
    }).passthrough()).optional(),
  }).optional(),
}).passthrough();

const searchCache = new Map<string, { expiresAt: number; image: ExternalImage | null }>();
const cacheDuration = 10 * 60 * 1000;
const ignoredImageWords = new Set([
  'about', 'above', 'after', 'along', 'around', 'candidate', 'image', 'into', 'looking', 'photo',
  'scene', 'show', 'some', 'test', 'that', 'their', 'there', 'these', 'they', 'this', 'those',
  'with', 'without',
]);

function plainText(value: unknown) {
  return (typeof value === 'string' ? value : '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPermittedImageLicense(name: string) {
  return /^(?:CC0\b|CC BY(?:-SA)?(?:\s|$)|public domain\b|PD\b)/i.test(name.trim());
}

function imageKeywords(value: string) {
  return value.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !ignoredImageWords.has(word))
    .map((word) => word.endsWith('ies') && word.length > 5
      ? `${word.slice(0, -3)}y`
      : word.endsWith('s') && word.length > 4
        ? word.slice(0, -1)
        : word);
}

export function isRelevantImageMatch(searchTerms: string, candidateDescription: string) {
  const requested = [...new Set(imageKeywords(searchTerms))];
  if (requested.length === 0) return false;
  const candidate = new Set(imageKeywords(candidateDescription));
  const matches = requested.filter((word) => candidate.has(word)).length;
  const requiredMatches = requested.length === 1 ? 1 : Math.max(2, Math.ceil(requested.length * 0.5));
  return matches >= requiredMatches;
}

function trustedCommonsUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['upload.wikimedia.org', 'thumb.wikimedia.org', 'commons.wikimedia.org'].includes(url.hostname)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function secureHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function findLicensedImage(searchTerms: string): Promise<ExternalImage | null> {
  const query = searchTerms
    .replace(/[^a-zA-Z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  if (!query) return null;

  const now = Date.now();
  for (const [cachedQuery, cachedResult] of searchCache) {
    if (cachedResult.expiresAt <= now) searchCache.delete(cachedQuery);
  }
  const cached = searchCache.get(query.toLowerCase());
  if (cached) return cached.image;

  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '20',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1200',
    format: 'json',
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'MemoriaPrototype/1.0 (fictional story image lookup)' },
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new AIServiceError(502, 'Licensed image search is temporarily unavailable. Please try drafting again.');
  }
  if (!response.ok) {
    throw new AIServiceError(502, 'Licensed image search is temporarily unavailable. Please try drafting again.');
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AIServiceError(502, 'Licensed image search returned an unusable result. Please try drafting again.');
  }
  const parsed = commonsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AIServiceError(502, 'Licensed image search returned an unusable result. Please try drafting again.');
  }

  let result: ExternalImage | null = null;
  let bestMatchCount = 0;
  const requestedKeywords = [...new Set(imageKeywords(query))];
  for (const page of Object.values(parsed.data.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const metadata = info.extmetadata ?? {};
    const licenseName = plainText(metadata.LicenseShortName?.value);
    const licenseUrl = secureHttpsUrl(metadata.LicenseUrl?.value);
    const imageUrl = trustedCommonsUrl(info.thumburl) ?? trustedCommonsUrl(info.url);
    if (!imageUrl || !licenseUrl || !isPermittedImageLicense(licenseName) || (info.mime && !info.mime.startsWith('image/'))) continue;
    const description = [
      page.title,
      metadata.ObjectName?.value,
      metadata.ImageDescription?.value,
    ].map(plainText).join(' ');
    if (!isRelevantImageMatch(query, description)) continue;
    const candidateKeywords = new Set(imageKeywords(description));
    const matchCount = requestedKeywords.filter((word) => candidateKeywords.has(word)).length;
    if (matchCount < bestMatchCount) continue;
    const artist = plainText(metadata.Artist?.value || metadata.Credit?.value);
    const attribution = (artist ? `${artist} — ` : '') + page.title.replace(/^File:/, '');
    const image = externalImageSchema.safeParse({
      url: imageUrl,
      sourcePageUrl: `https://commons.wikimedia.org/?curid=${page.pageid}`,
      licenseName,
      licenseUrl,
      attribution: attribution.slice(0, 400),
    });
    if (image.success) {
      result = image.data;
      bestMatchCount = matchCount;
      if (matchCount === requestedKeywords.length) break;
    }
  }
  searchCache.set(query.toLowerCase(), { expiresAt: now + cacheDuration, image: result });
  return result;
}

export async function addLicensedImages(scenes: Scene[]): Promise<Scene[]> {
  return Promise.all(scenes.map(async (scene) => {
    if (scene.photoId !== null || !scene.imageSearchQuery) return scene;
    try {
      const externalImage = await findLicensedImage(scene.imageSearchQuery);
      return externalImage ? { ...scene, externalImage } : scene;
    } catch (error) {
      if (!(error instanceof AIServiceError)) throw error;
      console.warn(JSON.stringify({
        type: 'licensed_image_search_unavailable',
        status: error.status,
      }));
      return scene;
    }
  }));
}
