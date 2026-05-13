import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

type Mode = 'light' | 'dark';

// ---- Cross-app theme persistence helpers ------------------------------------
//
// The template ships with a Light/Dark toggle but each app workspace runs
// from its own vite dev-server port, so plain localStorage won't carry the
// user's choice over to a NEW app they spin up later. To make the override
// sticky across every App Builder workspace we:
//
//   1. Default to the OS appearance (`prefers-color-scheme: dark`) on
//      first mount — synchronous, no flash.
//   2. Persist user toggles to localStorage for instant re-render on the
//      same app, AND to OpenSwarm's /api/settings.app_template_theme_override
//      so future apps see it on load.
//   3. After mount, async-fetch /api/settings; if the override there
//      differs from the synchronous default, switch to it. Brief style
//      flicker is preferable to either (a) an SSR injection (these are
//      vite SPAs) or (b) blocking initial render on a network call.
//
// The auth token rides in the URL (the template is loaded with
// `?token=<bearer>` by OpenSwarm's webview preload), so the fetch can hit
// localhost:8324 cross-origin via the host's CORS allow-list.

const LOCAL_STORAGE_KEY = 'openswarm-app-theme-override';
const OPENSWARM_BACKEND = 'http://localhost:8324';

function readUrlToken(): string {
  try {
    return new URLSearchParams(window.location.search).get('token') ?? '';
  } catch {
    return '';
  }
}

function readLocalStorageOverride(): Mode | null {
  try {
    const v = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function detectSystemPreference(): Mode {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function getInitialMode(): Mode {
  return readLocalStorageOverride() ?? detectSystemPreference();
}

// Clean unified sans for body + headings. The previous FONT_SERIF stack
// fell back to Times on systems without "Anthropic Sans" (which is most
// systems), so headings rendered as Times and body as system sans —
// reading as two different apps stitched together. One sans family
// everywhere is the single biggest "feels designed vs feels assembled"
// switch.
const FONT_SANS = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Helvetica Neue", Arial, sans-serif';
// Kept under its old name so any agent-written code that already
// references `c.font.serif` for an intentional display flourish still
// resolves — points at the same sans stack so the visual result is
// consistent regardless of which token a caller picked.
const FONT_SERIF = FONT_SANS;
const FONT_MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const lightTokens = {
  bg: {
    page: '#F5F5F0',
    surface: '#FFFFFF',
    elevated: '#FAF9F5',
    secondary: '#F5F4ED',
    inverse: '#141413',
  },
  text: {
    primary: '#1a1a18',
    secondary: '#3D3D3A',
    tertiary: '#73726C',
    muted: '#6b6a68',
    ghost: 'rgba(115,114,108,0.5)',
  },
  accent: {
    primary: '#ae5630',
    hover: '#c4633a',
    pressed: '#924828',
  },
  user: { bubble: '#DDD9CE' },
  border: {
    subtle: 'rgba(0,0,0,0.07)',
    medium: 'rgba(0,0,0,0.10)',
    strong: 'rgba(0,0,0,0.18)',
  },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.04)',
    md: '0 0.25rem 1.25rem rgba(0,0,0,0.035)',
    lg: '0 0.5rem 2rem rgba(0,0,0,0.08)',
  },
  status: {
    success: '#2e7d32',
    successBg: 'rgba(46,125,50,0.08)',
    error: '#c62828',
    errorBg: 'rgba(198,40,40,0.08)',
  },
};

const darkTokens = {
  bg: {
    page: '#1a1918',
    surface: '#262624',
    elevated: '#30302E',
    secondary: '#1f1e1b',
    inverse: '#FAF9F5',
  },
  text: {
    primary: '#FAF9F5',
    secondary: '#C2C0B6',
    tertiary: '#9C9A92',
    muted: '#85837C',
    ghost: 'rgba(156,154,146,0.5)',
  },
  accent: {
    primary: '#c4633a',
    hover: '#d47548',
    pressed: '#ae5630',
  },
  user: { bubble: '#393937' },
  border: {
    subtle: 'rgba(255,255,255,0.07)',
    medium: 'rgba(255,255,255,0.10)',
    strong: 'rgba(255,255,255,0.18)',
  },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.12)',
    md: '0 0.25rem 1.25rem rgba(0,0,0,0.15)',
    lg: '0 0.5rem 2rem rgba(0,0,0,0.25)',
  },
  status: {
    success: '#66bb6a',
    successBg: 'rgba(102,187,106,0.12)',
    error: '#ef5350',
    errorBg: 'rgba(239,83,80,0.12)',
  },
};

const sharedTokens = {
  radius: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 10,
    xl: 12,
    full: 9999,
  },
  font: {
    serif: FONT_SERIF,
    mono: FONT_MONO,
  },
  transition: 'all 300ms cubic-bezier(0.165, 0.85, 0.45, 1)',
};

