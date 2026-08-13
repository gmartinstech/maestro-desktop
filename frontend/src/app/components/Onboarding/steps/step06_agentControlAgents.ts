import type { OnboardingStep } from './types';
import { S } from '../selectors';
import { tr } from './translatedOps';

export const step06: OnboardingStep = {
  id: 'agent_control_agents',
  stage: 'learn_features',
  index: 6,
  title: 'Have an agent control other agents',
  description: 'Let an agent orchestrate other agents.',
  videoSrc: './onboarding-videos/v2/06.mp4',
  videoDurationLabel: '0:34',
  requiresDashboard: true,
  // Reuses step 3's chat as the orchestratee; step 6 always has one available by now.
  ops: [
    {
      kind: 'popup',
      text: tr('onboarding.steps.agent_control_agents.popup.intro'),
    },
    { kind: 'move_to', target: S.newAgentButton },
    { kind: 'popup', text: tr('onboarding.steps.agent_control_agents.popup.newChat') },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.newAgentButton },
    },
    { kind: 'move_to', target: S.elementSelectionToggle, offset: { x: -10, y: -10 } },
    { kind: 'popup', text: tr('onboarding.steps.agent_control_agents.popup.selectElement') },
    {
      kind: 'wait_user',
      condition: { kind: 'click_target', target: S.elementSelectionToggle },
    },
    { kind: 'move_to', target: S.canvasFitToView },
    { kind: 'click', target: S.canvasFitToView, simulate: true },
    { kind: 'delay', ms: 350 },
    { kind: 'drag_select', target: 'agent-card' },
    {
      kind: 'popup',
      text: tr('onboarding.steps.agent_control_agents.popup.dragBox'),
    },
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'agent:attached_to_browser' },
      timeoutMs: 90000,
    },
    { kind: 'move_to', target: S.chatInput },
    {
      kind: 'popup',
      text: tr('onboarding.steps.agent_control_agents.popup.askTask'),
    },
    {
      kind: 'wait_user',
      condition: { kind: 'event_bus', event: 'chat:message_sent' },
      timeoutMs: 180000,
    },
    {
      kind: 'popup',
      text: tr('onboarding.steps.agent_control_agents.popup.working'),
    },
    { kind: 'delay', ms: 4000 },
    { kind: 'outro' },
  ],
};
