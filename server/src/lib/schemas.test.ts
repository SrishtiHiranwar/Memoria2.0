import test from 'node:test';
import assert from 'node:assert/strict';
import {
  geminiStorySchema,
  geminiSummarySchema,
  careGoalCreateSchema,
  careMeasurementSchema,
  medicalRecordAnalysisSchema,
  patientStoryTranslateSchema,
  patientStoryTranslationSchema,
  storyDraftUpdateSchema,
} from './schemas.js';

const safeScene = {
  photoId: 'photo_1',
  imageSearchQuery: 'garden flowers',
  narration: 'The garden has bright flowers.',
  recallQuestion: 'What can you see?',
  expectedAnswer: 'Flowers',
  answerOptions: ['Flowers', 'A blue bicycle'],
};

test('Gemini story output requires supported choices and expected answer', () => {
  assert.equal(geminiStorySchema.safeParse({ title: 'A garden', scenes: [safeScene] }).success, true);
  assert.equal(geminiStorySchema.safeParse({
    title: 'A garden',
    scenes: [{ ...safeScene, photoId: null }],
  }).success, true);
  assert.equal(geminiStorySchema.safeParse({
    title: 'A garden',
    scenes: [{ ...safeScene, imageSearchQuery: undefined }],
  }).success, false);
  assert.equal(geminiStorySchema.safeParse({
    title: 'A garden',
    scenes: [{ ...safeScene, answerOptions: ['A blue bicycle', 'A quiet room'] }],
  }).success, false);
});

test('Gemini story and summary outputs reject medical claims', () => {
  assert.equal(geminiStorySchema.safeParse({
    title: 'A garden',
    scenes: [{ ...safeScene, narration: 'This will treat dementia.' }],
  }).success, false);
  assert.equal(geminiSummarySchema.safeParse({
    summary: 'The patient should change medication.',
    concerns: [],
    doctorReviewNote: 'For doctor review.',
  }).success, false);
});

test('story drafts accept a 3D companion mode and default to the normal story experience', () => {
  const draft = {
    title: 'A garden',
    prompt: 'A walk through a sunny garden.',
    scenes: [safeScene],
  };
  assert.equal(storyDraftUpdateSchema.parse({ ...draft, experienceMode: '3D' }).experienceMode, '3D');
  assert.equal(storyDraftUpdateSchema.parse(draft).experienceMode, 'STORY');
  assert.equal(storyDraftUpdateSchema.safeParse({ ...draft, experienceMode: '3D_WALK' }).success, false);
});

test('patient story translation accepts Hindi output and rejects English under a Hindi locale', () => {
  assert.equal(patientStoryTranslateSchema.safeParse({
    storyIds: ['story-1'],
    locale: 'hi-IN',
  }).success, true);
  assert.equal(patientStoryTranslateSchema.safeParse({
    storyIds: ['story-1', 'story-1'],
    locale: 'hi-IN',
  }).success, false);
  const hindiStory = {
    id: 'story_1',
    title: 'बगीचे की कहानी',
    scenes: [{
      narration: 'बगीचे में पीला फूल खिला।',
      recallQuestion: 'फूल का रंग क्या था?',
      expectedAnswer: 'पीला',
      answerOptions: ['पीला', 'नीला'],
    }],
  };
  assert.equal(patientStoryTranslationSchema.safeParse({ stories: [hindiStory] }).success, true);
  assert.equal(patientStoryTranslationSchema.safeParse({
    stories: [{ ...hindiStory, title: 'A garden story' }],
  }).success, false);
  assert.equal(patientStoryTranslationSchema.safeParse({
    stories: [{ ...hindiStory, scenes: [{ ...hindiStory.scenes[0], expectedAnswer: 'हरा' }] }],
  }).success, false);
});

test('medical history extraction accepts source-grounded observations without requiring clinical conclusions', () => {
  const extracted = {
    summary: 'This file contains dated visit notes and a recorded weight measurement.',
    observations: [{
      recordedAt: '2025-02-03',
      category: 'measurement',
      label: 'Weight',
      detail: 'The record lists a weight measurement.',
      numericValue: 62.5,
      unit: 'kg',
      sourceExcerpt: 'Weight: 62.5 kg',
    }],
  };
  assert.equal(medicalRecordAnalysisSchema.safeParse(extracted).success, true);
  assert.equal(medicalRecordAnalysisSchema.safeParse({
    ...extracted,
    observations: [{ ...extracted.observations[0], numericValue: '62.5' }],
  }).success, false);
  assert.equal(medicalRecordAnalysisSchema.safeParse({
    ...extracted,
    observations: [{ ...extracted.observations[0], numericValue: 100000000 }],
  }).success, false);
  assert.equal(medicalRecordAnalysisSchema.safeParse({
    ...extracted,
    unexpected: 'medical recommendation',
  }).success, false);
});

test('clinician goals and measurements reject invalid values and unknown fields', () => {
  assert.equal(careGoalCreateSchema.safeParse({
    title: 'Track weekly visits',
    measure: 'Visits',
    unit: 'per week',
    baselineValue: 2,
    targetValue: 3,
  }).success, true);
  assert.equal(careGoalCreateSchema.safeParse({
    title: 'Track weekly visits',
    measure: 'Visits',
    unit: 'per week',
    treatmentRecommendation: 'change medication',
  }).success, false);
  assert.equal(careMeasurementSchema.safeParse({ value: 2.5 }).success, true);
  assert.equal(careMeasurementSchema.safeParse({ value: Number.POSITIVE_INFINITY }).success, false);
});
