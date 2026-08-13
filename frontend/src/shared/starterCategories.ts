import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Hammer, Globe, Plug } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Two-level starters shared by the empty-state and the first-run welcome chat: pick a category, then a concrete prompt. Chosen to SHOWCASE what only Maestro can do, and to feel PERSONAL: the agents can see the user's own computer/files, drive the browser, plug into their apps (MCPs), build real apps, and run agents in parallel, none of which a plain chatbot can do out of the box. Many prompts deliberately touch the user's own stuff so it matters to them. One-click-runnable (no [placeholders]); reads plainly for a non-dev. All run as a normal agent; the 'build' category (target 'app-builder') just prefills the composer in the welcome chat instead of auto-sending, since the agent builds the app in-place (it calls CreateApp and the live card drops on the canvas).
export type StarterCategory = {
  id: string;
  labelKey: string;
  Icon: LucideIcon;
  promptKeys: string[];
  target?: 'app-builder';
};

export type ResolvedStarterCategory = {
  id: string;
  label: string;
  Icon: LucideIcon;
  prompts: string[];
  target?: 'app-builder';
};

// The table stores locale KEYS, never resolved text: this module is imported at boot, before i18next is initialized, so a module-scope t() would freeze the value against the wrong language.
const STARTER_CATEGORIES: StarterCategory[] = [
  {
    // Deep web research that ends in a real artifact (PDF, slideshow) + the parallel canvas.
    id: 'research', labelKey: 'dashboard.starters.research.label', Icon: Search,
    promptKeys: [
      'dashboard.starters.research.prompt1',
      'dashboard.starters.research.prompt2',
      'dashboard.starters.research.prompt3',
      'dashboard.starters.research.prompt4',
    ],
  },
  {
    // Full live apps built from the user's OWN stuff, not toy snippets a chatbot just prints.
    id: 'build', labelKey: 'dashboard.starters.build.label', Icon: Hammer, target: 'app-builder',
    promptKeys: [
      'dashboard.starters.build.prompt1',
      'dashboard.starters.build.prompt2',
      'dashboard.starters.build.prompt3',
      'dashboard.starters.build.prompt4',
    ],
  },
  {
    // The browser agent: Maestro's most powerful tool, it actually drives the web for you.
    id: 'browse', labelKey: 'dashboard.starters.browse.label', Icon: Globe,
    promptKeys: [
      'dashboard.starters.browse.prompt1',
      'dashboard.starters.browse.prompt2',
      'dashboard.starters.browse.prompt3',
      'dashboard.starters.browse.prompt4',
    ],
  },
  {
    // MCPs: plug your real tools in and let agents work across them.
    id: 'connect', labelKey: 'dashboard.starters.connect.label', Icon: Plug,
    promptKeys: [
      'dashboard.starters.connect.prompt1',
      'dashboard.starters.connect.prompt2',
      'dashboard.starters.connect.prompt3',
      'dashboard.starters.connect.prompt4',
    ],
  },
];

/** Starter categories with their labels and prompts resolved in the active language. */
export function useStarterCategories(): ResolvedStarterCategory[] {
  const { t, i18n } = useTranslation();
  // Re-resolves on languageChanged because i18n.language is in the dep list.
  return useMemo(() => STARTER_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: t(cat.labelKey),
    Icon: cat.Icon,
    prompts: cat.promptKeys.map((key) => t(key)),
    target: cat.target,
  })), [t, i18n.language]);
}
