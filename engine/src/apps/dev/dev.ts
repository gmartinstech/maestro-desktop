// engine/src/apps/dev/dev.ts -- SUB-10, a native port of backend/main.py's bare
// `GET /api/dev/token` route (~10 lines, not a SubApp -- a loose top-level route mounted directly
// on `app`).
//
// Hands the per-install bearer token to the dev frontend, which has no Electron/Tauri preload to
// read it from. Disabled in packaged builds (the preload exists there instead) -- localhost
// binding is the only thing gating it in dev, same posture as the Python original.
//
// This route is more than a dev convenience for THIS engine specifically:
// scripts/run-contract-tests-via-engine.mjs's own waitForHealth() probes this exact path to fetch
// CONTRACT_TOKEN before it ever launches the Playwright suite -- so under an all-native,
// MAESTRO_ENGINE_SKIP_BACKEND=1 configuration, leaving 'dev' unported would 502 the contract
// harness itself before a single contract test runs, not just leave a dev-only nicety proxied.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAuthToken } from '../../auth/token';

// Handles GET /api/dev/token; returns false (reply left untouched) for any other path/method so
// the caller can fall back to proxying at Python, same convention as
// settings/handler.ts's handleSettingsHttpRequest.
export async function handleDevHttpRequest(pathname: string, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (pathname !== '/api/dev/token') return false;
  if (request.method.toUpperCase() !== 'GET') {
    reply.code(405).send({ error: 'method_not_allowed', detail: `${request.method} not supported on /api/dev/token` });
    return true;
  }
  if (process.env.MAESTRO_PACKAGED === '1') {
    reply.code(404).send({ error: 'not available' });
    return true;
  }
  reply.code(200).send({ token: getAuthToken() });
  return true;
}
