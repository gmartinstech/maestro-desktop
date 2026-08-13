import type { OnboardingStep } from './types';
import { S } from '../selectors';
import { hasModelConnected } from './skipPredicates';
import { tr } from './translatedOps';

export const step01: OnboardingStep = {
  id: 'connect_model',
  stage: 'get_started',
  // Moved to last in "Get started": the user only meets this after they've seen value, framed as "keep going". Stays suppressed while the free trial is armed and runs aren't low; un-suppresses when they're about to run out.
  index: 2,
  title: 'Keep going: connect your model',
  description: 'Your free runs are limited. Add your own model to keep building.',
  videoSrc: './onboarding-videos/v2/01.mp4',
  videoDurationLabel: '0:24',
  skipIf: (s) => hasModelConnected(s),
  ops: [
    { kind: 'move_to', target: S.sidebarSettingsButton },
    { kind: 'popup', text: tr('onboarding.steps.connect_model.popup.settings') },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.sidebarSettingsButton },
    },
    { kind: 'move_to', target: S.settingsModelsTab },
    { kind: 'popup', text: tr('onboarding.steps.connect_model.popup.models') },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.settingsModelsTab },
    },
    {
      kind: 'multi_choice',
      opId: 'connect_method',
      question: tr('onboarding.steps.connect_model.question'),
      options: [
        {
          id: 'subscription',
          label: tr('onboarding.steps.connect_model.option.subscription'),
          thenOps: [
            { kind: 'move_to', target: S.settingsExternalSubs },
            { kind: 'popup', text: tr('onboarding.steps.connect_model.popup.subscription') },
          ],
        },
        {
          id: 'api_key',
          label: tr('onboarding.steps.connect_model.option.apiKey'),
          thenOps: [
            { kind: 'move_to', target: S.settingsApiKeys },
            { kind: 'popup', text: tr('onboarding.steps.connect_model.popup.apiKey') },
          ],
        },
      ],
    },
    {
      kind: 'wait_user',
      condition: {
        kind: 'redux_predicate',
        selector: hasModelConnected,
        truthy: true,
      },
      hint: 'Finish connecting your model.',
    },
    { kind: 'move_to', target: S.settingsCloseButton },
    { kind: 'popup', text: tr('onboarding.steps.connect_model.popup.close') },
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'settings:closed' },
    },
    { kind: 'outro' },
  ],
};
