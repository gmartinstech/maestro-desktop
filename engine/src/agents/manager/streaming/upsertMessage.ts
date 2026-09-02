// engine/src/agents/manager/streaming/upsertMessage.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/streaming/upsert_message.py: append a message to a session, or
// replace it in place when its id already exists. Makes a duplicate-id row unrepresentable when a
// stream commit races a stop's early partial commit (both carry the same stream message id).
// `session.message_index` accelerates the id-already-known case; a miss is never treated as proof
// the id is absent (many call sites push to `session.messages` directly without updating the
// index), so a miss just costs one linear-scan fallback, which also repairs the cache.

import type { AgentSession, Message } from '../../core/models';

export function upsertMessage(session: AgentSession, msg: Message): void {
  const cachedIdx = session.message_index[msg.id];
  if (cachedIdx !== undefined && cachedIdx < session.messages.length && session.messages[cachedIdx].id === msg.id) {
    session.messages[cachedIdx] = msg;
    return;
  }
  for (let i = 0; i < session.messages.length; i++) {
    if (session.messages[i].id === msg.id) {
      session.messages[i] = msg;
      session.message_index[msg.id] = i;
      return;
    }
  }
  session.messages.push(msg);
  session.message_index[msg.id] = session.messages.length - 1;
}
