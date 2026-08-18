import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface TempState {
  pendingBrowserUrl: string | null;
  pendingFocusAgentId: string | null;
  lastDashboardId: string | null;
  fullscreenCardId: string | null;
}

const initialState: TempState = {
  pendingBrowserUrl: null,
  pendingFocusAgentId: null,
  lastDashboardId: null,
  fullscreenCardId: null,
};

const tempStateSlice = createSlice({
  name: 'tempState',
  initialState,
  reducers: {
    setPendingBrowserUrl(state, action: PayloadAction<string>) {
      state.pendingBrowserUrl = action.payload;
    },
    clearPendingBrowserUrl(state) {
      state.pendingBrowserUrl = null;
    },
    setLastDashboardId(state, action: PayloadAction<string>) {
      state.lastDashboardId = action.payload;
    },
    setPendingFocusAgentId(state, action: PayloadAction<string>) {
      state.pendingFocusAgentId = action.payload;
    },
    clearPendingFocusAgentId(state) {
      state.pendingFocusAgentId = null;
    },
    setFullscreenCardId(state, action: PayloadAction<string>) {
      state.fullscreenCardId = action.payload;
    },
    clearFullscreenCardId(state, action: PayloadAction<string>) {
      if (state.fullscreenCardId === action.payload) state.fullscreenCardId = null;
    },
  },
});

export const {
  setPendingBrowserUrl,
  clearPendingBrowserUrl,
  setLastDashboardId,
  setPendingFocusAgentId,
  clearPendingFocusAgentId,
  setFullscreenCardId,
  clearFullscreenCardId,
} = tempStateSlice.actions;

export default tempStateSlice.reducer;
