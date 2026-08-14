import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { API_BASE } from '@/shared/config';

const SETTINGS_API = `${API_BASE}/settings`;

/** Mirrors backend MaestroTokenStatus; carries state + runway, never any part of the token. */
export type MaestroTokenState = 'missing' | 'expired' | 'expiring' | 'valid' | 'opaque';

export interface MaestroTokenStatus {
  state: MaestroTokenState;
  expires_at: number | null;
  expires_in_minutes: number | null;
}

interface MaestroState {
  status: MaestroTokenStatus | null;
  loaded: boolean;
  /** True while a login/start request (or the browser it opened) is outstanding. */
  loginInFlight: boolean;
  /** Set once the system browser has been opened for the current missing/expired streak, so
   *  the 15-minute recheck doesn't reopen it every cycle. Cleared as soon as the token comes
   *  back healthy, so the next dead streak auto-opens again; a manual retry always fires regardless. */
  autoTriggered: boolean;
  /** Set when the login/start call itself failed (network, backend down), so the UI can offer a retry. */
  loginError: boolean;
  /** Set once the user closes the expiring notice, so a 30-minute warning nags only on demand. */
  warningDismissed: boolean;
}

const initialState: MaestroState = {
  status: null,
  loaded: false,
  loginInFlight: false,
  autoTriggered: false,
  loginError: false,
  warningDismissed: false,
};

export const fetchMaestroTokenStatus = createAsyncThunk(
  'maestro/fetchTokenStatus',
  async () => {
    const res = await fetch(`${SETTINGS_API}/maestro/token-status`);
    if (!res.ok) throw new Error('Failed to fetch maestro token status');
    return (await res.json()) as MaestroTokenStatus;
  },
);

/** Kicks off the Keycloak login: asks the backend for an authorize URL, then opens it in the
 * system browser via the Electron bridge. The browser round-trip lands on the backend (not
 * this renderer), so the gate's status poll is what notices the login actually completed. */
export const startMaestroLogin = createAsyncThunk(
  'maestro/startLogin',
  async () => {
    const res = await fetch(`${SETTINGS_API}/maestro/login/start`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to start Maestro login');
    const data = await res.json().catch(() => null);
    const url = typeof data?.authorize_url === 'string' ? data.authorize_url : '';
    if (url) {
      const api = (window as any).maestro;
      if (api?.openExternal) api.openExternal(url);
      else window.open(url, '_blank');
    }
    return true;
  },
);

const maestroSlice = createSlice({
  name: 'maestro',
  initialState,
  reducers: {
    dismissMaestroWarning(state) {
      state.warningDismissed = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMaestroTokenStatus.fulfilled, (state, action) => {
        state.status = action.payload;
        state.loaded = true;
        // A token that came back healthy resets the notices, so the next dead streak warns/auto-opens again.
        if (action.payload.state === 'valid' || action.payload.state === 'opaque') {
          state.warningDismissed = false;
          state.autoTriggered = false;
        }
      })
      .addCase(fetchMaestroTokenStatus.rejected, (state) => {
        // Backend unreachable is not the same as no token; stay quiet rather than prompt on a boot race.
        state.loaded = true;
      })
      .addCase(startMaestroLogin.pending, (state) => {
        state.loginInFlight = true;
        state.loginError = false;
        state.autoTriggered = true;
      })
      .addCase(startMaestroLogin.fulfilled, (state) => {
        state.loginInFlight = false;
      })
      .addCase(startMaestroLogin.rejected, (state) => {
        state.loginInFlight = false;
        state.loginError = true;
      });
  },
});

export const { dismissMaestroWarning } = maestroSlice.actions;
export default maestroSlice.reducer;
