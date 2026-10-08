import { expect, test } from 'bun:test';
import { buildGuidePrompt } from './new-guide-prompt';

test('buildGuidePrompt with task only', () => {
  const result = buildGuidePrompt({ task: 'Create an account' });
  expect(result).toBe(
    'Use OpenDocs to record how to: Create an account.\n' +
      'Call opendocs_categories first and reuse a matching category name.\n' +
      'Finish with opendocs_compile.',
  );
});

test('buildGuidePrompt with empty task', () => {
  const result = buildGuidePrompt({ task: '' });
  expect(result).toBe(
    'Use OpenDocs to record how to: <describe the task>.\n' +
      'Call opendocs_categories first and reuse a matching category name.\n' +
      'Finish with opendocs_compile.',
  );
});

test('buildGuidePrompt with task and category', () => {
  const result = buildGuidePrompt({ task: 'Create an account', category: 'Billing' });
  expect(result).toBe(
    'Use OpenDocs to record how to: Create an account.\n' +
      'File it under the category "Billing".\n' +
      'Finish with opendocs_compile.',
  );
});

test('buildGuidePrompt with task, category, and startUrl', () => {
  const result = buildGuidePrompt({
    task: 'Create an account',
    category: 'Billing',
    startUrl: 'https://example.com/signup',
  });
  expect(result).toBe(
    'Use OpenDocs to record how to: Create an account.\n' +
      'Start at https://example.com/signup.\n' +
      'File it under the category "Billing".\n' +
      'Finish with opendocs_compile.',
  );
});

test('buildGuidePrompt with review flag', () => {
  const result = buildGuidePrompt({
    task: 'Create an account',
    review: true,
  });
  expect(result).toBe(
    'Use OpenDocs to record how to: Create an account.\n' +
      'Call opendocs_categories first and reuse a matching category name.\n' +
      'Finish with opendocs_compile.\n' +
      'Do not share the link: I will review it before it goes out.',
  );
});

test('buildGuidePrompt all options', () => {
  const result = buildGuidePrompt({
    task: 'Update profile',
    category: 'Account Settings',
    startUrl: 'https://example.com/settings',
    review: true,
  });
  expect(result).toBe(
    'Use OpenDocs to record how to: Update profile.\n' +
      'Start at https://example.com/settings.\n' +
      'File it under the category "Account Settings".\n' +
      'Finish with opendocs_compile.\n' +
      'Do not share the link: I will review it before it goes out.',
  );
});

test('buildGuidePrompt with empty category string', () => {
  const result = buildGuidePrompt({
    task: 'Create an account',
    category: '   ',
  });
  expect(result).toBe(
    'Use OpenDocs to record how to: Create an account.\n' +
      'Call opendocs_categories first and reuse a matching category name.\n' +
      'Finish with opendocs_compile.',
  );
});

test('buildGuidePrompt with empty startUrl string', () => {
  const result = buildGuidePrompt({
    task: 'Create an account',
    startUrl: '   ',
  });
  expect(result).toBe(
    'Use OpenDocs to record how to: Create an account.\n' +
      'Call opendocs_categories first and reuse a matching category name.\n' +
      'Finish with opendocs_compile.',
  );
});

test('buildGuidePrompt with publish: true (no review line)', () => {
  const result = buildGuidePrompt({
    task: 'Create a WhatsApp message template',
    category: 'WhatsApp',
    publish: true,
  });
  expect(result).toBe(
    'Use OpenDocs to record how to: Create a WhatsApp message template.\n' +
      'File it under the category "WhatsApp".\n' +
      'Finish with opendocs_compile.',
  );
});

test('buildGuidePrompt with publish: false (adds review line)', () => {
  const result = buildGuidePrompt({
    task: 'Create a WhatsApp message template',
    category: 'WhatsApp',
    publish: false,
  });
  expect(result).toBe(
    'Use OpenDocs to record how to: Create a WhatsApp message template.\n' +
      'File it under the category "WhatsApp".\n' +
      'Finish with opendocs_compile.\n' +
      'Do not share the link: I will review it before it goes out.',
  );
});
