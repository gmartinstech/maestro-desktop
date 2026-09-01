// engine/src/net/localProxy.ts -- ENG-1's raw HTTP/WS proxy plumbing to the spawned Python
// backend, moved here by ENG-7 so its `node:http` usage lives inside engine/src/net/, the one
// directory ESLint's no-restricted-imports rule (engine/eslint.config.mjs) exempts from the
// provider-egress ban.
//
// This is NOT an "outbound" call in the provider-egress sense -- it always targets the engine's
// own bind host (127.0.0.1 by default; see server.ts's `host`), the spawned Python backend on the
// SAME machine, never an internet host -- but node:http's raw request/response streaming and
// upgrade-socket splicing (needed for byte-transparent proxying, including WebSocket upgrades)
// has no equivalent in the fetch() API that engine/src/net/http.ts's engineFetch() wraps, so it
// can't simply be rewritten as an engineFetch() call. Moving the whole mechanism into net/ (rather
// than carving out a per-file ESLint exemption for server.ts) keeps "every outbound-network-capable
// module lives under engine/src/net/" true as a structural invariant, not a list of exceptions.
//
// Logic is unchanged from ENG-1's original server.ts -- see server.ts's own comments for the
// design rationale (byte-transparent proxying, the CTR-3 1006-vs-4401 WS auth-rejection finding,
// etc.), which this move does not revisit.

import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export function stripHopByHopRequestHeaders(headers: IncomingMessage['headers']): IncomingMessage['headers'] {
  const out = { ...headers };
  // `host` must be re-derived for the backend's own host:port, not copied from the original
  // request (which names the engine, not the backend it's being forwarded to).
  delete out.host;
  return out;
}

/** Forwards one HTTP request to the backend unmodified (method, path, headers, body) and streams
 * the backend's response straight back to the original caller (status, headers, body). */
export function proxyHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer,
  backendPort: number,
  backendHost: string,
): Promise<void> {
  return new Promise((resolvePromise) => {
    const headers = stripHopByHopRequestHeaders(req.headers);
    // The body was fully buffered by Fastify's content-type parser (see server.ts's
    // registerServer), so the original Content-Length (if any) may no longer match; recompute it
    // from what we're actually about to send instead of trusting the stale header.
    delete headers['content-length'];
    if (body.length > 0) headers['content-length'] = String(body.length);
    const proxyReq = httpRequest(
      { host: backendHost, port: backendPort, path: req.url, method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on('end', resolvePromise);
      },
    );
    proxyReq.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_gateway', detail: String(err) }));
      resolvePromise();
    });
    proxyReq.end(body.length > 0 ? body : undefined);
  });
}

/** Forwards one WS upgrade to the backend unmodified, then splices the two raw TCP sockets
 * together so every subsequent frame (either direction) passes through byte-for-byte with no
 * re-framing -- transport-level proxying, not a WS client/server pair re-relaying parsed frames. */
export function proxyWebSocketUpgrade(
  req: IncomingMessage,
  clientSocket: Socket,
  clientHead: Buffer,
  backendPort: number,
  backendHost: string,
): void {
  // MUST be attached before anything else, unconditionally: a raw net.Socket with no 'error'
  // listener throws and crashes the whole process on error (Node's default stream behavior), and
  // the backend's own real pre-accept WS auth rejection (CTR-3's confirmed 1006-on-the-wire, not
  // 4401) exercises exactly this path on every bad-auth WS attempt, not a rare edge case --
  // confirmed live: without this listener, that exact scenario took the whole engine process down
  // mid-request.
  clientSocket.on('error', () => clientSocket.destroy());

  const headers = stripHopByHopRequestHeaders(req.headers);
  const proxyReq = httpRequest({ host: backendHost, port: backendPort, path: req.url, method: req.method, headers });

  proxyReq.on('upgrade', (proxyRes, backendSocket, backendHead) => {
    const statusMessage = proxyRes.statusMessage || 'Switching Protocols';
    const headerLines = Object.entries(proxyRes.headers)
      .flatMap(([k, v]) => (Array.isArray(v) ? v.map((vv) => `${k}: ${vv}`) : v === undefined ? [] : [`${k}: ${v}`]))
      .join('\r\n');
    clientSocket.write(`HTTP/1.1 ${proxyRes.statusCode} ${statusMessage}\r\n${headerLines}\r\n\r\n`);
    if (backendHead && backendHead.length > 0) clientSocket.write(backendHead);
    if (clientHead && clientHead.length > 0) backendSocket.write(clientHead);
    backendSocket.pipe(clientSocket);
    clientSocket.pipe(backendSocket);
    // Either leg dying (network drop, backend restart) must tear down the other -- an orphaned
    // half-open socket on either side would leak a fd and never notify the surviving peer.
    backendSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => backendSocket.destroy());
  });

  // The backend answered with a normal HTTP response instead of switching protocols (e.g. a real
  // non-websocket 4xx) -- relay it verbatim rather than leaving the client hanging forever.
  proxyReq.on('response', (proxyRes) => {
    const statusMessage = proxyRes.statusMessage || 'Bad Request';
    const headerLines = Object.entries(proxyRes.headers)
      .flatMap(([k, v]) => (Array.isArray(v) ? v.map((vv) => `${k}: ${vv}`) : v === undefined ? [] : [`${k}: ${v}`]))
      .join('\r\n');
    try {
      clientSocket.write(`HTTP/1.1 ${proxyRes.statusCode} ${statusMessage}\r\n${headerLines}\r\n\r\n`);
      proxyRes.pipe(clientSocket);
    } catch { /* client already gone */ }
  });

  // Covers both an explicit backend-side error AND the CTR-3 abrupt-drop case (the backend closes
  // the raw TCP connection mid-handshake with no HTTP response at all, before .accept() ever
  // runs) -- Node's http client surfaces that as an 'error' (ECONNRESET/"socket hang up"), not a
  // clean response. Destroying the client socket without a well-formed WS close frame is exactly
  // what reproduces the real backend's observed behavior: the client sees an abnormal closure
  // (code 1006), not a fabricated close frame this proxy invented.
  proxyReq.on('error', () => {
    clientSocket.destroy();
  });

  proxyReq.end();
}
