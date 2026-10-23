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
    gsrlimit: '5',
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
  for (const page of Object.values(parsed.data.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const metadata = info.extmetadata ?? {};
    const licenseName = plainText(metadata.LicenseShortName?.value);
    const licenseUrl = secureHttpsUrl(metadata.LicenseUrl?.value);
    const imageUrl = trustedCommonsUrl(info.thumburl) ?? trustedCommonsUrl(info.url);
    if (!imageUrl || !licenseUrl || !isPermittedImageLicense(licenseName) || (info.mime && !info.mime.startsWith('image/'))) continue;
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
      break;
    }
  }
  searchCache.set(query.toLowerCase(), { expiresAt: now + cacheDuration, image: result });
  return result;
}

export async function addLicensedImages(scenes: Scene[]): Promise<Scene[]> {
  return Promise.all(scenes.map(async (scene) => {
    if (scene.photoId !== null || !scene.imageSearchQuery) return scene;
    const externalImage = await findLicensedImage(scene.imageSearchQuery);
    return externalImage ? { ...scene, externalImage } : scene;
  }));
}
