// Always-dark premium skin for the onboarding flow, matching Claude.ai onboarding.
// Deliberately NOT the app's theme tokens: onboarding is always this dark, like Claude's.

export const ONBOARDING_SKIN = {
  bg: '#1C1B19',
  surface: '#252420',
  surfaceHover: '#2B2A25',
  text: '#F3F1EA',
  muted: '#8F8D86',
  ghost: '#6F6E68',
  accent: '#D97757',
  border: 'rgba(243,241,234,0.08)',
  borderStrong: 'rgba(243,241,234,0.14)',
  ctaBg: '#F3F1EA',
  ctaText: '#1A1917',
  serif: '"Copernicus", "Tiempos Headline", Georgia, "Times New Roman", serif',
  sans: '"Styrene B", "Anthropic Sans", -apple-system, "SF Pro Text", system-ui, sans-serif',
  radius: 16,
} as const;

// framer-motion cubic-bezier for entrances; matches the mock's --ease.
export const ONBOARDING_EASE = [0.16, 1, 0.3, 1] as const;
