import assert from 'node:assert/strict';
import test from 'node:test';
import { requestedSceneCount } from './gemini.js';

test('detects a prompt-requested scene count without mistaking a single-scene instruction', () => {
  assert.equal(requestedSceneCount('Create exactly 3 short scenes. One scene asks what color the flower is.'), 3);
  assert.equal(requestedSceneCount('Write exactly three gentle scenes.'), 3);
  assert.equal(requestedSceneCount('Make a story with 2 scenes.'), 2);
  assert.equal(requestedSceneCount('One scene must ask this exact question.'), undefined);
});
