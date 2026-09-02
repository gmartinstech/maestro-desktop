// engine/src/agents/manager/streaming/partialReply.ts -- AGT-4, a faithful port of
// backend/apps/agents/manager/streaming/PartialReply.py: the in-flight streamed assistant text for
// one session, mirrored off the stream so a stop can commit the partial reply instantly instead of
// waiting out the SDK teardown. A fixed-shape record (plain interface, not a class -- see state.ts's
// header for why this file drops pydantic's runtime validation).

export interface PartialReply {
  msgId: string | null;
  text: string;
  branchId: string | null;
}

export function createPartialReply(overrides: Partial<PartialReply> = {}): PartialReply {
  return {
    msgId: overrides.msgId ?? null,
    text: overrides.text ?? '',
    branchId: overrides.branchId ?? null,
  };
}