export type ClaudeTokens = typeof lightTokens & typeof sharedTokens;

function buildTokens(mode: Mode): ClaudeTokens {
  const modeTokens = mode === 'light' ? lightTokens : darkTokens;
  return { ...modeTokens, ...sharedTokens };
}

interface ThemeModeContextValue {
  mode: Mode;
  toggleMode: () => void;
}

// Default context uses the system-preference / localStorage-override at
// module load time. Without this, the brief window before
// ClaudeThemeProvider mounts (or any out-of-tree consumer of these
// contexts) would render in hardcoded light and flash to the resolved
// theme on the next commit. `getInitialMode` is synchronous and reads
// only DOM/localStorage so it's safe to call at module init.
const _bootMode: Mode = typeof window !== 'undefined' ? getInitialMode() : 'light';

const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: _bootMode,
  toggleMode: () => {},
});

const TokensContext = createContext<ClaudeTokens>(buildTokens(_bootMode));

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export function useClaudeTokens(): ClaudeTokens {
  return useContext(TokensContext);
}

interface ClaudeThemeProviderProps {
  children: React.ReactNode;
}

const ClaudeThemeProvider: React.FC<ClaudeThemeProviderProps> = ({ children }) => {
  const [mode, setMode] = useState<Mode>(getInitialMode);
  // True once the user has explicitly toggled in this session. While
  // false, the system-preference media-query listener is allowed to
  // override `mode`; once the user toggles even once we stop chasing
  // the system and respect their choice.
  const userOverrideRef = useRef<boolean>(readLocalStorageOverride() !== null);

  // (1) After mount, ask OpenSwarm whether a prior app already set a
  // cross-app override. If so AND the user hasn't already toggled in
  // this session AND it differs from current state, adopt it.
  useEffect(() => {
    const token = readUrlToken();
    if (!token) return; // No token = can't auth = skip silently.
    let cancelled = false;
    (async () => {
      try {
        // Use the dedicated endpoint instead of /api/settings — the
        // generic settings PUT takes a FULL AppSettings body which
        // defaults every unset field (api keys, subscription tokens,
        // etc.), so PUTting just `{ app_template_theme_override }`
        // there logs the user out. The dedicated endpoint merges.
        const res = await fetch(`${OPENSWARM_BACKEND}/api/settings/app-theme-override`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const remote = data?.mode;
        if (remote !== 'light' && remote !== 'dark') return;
        // localStorage wins for this app — the user toggled here, that's
        // the latest signal. Otherwise adopt the remote preference.
        if (readLocalStorageOverride() !== null) return;
        userOverrideRef.current = true;
        setMode(remote);
      } catch {
        /* offline / cross-origin blocked / etc — keep the system default */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // (2) If the user hasn't pinned a choice yet, follow the OS as it
  // changes (e.g. macOS auto light-at-day-dark-at-night).
  useEffect(() => {
    if (userOverrideRef.current) return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = () => {
      if (userOverrideRef.current) return;
      setMode(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener?.('change', onChange);
    return () => {
      try { mq.removeEventListener?.('change', onChange); } catch {}
    };
  }, []);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next: Mode = prev === 'light' ? 'dark' : 'light';
      userOverrideRef.current = true;
      // (a) Local fast path so subsequent reloads of THIS app don't
      // flash the wrong theme.
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, next);
      } catch { /* private mode etc. — fine, the remote PUT still carries it */ }
      // (b) Cross-app persistence: push to OpenSwarm's dedicated
      // theme-override endpoint (NOT the generic /api/settings PUT,
      // which expects a full AppSettings body and would default every
      // unspecified field — wiping api keys / subscription tokens and
      // popping the SignInGate). Fire-and-forget — best effort.
      const token = readUrlToken();
      if (token) {
        fetch(`${OPENSWARM_BACKEND}/api/settings/app-theme-override`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ mode: next }),
        }).catch(() => { /* offline / blocked — local override still holds */ });
      }
      return next;
    });
  }, []);

  const tokens = useMemo(() => buildTokens(mode), [mode]);

  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: { mode },
        typography: {
          fontFamily: FONT_SANS,
          button: { textTransform: 'none' as const },
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                backgroundColor: tokens.bg.page,
                color: tokens.text.primary,
                transition: 'background-color 300ms ease, color 300ms ease',
              },
            },
          },
        },
      }),
    [mode, tokens],
  );

  const modeValue = useMemo(() => ({ mode, toggleMode }), [mode, toggleMode]);

  return (
    <ThemeModeContext.Provider value={modeValue}>
      <TokensContext.Provider value={tokens}>
        <ThemeProvider theme={muiTheme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </TokensContext.Provider>
    </ThemeModeContext.Provider>
  );
};

export default ClaudeThemeProvider;
