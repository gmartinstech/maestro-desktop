import { API_BASE, getAuthToken } from '@/shared/config';

function authHeaders(): Record<string, string> {
  let tok = '';
  try { tok = getAuthToken(); } catch { tok = ''; }
  return { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) };
}

const base = `${API_BASE}/workflows`;

// Sticky single edit-agent session for a workflow. The backend snapshots steps
// into draft_steps when it first hands one out; reattaches on later calls.
export async function ensureEditAgentSession(workflowId: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}/${encodeURIComponent(workflowId)}/edit-agent-session`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.session_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}
