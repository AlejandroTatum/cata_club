/**
 * Pure fail-closed localhost guard — NO k6 imports, so contract tests can
 * execute it directly with node (tests copy it to .mjs).
 *
 * Accepts ONLY http:// to loopback with an optional numeric port:
 *   http://localhost[:port]   http://127.x.x.x[:port]   http://[::1][:port]
 *
 * Anything else throws: https, any other host, and — the real-world bypass —
 * authorities carrying USERINFO: 'http://127.0.0.1:9@staging.example.com'
 * connects to staging.example.com, not to 127.0.0.1. The authority regex
 * below cannot match '@', so userinfo is rejected by construction, before
 * any port/host splitting happens.
 */

const RE_AUTORIDAD_LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/;

/** Throws unless the URL is http:// loopback. Returns the origin to use. */
export function assertLocalBaseUrl(rawUrl) {
  const candidate = String(rawUrl).replace(/\/+$/, '');
  const match = /^http:\/\/([^/\s]+)(\/.*)?$/.exec(candidate);
  const authority = match ? match[1] : '';

  if (match === null || !RE_AUTORIDAD_LOCAL.test(authority)) {
    throw new Error(
      `LOAD_BASE_URL must target the local QA stack (http://localhost:3000, ` +
        `http://127.0.0.1:[port], or http://[::1]:[port]); got '${rawUrl}'. ` +
        `Authorities carrying userinfo ('@') are always rejected. ` +
        `Staging and production are PROHIBITED targets for this harness.`,
    );
  }
  return `http://${authority}`;
}
