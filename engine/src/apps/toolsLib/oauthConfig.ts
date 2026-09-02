// engine/src/apps/toolsLib/oauthConfig.ts -- SUB-4, a port of backend/apps/tools_lib/oauth_config.py.
// backend/.env dotenv-loading is deliberately NOT re-ported here: the engine has no equivalent
// dotenv boot step anywhere else in engine/src (ENG-1's own main.ts reads process.env directly),
// so this mirrors that same convention -- a real .env override still works because both processes
// share the same OS environment when the engine spawns the Python backend as a child.

/** Base URL for the OAuth helper service (the Maestro provider gateway's OAuth-proxy routes).
 * Override via env in dev if needed -- same variable name and default as the Python original. */
export const MAESTRO_OAUTH_BASE_URL = (process.env.MAESTRO_OAUTH_BASE_URL || 'https://llm.martinstech.net/v1').replace(/\/+$/, '');
