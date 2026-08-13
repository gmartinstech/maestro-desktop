// Run: node --test frontend/src/shared/i18n/languageSync.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguageSync } from './languageSync.ts';

test('backend language wins when already set, even if current differs', () => {
  assert.deepEqual(resolveLanguageSync('pt-BR', 'en'), { target: 'en', shouldPersistToBackend: false });
  assert.deepEqual(resolveLanguageSync('en', 'pt-BR'), { target: 'pt-BR', shouldPersistToBackend: false });
});

test('backend language wins and is a no-op when it already matches current', () => {
  assert.deepEqual(resolveLanguageSync('pt-BR', 'pt-BR'), { target: 'pt-BR', shouldPersistToBackend: false });
});

test('fresh install: no localStorage hint, no backend value, defaults to pt-BR and persists it', () => {
  assert.deepEqual(resolveLanguageSync('pt-BR', null), { target: 'pt-BR', shouldPersistToBackend: true });
  assert.deepEqual(resolveLanguageSync('pt-BR', undefined), { target: 'pt-BR', shouldPersistToBackend: true });
});

test('migration: a localStorage-only choice of en carries into backend state', () => {
  assert.deepEqual(resolveLanguageSync('en', null), { target: 'en', shouldPersistToBackend: true });
});

test('migration: a localStorage-only choice of pt-BR still persists explicitly', () => {
  assert.deepEqual(resolveLanguageSync('pt-BR', undefined), { target: 'pt-BR', shouldPersistToBackend: true });
});
