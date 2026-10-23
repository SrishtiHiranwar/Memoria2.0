import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasEnoughStoryPromptDetail,
  isGenericRecallQuestion,
  isSpecificRecallQuestion,
  requestedExactQuestions,
  requestedSceneCount,
  sceneUsesSourceDetail,
} from './gemini.js';

test('detects a prompt-requested scene count without mistaking a single-scene instruction', () => {
  assert.equal(requestedSceneCount('Create exactly 3 short scenes. One scene asks what color the flower is.'), 3);
  assert.equal(requestedSceneCount('Write exactly three gentle scenes.'), 3);
  assert.equal(requestedSceneCount('Make a story with 2 scenes.'), 2);
  assert.equal(requestedSceneCount('One scene must ask this exact question.'), undefined);
});

test('extracts every quoted exact recall question so none can be silently skipped', () => {
  assert.deepEqual(requestedExactQuestions('Scene one: "What shape is the paper?" Scene two: “What color is the ribbon?”'), [
    'What shape is the paper?',
    'What color is the ribbon?',
  ]);
  assert.deepEqual(requestedExactQuestions('Ask what shape the paper is.'), []);
});

test('requires concrete details instead of accepting a topic-only story prompt', () => {
  assert.equal(hasEnoughStoryPromptDetail('teacher'), false);
  assert.equal(hasEnoughStoryPromptDetail('Create a story about a teacher.'), false);
  assert.equal(hasEnoughStoryPromptDetail('A teacher reads a red book.'), true);
  assert.equal(hasEnoughStoryPromptDetail('Fold yellow paper and tie on a blue ribbon.'), true);
});

test('recognizes generic recall questions and allows scene-specific questions', () => {
  assert.equal(isGenericRecallQuestion('Where are you sitting?'), true);
  assert.equal(isGenericRecallQuestion('What do you see?'), true);
  assert.equal(isGenericRecallQuestion('What color is the paper?'), false);
  assert.equal(isGenericRecallQuestion('What did the teacher read?'), false);
  assert.equal(isSpecificRecallQuestion('Where are you sitting?', 'You are sitting in a sunny garden.'), false);
  assert.equal(isSpecificRecallQuestion('What do you remember from this scene?', 'A teacher reads a red book.'), false);
  assert.equal(isSpecificRecallQuestion('What did the teacher read?', 'The teacher reads a red book.'), true);
  assert.equal(isSpecificRecallQuestion('What color is the paper?', 'Fold the yellow paper.'), true);
});

test('rejects scenes unrelated to the doctor prompt or photo captions', () => {
  assert.equal(sceneUsesSourceDetail(
    'You are sitting outside in a sunny garden filled with colorful flowers. Where are you sitting? In a sunny garden.',
    'A teacher reads a red book.',
  ), false);
  assert.equal(sceneUsesSourceDetail(
    'The teacher reads the red book. What did the teacher read? A red book.',
    'A teacher reads a red book.',
  ), true);
});
