// engine/src/apps/outputs/htmlInject.ts -- SUB-5, a port of backend/apps/outputs/html_inject.py's
// HTML data-injection + relative-URL token rewriting for served outputs.
//
// The token rewrite (injectTokenIntoRelativeUrls) is a security boundary: iframe sub-resource
// fetches drop the parent's ?token= query, so the serve routes re-stamp it onto every relative
// href/src or they 401. Keep it wired to the serve routes.
//
// SCOPE NOTE on validateAgainstSchema: the Python original defers to the `jsonschema` package
// (full JSON Schema Draft-07 validator). engine/ has no such dependency and this port does not add
// one (a full draft-07 implementation is out of scope for this ticket) -- instead this is a
// structural subset covering exactly what the App Builder's own generated schemas use in practice
// (type/properties/required/items/enum for object/string/number/integer/boolean/array/null), which
// is also all `/api/outputs/execute`'s HITL validation step has ever needed. A schema using a
// draft-07 keyword this subset doesn't know (allOf, $ref, pattern, ...) is treated as "no opinion"
// (that keyword is silently not checked) rather than a false rejection -- matches the caller's own
// tolerance: a validation gap here means a request that should have 400'd doesn't, never the
// reverse (a good request wrongly rejected).

const P_ABSOLUTE_URL_PREFIXES = ['http://', 'https://', '//', 'data:', 'blob:', 'mailto:', 'tel:', 'javascript:', 'about:', '#'];

const P_HREF_SRC_ATTR_RE = /(\s(?:href|src))\s*=\s*(["'])([^"']+)\2/gi;

export function pRuntimeHelpersJs(): string {
  return (
    "  window.OUTPUT_COMPUTE = async function () { throw new Error('OUTPUT_COMPUTE runs once this app is published.'); };\n" +
    "  window.OUTPUT_LLM = async function () { throw new Error('OUTPUT_LLM runs once this app is published.'); };\n"
  );
}

export function buildDataInjection(inputJson: string, resultJson: string, backendUrlJson = 'null', withRuntime = false): string {
  const helpers = withRuntime ? pRuntimeHelpersJs() : '';
  return (
    '<script>\n' +
    '(function() {\n' +
    `  window.OUTPUT_INPUT = ${inputJson};\n` +
    `  window.OUTPUT_BACKEND_RESULT = ${resultJson};\n` +
    `  window.OUTPUT_BACKEND_URL = ${backendUrlJson};\n` +
    helpers +
    "  window.addEventListener('message', function(e) {\n" +
    "    if (e.data && e.data.type === 'OUTPUT_DATA') {\n" +
    '      window.OUTPUT_INPUT = e.data.input || {};\n' +
    '      window.OUTPUT_BACKEND_RESULT = e.data.backendResult || null;\n' +
    '      if (e.data.backendUrl !== undefined) window.OUTPUT_BACKEND_URL = e.data.backendUrl;\n' +
    "      window.dispatchEvent(new CustomEvent('output-data-ready'));\n" +
    '    }\n' +
    '  });\n' +
    '})();\n' +
    '</script>'
  );
}

export function injectDataIntoHtml(html: string, inputJson = '{}', resultJson = 'null', backendUrlJson = 'null', withRuntime = false): string {
  const injection = buildDataInjection(inputJson, resultJson, backendUrlJson, withRuntime);
  if (html.includes('</head>')) return html.replace('</head>', `${injection}\n</head>`);
  if (html.includes('<body')) return html.replace('<body', `${injection}\n<body`);
  return `${injection}\n${html}`;
}

/** Append `?token=<t>` to every relative href/src in the served HTML. Idempotent: skips URLs that
 * already carry a `token=` param. Skips absolute URLs (CDN, data:, etc). */
export function injectTokenIntoRelativeUrls(html: string, token: string): string {
  if (!token) return html;
  return html.replace(P_HREF_SRC_ATTR_RE, (whole, attr: string, quote: string, url: string) => {
    const lowered = url.toLowerCase().trimStart();
    if (P_ABSOLUTE_URL_PREFIXES.some((p) => lowered.startsWith(p))) return whole;
    if (url.includes('token=')) return whole;
    const hashIdx = url.indexOf('#');
    const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const frag = hashIdx >= 0 ? url.slice(hashIdx) : '';
    const sep = base.includes('?') ? '&' : '?';
    return `${attr}=${quote}${base}${sep}token=${token}${frag}${quote}`;
  });
}

/** Decode the base64-encoded `_d` query param into [inputJson, resultJson]. */
export function decodeDataParam(d: string): [string, string] {
  try {
    const decoded = JSON.parse(Buffer.from(d, 'base64').toString('utf8')) as { i?: unknown; r?: unknown };
    return [JSON.stringify(decoded.i ?? {}), JSON.stringify(decoded.r ?? null)];
  } catch {
    return ['{}', 'null'];
  }
}

/** Cheap inline lookup: the JSON-encoded backend URL for the given workspace, or "null" if no
 * runtime is active. Takes the runtime manager as a parameter (rather than importing it directly)
 * so this module stays a leaf with no dependency on runtime.ts's larger surface -- serveWorkspaceFile
 * in outputs.ts supplies the real singleton. */
export function backendUrlForWorkspace(
  workspaceId: string,
  getRuntime: (workspaceId: string) => { running: boolean; port: number | null } | undefined,
): string {
  try {
    const rt = getRuntime(workspaceId);
    if (rt?.running && rt.port) return JSON.stringify(`http://127.0.0.1:${rt.port}`);
  } catch {
    // Best-effort, matches html_inject.py's own bare except-log.
  }
  return 'null';
}

type SchemaNode = {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  enum?: unknown[];
};

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'null': return value === null;
    default: return true; // unknown type keyword: no opinion, see module doc
  }
}

/** Validate `data` against a structural subset of `schema` (see module doc). Returns an error
 * string, or null when valid / when the schema uses keywords this subset doesn't understand. */
export function validateAgainstSchema(data: unknown, schema: unknown, path = '(root)'): string | null {
  if (typeof schema !== 'object' || schema === null) return null;
  const node = schema as SchemaNode;

  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((t) => typeMatches(data, t))) {
      return `Schema validation failed at ${path}: ${JSON.stringify(data)} is not of type ${types.map((t) => `'${t}'`).join(' or ')}`;
    }
  }

  if (node.enum && !node.enum.some((v) => JSON.stringify(v) === JSON.stringify(data))) {
    return `Schema validation failed at ${path}: ${JSON.stringify(data)} is not one of ${JSON.stringify(node.enum)}`;
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    for (const key of node.required ?? []) {
      if (!(key in obj)) return `Schema validation failed at ${path}: '${key}' is a required property`;
    }
    if (node.properties) {
      for (const [key, propSchema] of Object.entries(node.properties)) {
        if (!(key in obj)) continue;
        const err = validateAgainstSchema(obj[key], propSchema, path === '(root)' ? key : `${path} -> ${key}`);
        if (err) return err;
      }
    }
  }

  if (Array.isArray(data) && node.items) {
    for (let i = 0; i < data.length; i++) {
      const err = validateAgainstSchema(data[i], node.items, path === '(root)' ? String(i) : `${path} -> ${i}`);
      if (err) return err;
    }
  }

  return null;
}
