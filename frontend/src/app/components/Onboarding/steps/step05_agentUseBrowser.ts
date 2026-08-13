import type { OnboardingStep } from './types';
import { S } from '../selectors';
import { tr } from './translatedOps';

export const step05: OnboardingStep = {
  id: 'agent_use_browser',
  stage: 'learn_features',
  index: 5,
  title: 'Have an agent use the browser',
  description: 'Let an agent take control of your browser.',
  videoSrc: './onboarding-videos/v2/05.mp4',
  videoDurationLabel: '0:30',
  requiresDashboard: true,
  dependsOn: [{ stepId: 'use_browser', reopen: 'walk_again' }],
  ops: [
    { kind: 'move_to', target: S.newAgentButton },
    { kind: 'popup', text: tr('onboarding.steps.agent_use_browser.popup.newChat') },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.newAgentButton },
    },
    { kind: 'move_to', target: S.elementSelectionToggle, offset: { x: -10, y: -10 } },
    { kind: 'popup', text: tr('onboarding.steps.agent_use_browser.popup.selectElement') },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.elementSelectionToggle },
    },
    { kind: 'move_to', target: S.canvasFitToView },
    { kind: 'click', target: S.canvasFitToView, simulate: true },
    { kind: 'delay', ms: 350 },
    { kind: 'drag_select', target: 'browser-card' },
    {
      kind: 'popup',
      text: tr('onboarding.steps.agent_use_browser.popup.dragBox'),
    },
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'agent:attached_to_browser' },
      timeoutMs: 90000,
    },
    { kind: 'move_to', target: S.chatInput },
    {
      kind: 'popup',
      text: tr('onboarding.steps.agent_use_browser.popup.askTask'),
    },
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'chat:message_sent' },
      timeoutMs: 180000,
    },
    { kind: 'move_to', target: S.canvasFitToView },
    { kind: 'popup', text: tr('onboarding.steps.agent_use_browser.popup.fitToView') },
    { kind: 'delay', ms: 1800 },
    { kind: 'move_to', target: S.canvasTidyLayout },
    { kind: 'popup', text: tr('onboarding.steps.agent_use_browser.popup.tidyLayout') },
    { kind: 'delay', ms: 1800 },
    { kind: 'move_to', target: S.canvasMinimapToggle },
    { kind: 'popup', text: tr('onboarding.steps.agent_use_browser.popup.minimap') },
    { kind: 'delay', ms: 1800 },
    { kind: 'outro' },
  ],
};
