// Placeholder payoff content keyed by persona. This is the deterministic FLOOR; the real payoff is
// generated per-user by the aux LLM (resolve_aux_model + the p_call_classifier pattern) in a later
// step. Kept separate so swapping the source doesn't touch the orchestrator.

import type { PersonaId, PayoffIdea } from './onboardingFlowTypes';

export interface PayoffContent {
  insight: string;
  prefilledPrompt: string;
  ideas: PayoffIdea[];
}

const WORK: PayoffContent = {
  insight: "I see you're juggling client work and a launch. Here's one I can do right now, plus a few I lined up for you.",
  prefilledPrompt:
    "Send me a morning briefing: today's calendar, anything urgent in my email, and what my competitors shipped. Show me a sample before it goes live.",
  ideas: [
    { id: 'briefing', icon: 'sun', label: 'Send me a morning briefing', prompt: 'Set up a daily morning briefing with my calendar and any urgent email.' },
    { id: 'invoices', icon: 'tray', label: 'Clean up + chase my overdue invoices', prompt: 'Find my overdue invoices and draft polite follow-ups, ready to send.' },
    { id: 'tracker', icon: 'build', label: 'Build me a lightweight client tracker', prompt: 'Build and run a simple client tracker I can add clients and statuses to.' },
    { id: 'competitors', icon: 'globe', label: 'Watch my 3 competitors, ping me on changes', prompt: 'Watch 3 competitor sites and notify me when they change.' },
  ],
};

const PERSONAL: PayoffContent = {
  insight: "Life admin piles up. Here's one I can knock out right now, plus a few I lined up for you.",
  prefilledPrompt:
    'Plan my week: pull my calendar, flag any conflicts, and draft a simple to-do for what is actually due. Show me before you save anything.',
  ideas: [
    { id: 'inbox', icon: 'tray', label: 'Sort out my inbox pileup', prompt: 'Triage my inbox: surface what needs a reply and draft quick responses.' },
    { id: 'book', icon: 'globe', label: 'Find + book the best option for something', prompt: 'Find the best-rated option for what I need and walk me through booking it.' },
    { id: 'digest', icon: 'sun', label: 'Set a morning digest of what matters today', prompt: 'Send me a short morning digest of today plans and anything urgent.' },
    { id: 'goal', icon: 'build', label: 'Build me a simple tracker for a goal', prompt: 'Build and run a simple tracker for a personal goal.' },
  ],
};

const BUILD: PayoffContent = {
  insight: "Ideas are cheap, shipping is the thing. Here's one I can start right now, plus a few more.",
  prefilledPrompt:
    'Turn my idea into a working prototype: ask me 3 quick questions, then build and run a first version I can actually click.',
  ideas: [
    { id: 'prototype', icon: 'build', label: 'Build + run a small tool from a sentence', prompt: 'Build and run a small tool from a one-sentence description.' },
    { id: 'stack', icon: 'globe', label: 'Research the best stack for my idea', prompt: 'Research and recommend the best stack for my idea, with tradeoffs.' },
    { id: 'spec', icon: 'doc', label: 'Draft a spec from my rough notes', prompt: 'Turn my rough notes into a clean, buildable spec.' },
    { id: 'board', icon: 'tray', label: 'Set up a simple task board', prompt: 'Build and run a simple task board for my project.' },
  ],
};

const GENERIC: PayoffContent = {
  insight: "Here's a taste of what I can actually do, watch, not just chat.",
  prefilledPrompt:
    'Find the 3 best-rated options for something under my budget, compare them side by side, and tell me which to get.',
  ideas: [
    { id: 'web', icon: 'globe', label: 'Do a real web task, live', prompt: 'Do a real task on the web for me, start to finish.' },
    { id: 'tool', icon: 'build', label: 'Build + run a small tool', prompt: 'Build and run a small tool from a one-sentence description.' },
    { id: 'digest', icon: 'sun', label: 'Set up a daily briefing', prompt: 'Set up a short daily briefing of what matters to me.' },
    { id: 'clean', icon: 'tray', label: 'Clean up a messy list into a sheet', prompt: 'Turn a messy list into a clean, usable sheet.' },
  ],
};

export function demoPayoff(persona: PersonaId | null): PayoffContent {
  if (persona === 'work') return WORK;
  if (persona === 'personal') return PERSONAL;
  if (persona === 'build') return BUILD;
  return GENERIC;
}
