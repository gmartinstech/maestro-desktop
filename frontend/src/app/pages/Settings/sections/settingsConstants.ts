// Brand colors for provider group headers; mirrors ChatInput picker.
export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#E8927A',
  openai: '#74AA9C',
  google: '#4285F4',
  gemini: '#4285F4',
  xai: '#8B949E',
  meta: '#0866FF',
  deepseek: '#4D6BFE',
  mistral: '#FF7000',
  qwen: '#A974FF',
  cohere: '#FF7759',
};

// Shown only in the brief window before the live model list loads from the backend. Keep the flagship current so the default-model dropdown isn't stale.
export const DEFAULT_MODEL_FALLBACK = [
  { value: 'opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'sonnet', label: 'Claude Sonnet 4.6' },
  { value: 'opus', label: 'Claude Opus 4.6' },
  { value: 'haiku', label: 'Claude Haiku 4.5' },
];
