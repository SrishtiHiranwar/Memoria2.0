import assert from 'node:assert/strict';
import test from 'node:test';
import { addLicensedImages, isPermittedImageLicense } from './wikimedia.js';

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
