import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { API_BASE } from '@/shared/config';

const SETTINGS_API = `${API_BASE}/settings`;

/** Mirrors backend ProvedorIaTokenStatus; carries state + runway, never any part of the token. */
export type ProvedorIaTokenState = 'missing' | 'expired' | 'expiring' | 'valid' | 'opaque';

export interface ProvedorIaTokenStatus {
  state: ProvedorIaTokenState;
  expires_at: number | null;
  expires_in_minutes: number | null;
}

/** Why the paste was refused; the backend answers with a state name so the token never rides back in an error. */
export type ProvedorIaSubmitError = 'expired' | 'missing' | 'failed';

interface ProvedorIaState {
  status: ProvedorIaTokenStatus | null;
  loaded: boolean;
  promptOpen: boolean;
  submitting: boolean;
  submitError: ProvedorIaSubmitError | null;
  /** Set once the user closes the expiring notice, so a 30-minute warning nags only on demand. */
  warningDismissed: boolean;
}

const initialState: ProvedorIaState = {
  status: null,
  loaded: false,
  promptOpen: false,
  submitting: false,
  submitError: null,
  warningDismissed: false,
};

export const fetchProvedorIaTokenStatus = createAsyncThunk(
  'provedorIa/fetchTokenStatus',
  async () => {
    const res = await fetch(`${SETTINGS_API}/provedor-ia/token-status`);
    if (!res.ok) throw new Error('Failed to fetch provedor-ia token status');
    return (await res.json()) as ProvedorIaTokenStatus;
  },
);

export const submitProvedorIaToken = createAsyncThunk<
  ProvedorIaTokenStatus,
  string,
  { rejectValue: ProvedorIaSubmitError }
>('provedorIa/submitToken', async (token, { rejectWithValue }) => {
  let res: Response;
  try {
    res = await fetch(`${SETTINGS_API}/provedor-ia/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    return rejectWithValue('failed');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const reason = data?.reason;
    return rejectWithValue(reason === 'expired' || reason === 'missing' ? reason : 'failed');
  }
  return data.status as ProvedorIaTokenStatus;
});

const provedorIaSlice = createSlice({
  name: 'provedorIa',
  initialState,
  reducers: {
    openProvedorIaPrompt(state) {
      state.promptOpen = true;
      state.submitError = null;
    },
    closeProvedorIaPrompt(state) {
      state.promptOpen = false;
      state.submitError = null;
    },
    dismissProvedorIaWarning(state) {
      state.warningDismissed = true;
    },
    setProvedorIaSubmitError(state, action: PayloadAction<ProvedorIaSubmitError | null>) {
      state.submitError = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProvedorIaTokenStatus.fulfilled, (state, action) => {
        state.status = action.payload;
        state.loaded = true;
        // A token that came back healthy resets the notice, so the next expiry warns again.
        if (action.payload.state === 'valid' || action.payload.state === 'opaque') {
          state.warningDismissed = false;
        }
      })
      .addCase(fetchProvedorIaTokenStatus.rejected, (state) => {
        // Backend unreachable is not the same as no token; stay quiet rather than prompt on a boot race.
        state.loaded = true;
      })
      .addCase(submitProvedorIaToken.pending, (state) => {
        state.submitting = true;
        state.submitError = null;
      })
      .addCase(submitProvedorIaToken.fulfilled, (state, action) => {
        state.submitting = false;
        state.status = action.payload;
        state.loaded = true;
        state.promptOpen = false;
        state.warningDismissed = false;
      })
      .addCase(submitProvedorIaToken.rejected, (state, action) => {
        state.submitting = false;
        state.submitError = action.payload ?? 'failed';
      });
  },
});

export const {
  openProvedorIaPrompt,
  closeProvedorIaPrompt,
  dismissProvedorIaWarning,
  setProvedorIaSubmitError,
} = provedorIaSlice.actions;
export default provedorIaSlice.reducer;
