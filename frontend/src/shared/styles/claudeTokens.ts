export interface ClaudeTokens {
  bg: { page: string; surface: string; elevated: string; secondary: string; inverse: string };
  text: { primary: string; secondary: string; tertiary: string; muted: string; inverse: string; ghost: string };
  accent: { primary: string; hover: string; pressed: string };
  // MartinsTech brand anchors. accent carries navy (contrast-safe on buttons/links);
  // gold is the highlight color, used with DARK text (logo, active/selection, badges).
  brand: { navy: string; gold: string };
  border: { subtle: string; medium: string; strong: string; width: string };
  shadow: { sm: string; md: string; lg: string };
  radius: { xs: number; sm: number; md: number; lg: number; xl: number; full: number };
  status: { success: string; successBg: string; warning: string; warningBg: string; error: string; errorBg: string; info: string; infoBg: string };
  user: { bubble: string };
  font: { sans: string; mono: string };
  transition: string;
}

// Maestro Studio (MartinsTech) — navy #003566 / gold #F5CC00, Inter + IBM Plex Mono.
// Neutrals are tinted toward the navy hue (cool), not the upstream warm cream.
export const lightTokens: ClaudeTokens = {
  bg: {
    page: '#F3F5F8',
    surface: '#FCFDFE',
    elevated: '#F8FAFC',
    secondary: '#E9EEF4',
    inverse: '#0D1B2A',
  },
  text: {
    primary: '#0F1D2B',
    secondary: '#33414F',
    tertiary: '#5E6B78',
    muted: '#6B7682',
    inverse: '#FFFFFF',
    ghost: 'rgba(94,107,120,0.5)',
  },
  accent: {
    primary: '#003566',
    hover: '#0A4C8F',
    pressed: '#002647',
  },
  brand: { navy: '#003566', gold: '#F5CC00' },
  border: {
    subtle: 'rgba(13,27,42,0.07)',
    medium: 'rgba(13,27,42,0.10)',
    strong: 'rgba(13,27,42,0.16)',
    width: '0.5px',
  },
  shadow: {
    sm: '0 1px 3px rgba(13,27,42,0.05)',
    md: '0 0.25rem 1.25rem rgba(13,27,42,0.05)',
    lg: '0 0.5rem 2rem rgba(13,27,42,0.10)',
  },
  radius: { xs: 8, sm: 8, md: 8, lg: 8, xl: 8, full: 9999 },
  status: {
    success: '#265B19',
    successBg: '#E9F1DC',
    warning: '#805C1F',
    warningBg: '#F6EEDF',
    error: '#B53333',
    errorBg: '#FEE2E2',
    info: '#003566',
    infoBg: '#DCE7F2',
  },
  user: { bubble: '#E4EBF3' },
  font: {
    sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, Menlo, monospace',
  },
  transition: 'all 150ms cubic-bezier(0.165, 0.85, 0.45, 1)',
};

export const darkTokens: ClaudeTokens = {
  bg: {
    page: '#0D1621',
    surface: '#14202D',
    elevated: '#1C2A38',
    secondary: '#101A25',
    inverse: '#F3F5F8',
  },
  text: {
    primary: '#F3F6FA',
    secondary: '#B8C2CE',
    tertiary: '#8A96A3',
    muted: '#77828E',
    inverse: '#0D1621',
    ghost: 'rgba(138,150,163,0.5)',
  },
  accent: {
    // Navy is too dark on a dark surface; use a lightened brand-azure for contrast.
    primary: '#4A90D9',
    hover: '#6BA6E2',
    pressed: '#3B7BC0',
  },
  brand: { navy: '#003566', gold: '#F5CC00' },
  border: {
    subtle: 'rgba(180,194,206,0.08)',
    medium: 'rgba(180,194,206,0.12)',
    strong: 'rgba(180,194,206,0.2)',
    width: '0.5px',
  },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.2)',
    md: '0 0.25rem 1.25rem rgba(0,0,0,0.15)',
    lg: '0 0.5rem 2rem rgba(0,0,0,0.25)',
  },
  radius: { xs: 8, sm: 8, md: 8, lg: 8, xl: 8, full: 9999 },
  status: {
    success: '#7AB948',
    successBg: '#1B4614',
    warning: '#D1A041',
    warningBg: '#483A0F',
    error: '#DD5353',
    errorBg: '#3D1515',
    info: '#80AADD',
    infoBg: '#16324B',
  },
  user: { bubble: '#1E2C3A' },
  font: {
    sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, Menlo, monospace',
  },
  transition: 'all 150ms cubic-bezier(0.165, 0.85, 0.45, 1)',
};

/** @deprecated Use useClaudeTokens() hook instead for dark mode support */
export const claude = lightTokens;
