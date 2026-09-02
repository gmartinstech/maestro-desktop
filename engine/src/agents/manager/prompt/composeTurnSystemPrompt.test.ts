// engine/src/agents/manager/prompt/composeTurnSystemPrompt.test.ts -- AGT-5. Ports
// backend/tests/test_system_prompt.py case-for-case: the base prompt is composed, the current-time
// block is always pinned, view-builder mode appends the live App Builder skill, and language
// localization (the pt-BR fresh-install default, an explicit "en" choice, a user-written prompt
// surviving verbatim, and settings-unreadable fail-open) all resolve correctly. The context
// builders are stubbed to `undefined` so the test is deterministic and doesn't depend on any
// not-yet-ported subsystem's state, same as the Python suite mocking them to `None`.

import { describe, expect, it } from 'vitest';
import { createAgentSession } from '../../sessionFactory';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT_PT_BR } from '../../../settings/models';
import { composeTurnSystemPrompt } from './composeTurnSystemPrompt';

function pSession(overrides: Partial<{ mode: string }> = {}) {
  return createAgentSession({
    id: 's',
    name: 't',
    model: 'sonnet',
    dashboard_id: 'd',
    mode: overrides.mode,
    created_at: new Date().toISOString(),
    branches: {},
  });
}

const noBuilders = {
  buildBrowserContext: () => undefined,
  buildMcpRegistrySummary: () => undefined,
  buildSelectedAppContext: () => undefined,
  buildSelectedSettingsContext: () => undefined,
};

function pCompose(session: ReturnType<typeof pSession>, overrides: Record<string, unknown> = {}) {
  return composeTurnSystemPrompt(
    session,
    { modeSysPrompt: null, defaultSystemPrompt: 'You are a helpful agent.', selectedBrowserIds: null, selectedAppOutputIds: null, selectedSettingIds: null },
    { ...noBuilders, ...overrides },
  )!;
}

describe('composeTurnSystemPrompt (ports test_system_prompt.py)', () => {
  it('the base composition includes the default and the time pin', () => {
    const out = pCompose(pSession());
    expect(out).toContain('You are a helpful agent.');
    expect(out).toContain('<current_time>'); // the wall-clock pin is always appended
  });

  it('view-builder mode appends the live skill block', () => {
    const out = pCompose(pSession({ mode: 'view-builder' }), { loadAppBuilderSkill: () => 'SKILL BODY' });
    expect(out).toContain('<app_builder_reference>');
    expect(out).toContain('SKILL BODY');
  });

  it('a selected app context is appended when present', () => {
    const out = composeTurnSystemPrompt(
      pSession(),
      { modeSysPrompt: null, defaultSystemPrompt: 'base', selectedBrowserIds: null, selectedAppOutputIds: ['app-1'], selectedSettingIds: null },
      { ...noBuilders, buildSelectedAppContext: () => '<picked_app>/x</picked_app>' },
    )!;
    expect(out).toContain('<picked_app>/x</picked_app>');
  });

  function pComposeWithLanguage(language: string | null, defaultSystemPrompt = 'You are a helpful agent.') {
    return composeTurnSystemPrompt(
      pSession(),
      { modeSysPrompt: null, defaultSystemPrompt, selectedBrowserIds: null, selectedAppOutputIds: null, selectedSettingIds: null },
      { ...noBuilders, loadSettings: () => ({ settings: { language } }) },
    )!;
  }

  it.each([['pt-BR'], [null]])('the language directive is Portuguese for pt-BR and for unset (%s)', (language) => {
    // null is a fresh install, whose UI is already pt-BR, so the prompt must not fall back to English.
    const out = composeTurnSystemPrompt(
      pSession(),
      { modeSysPrompt: null, defaultSystemPrompt: 'You are a helpful agent.', selectedBrowserIds: null, selectedAppOutputIds: null, selectedSettingIds: null },
      { ...noBuilders, loadSettings: () => ({ settings: { language } }) },
    )!;
    expect(out).toContain('<language_directive>');
    expect(out).toContain('português do Brasil');
  });

  it('the language directive is English only when explicitly chosen', () => {
    const out = pComposeWithLanguage('en');
    expect(out).toContain('<language_directive>');
    expect(out).not.toContain('português do Brasil');
  });

  it('pt-BR swaps the untouched default prompt for its translation', () => {
    const out = composeTurnSystemPrompt(
      pSession(),
      { modeSysPrompt: null, defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT, selectedBrowserIds: null, selectedAppOutputIds: null, selectedSettingIds: null },
      { ...noBuilders, loadSettings: () => ({ settings: { language: 'pt-BR' } }) },
    )!;
    expect(out).toContain(DEFAULT_SYSTEM_PROMPT_PT_BR);
    expect(out).not.toContain(DEFAULT_SYSTEM_PROMPT);
  });

  it('a user-written prompt survives verbatim in Portuguese', () => {
    // The default prompt is user-editable, so translating it would silently discard their text.
    const out = pComposeWithLanguage('pt-BR', 'MY OWN PROMPT');
    expect(out).toContain('MY OWN PROMPT');
  });

  it('unreadable settings do not break a turn', () => {
    const out = composeTurnSystemPrompt(
      pSession(),
      { modeSysPrompt: null, defaultSystemPrompt: 'base', selectedBrowserIds: null, selectedAppOutputIds: null, selectedSettingIds: null },
      {
        ...noBuilders,
        loadSettings: () => {
          throw new Error('disk gone');
        },
      },
    )!;
    expect(out).toContain('base');
    expect(out).toContain('português do Brasil');
  });
});
