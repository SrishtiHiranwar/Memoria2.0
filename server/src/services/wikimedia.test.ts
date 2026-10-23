import assert from 'node:assert/strict';
import test from 'node:test';
import { addLicensedImages, isPermittedImageLicense, isRelevantImageMatch } from './wikimedia.js';

test('permits public-domain and Creative Commons licenses with attribution terms', () => {
  assert.equal(isPermittedImageLicense('CC0'), true);
  assert.equal(isPermittedImageLicense('CC BY 4.0'), true);
  assert.equal(isPermittedImageLicense('CC BY-SA 4.0'), true);
  assert.equal(isPermittedImageLicense('Public domain'), true);
});

test('rejects non-commercial, no-derivatives, and unspecified image licenses', () => {
  assert.equal(isPermittedImageLicense('CC BY-NC 4.0'), false);
  assert.equal(isPermittedImageLicense('CC BY-ND 4.0'), false);
  assert.equal(isPermittedImageLicense('All rights reserved'), false);
  assert.equal(isPermittedImageLicense(''), false);
});

test('rejects licensed images whose title and description do not match the requested scene', () => {
  assert.equal(isRelevantImageMatch('friends listening together', 'Portrait of a man in San Francisco'), false);
  assert.equal(isRelevantImageMatch('yellow sunflower opening', 'A yellow sunflower in bloom'), true);
  assert.equal(isRelevantImageMatch('friendship', 'friends walking together'), false);
  assert.equal(isRelevantImageMatch('two friends talking together', 'Two friends talking on a bench'), true);
  assert.equal(isRelevantImageMatch('two friends talking together', 'Portrait of one man'), false);
});

test('attaches an attributed image only when Commons supplies an allowed license', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    query: {
      pages: {
        '123': {
          pageid: 123,
          title: 'File:Garden flower.jpg',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/garden.jpg',
            thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/garden.jpg',
            extmetadata: {
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
              Artist: { value: '<a>Photographer</a>' },
            },
          }],
        },
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const [scene] = await addLicensedImages([{
      photoId: null,
      imageSearchQuery: 'garden flower test candidate',
      narration: 'A flower grows in the garden.',
      recallQuestion: 'What is in the garden?',
      expectedAnswer: 'A flower',
      answerOptions: ['A flower', 'A chair'],
    }]);
    assert.equal(scene.externalImage?.licenseName, 'CC BY-SA 4.0');
    assert.equal(scene.externalImage?.attribution, 'Photographer — Garden flower.jpg');
    assert.equal(new URL(scene.externalImage!.url).hostname, 'thumb.wikimedia.org');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not attach a licensed but unrelated portrait to a friendship scene', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    query: {
      pages: {
        '456': {
          pageid: 456,
          title: 'File:Evan from San Francisco.jpg',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/portrait.jpg',
            thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/portrait.jpg',
            extmetadata: {
              LicenseShortName: { value: 'CC BY-SA 2.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/2.0/' },
              ImageDescription: { value: '<p>A portrait of a man in a room.</p>' },
            },
          }],
        },
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const [scene] = await addLicensedImages([{
      photoId: null,
      imageSearchQuery: 'friends listening together test',
      narration: 'A friend listens when you speak.',
      recallQuestion: 'What does a friend do?',
      expectedAnswer: 'Listens',
      answerOptions: ['Listens', 'Runs'],
    }]);
    assert.equal(scene.externalImage, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('skips an unrelated first result and selects a later matching licensed image', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    query: {
      pages: {
        '789': {
          pageid: 789,
          title: 'File:Portrait of a man.jpg',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/portrait-2.jpg',
            extmetadata: {
              LicenseShortName: { value: 'CC BY 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
            },
          }],
        },
        '790': {
          pageid: 790,
          title: 'File:Two friends talking on a bench.jpg',
          imageinfo: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/friends-bench.jpg',
            extmetadata: {
              LicenseShortName: { value: 'CC BY 4.0' },
              LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
            },
          }],
        },
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const [scene] = await addLicensedImages([{
      photoId: null,
      imageSearchQuery: 'friends talking on bench scene specific match',
      narration: 'Two friends talk on a bench.',
      recallQuestion: 'Where are the friends?',
      expectedAnswer: 'On a bench',
      answerOptions: ['On a bench', 'In a kitchen'],
    }]);
    assert.equal(scene.externalImage?.attribution, 'Two friends talking on a bench.jpg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps the story scene when Wikimedia image search is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    const [scene] = await addLicensedImages([{
      photoId: null,
      imageSearchQuery: 'quiet garden flower',
      narration: 'A flower grows in a quiet garden.',
      recallQuestion: 'What grows in the garden?',
      expectedAnswer: 'A flower',
      answerOptions: ['A flower', 'A tree'],
    }]);
    assert.equal(scene.externalImage, undefined);
    assert.equal(scene.narration, 'A flower grows in a quiet garden.');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /licensed_image_search_unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
