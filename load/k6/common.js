/**
 * Shared harness for the local-QA k6 load runs (issue #1314 prerequisite).
 *
 * Grounded journey (no invented endpoints — every route below exists in the
 * frontend BFF, see frontend/src/app/api/**):
 *
 *   1. POST /api/auth/login     JSON {email, password}; on success the BFF
 *                               sets HttpOnly access/refresh cookies (k6 keeps
 *                               them in the per-VU cookie jar) and returns the
 *                               token-free session, whose user.id is the
 *                               personaId and user.role the resolved role.
 *   2. GET  /api/auth/session   What every page mount does to hydrate auth.
 *   3. One role-appropriate read:
 *        admin  -> GET /api/dashboard            (aggregated /dashboard/stats)
 *        else   -> GET /api/student?personaId=N  (aggregated student portal)
 *
 * Credentials and base URL come from environment variables ONLY. Nothing in
 * this tree may hold a seed credential: the QA seed's known passwords and its
 * seeded addresses are banned literals, locked by
 * tests/test_load_testing_config.py.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { assertLocalBaseUrl } from './local_guard.js';

// Fail-closed local guard — the load harness refuses to aim anywhere that is
// not the local QA edge. The parsing policy lives in the pure module
// local_guard.js (userinfo authorities rejected by construction; only
// localhost / 127.0.0.0/8 / [::1] with a numeric port), so contract tests
// can execute it with node and scenarios can trust one implementation.

export { assertLocalBaseUrl };

export const BASE_URL = assertLocalBaseUrl(
  (__ENV.LOAD_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
);

// ---------------------------------------------------------------------------
// Credentials — env only. Either a git-ignored pool file (built by
// scripts/load/build_credentials_pool.py):
//   LOAD_CREDENTIALS_FILE=load/results/credentials-pool.json
// an inline bounded pool:
//   LOAD_CREDENTIALS_JSON='[{"email":"...","password":"..."}, ...]'
// or a single pair:
//   LOAD_EMAIL=... LOAD_PASSWORD=...
//
// The pool is BOUNDED and REUSED across VUs: 100 VUs do NOT mean 100 distinct
// identities. VU i uses pool[(i - 1) % pool.length], so the server sees at
// most `pool.length` concurrent authenticated identities. Documented in
// docs/operations/load-testing.md.
// ---------------------------------------------------------------------------

// Credential file support (100-identity pools are too big for some shells'
// env-var limits): the runner mounts the git-ignored local pool file and
// points LOAD_CREDENTIALS_FILE at it. k6's open() is init-context only, so
// the file is read ONCE here at module init — never per iteration.
let poolDesdeArchivo = null;
if (__ENV.LOAD_CREDENTIALS_FILE) {
  poolDesdeArchivo = JSON.parse(open(__ENV.LOAD_CREDENTIALS_FILE));
}

function validarPool(pool, origen) {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error(`${origen} must be a non-empty array of {email, password}`);
  }
  for (const credential of pool) {
    if (typeof credential.email !== 'string' || typeof credential.password !== 'string') {
      throw new Error(`every ${origen} entry needs string email and password`);
    }
  }
  return pool;
}

export function loadCredentials() {
  if (poolDesdeArchivo) {
    return validarPool(poolDesdeArchivo, 'LOAD_CREDENTIALS_FILE');
  }
  const poolJson = __ENV.LOAD_CREDENTIALS_JSON;
  if (poolJson) {
    let pool;
    try {
      pool = JSON.parse(poolJson);
    } catch {
      throw new Error('LOAD_CREDENTIALS_JSON is not valid JSON');
    }
    return validarPool(pool, 'LOAD_CREDENTIALS_JSON');
  }
  if (__ENV.LOAD_EMAIL && __ENV.LOAD_PASSWORD) {
    return [{ email: __ENV.LOAD_EMAIL, password: __ENV.LOAD_PASSWORD }];
  }
  throw new Error(
    'no credentials supplied: set LOAD_CREDENTIALS_FILE (pooled file), ' +
      'LOAD_CREDENTIALS_JSON (bounded pool) or LOAD_EMAIL + LOAD_PASSWORD',
  );
}

export function credentialForVU(vu, pool) {
  return pool[(vu - 1) % pool.length];
}

/**
 * Fail-closed pool guard (review correction): the per-user read caps make
 * identity sharing invalid capacity evidence, so any scenario claiming
 * capacity must have AT LEAST one identity per VU. Baseline (1 VU) is
 * exempt. Steady calls this with 100; ramp with its configured target.
 */
export function asegurarPoolSuficiente(pool, minimo, escenario) {
  if (pool.length < minimo) {
    throw new Error(
      `${escenario} necesita al menos ${minimo} identidades (pool 1:1) y el pool tiene ${pool.length}. ` +
        `Construí el pool con 'make load-pool' (QA_SEED_PASSWORD=...) y usá LOAD_CREDENTIALS_FILE.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Journey metrics — per-step trends so a slow login is distinguishable from a
// slow role read in summary.json.
// ---------------------------------------------------------------------------

const loginDuration = new Trend('journey_login_duration', true);
const sessionDuration = new Trend('journey_session_duration', true);
const roleReadDuration = new Trend('journey_role_read_duration', true);

/**
 * Fails the whole journey (not just one request) when any step fails, so
 * `journey_failure_rate` tracks journey-level health the way a user would
 * experience it.
 */
export const journeyFailureRate = new Rate('journey_failure_rate');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Think time (env-tunable). Defaults 2-4 s keep one VU per identity at
// ~17-20 portal reads/min, under the 30/min PER-USER cap the backend puts on
// /personas/{id}/representados — a route the BFF hits on EVERY portal read
// (frontend/src/app/api/student/route.ts:86). Sharing identities across VUs
// divides the budget: raise these knobs (see docs/operations/load-testing.md).
const THINK_MIN = Number(__ENV.LOAD_THINK_TIME_MIN || 2);
const THINK_MAX = Number(__ENV.LOAD_THINK_TIME_MAX || 4);

function pensar() {
  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

// Per-VU session cache. k6 executes init code per VU, and keying by __VU
// keeps isolation even under runtimes that share module state. A real user
// logs in ONCE and then reads: the backend caps login at 60/min/IP
// (auth_router.py @limiter.limit("60/minute")) and every VU shares one IP,
// so per-iteration re-login would blow past the cap (observed 7×429 in QA).
// Tokens live in this in-memory cache only — never logged, never persisted.
const cookiesPorVU = new Map();

function loginYCachea(credential, faseTags) {
  // Step 1 — login through the BFF (OAuth2 re-encoding happens server-side).
  const login = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify(credential), {
    headers: JSON_HEADERS,
    tags: { name: 'login', ...faseTags },
  });
  loginDuration.add(login.timings.duration);
  const loginBody = login.status === 200 ? login.json() : null;
  const loginOk =
    check(login, { 'login responds 200': (r) => r.status === 200 }) &&
    check(loginBody, {
      'login returns a session': (b) => b !== null && Boolean(b.user && b.user.id && b.user.role),
    });
  if (!loginOk) return null;

  // QA's production frontend build sets the auth cookies with the Secure
  // attribute, and k6's cookie jar refuses Secure cookies over plain http://
  // (a documented QA limitation — the app's cookie security is NOT weakened
  // here). The journey therefore carries ONLY the two auth cookie names the
  // BFF actually sets — access_token and refresh_token, see
  // frontend/src/lib/auth-cookies.ts — taken from THIS VU's own login
  // response, as an explicit Cookie header. Values never leave this VU's
  // cache and are never logged or written.
  const paresCookies = [];
  for (const nombre of ['access_token', 'refresh_token']) {
    const seteada = login.cookies[nombre] && login.cookies[nombre][0];
    if (seteada && seteada.value) paresCookies.push(`${nombre}=${seteada.value}`);
  }
  if (paresCookies.length === 0) {
    // Without auth cookies every later step is anonymous: fail the journey
    // explicitly instead of measuring a 401 walk nobody performs.
    check(null, { 'login no seteó cookies de auth': () => false });
    return null;
  }
  return {
    cookieHeader: paresCookies.join('; '),
    personaId: loginBody.user.id,
    role: loginBody.user.role,
  };
}

export function authenticatedReadJourney(credential, tagsExtra) {
  let failedSteps = 0;
  // Optional per-request phase tag (steady_100 tags warmup/plateau/rampdown
  // from the scenario clock) so acceptance thresholds can be bound to the
  // plateau sub-metrics only.
  const faseTags = tagsExtra && tagsExtra.phase ? { phase: tagsExtra.phase } : {};

  // Login once per VU; later iterations reuse the cached session.
  let cache = cookiesPorVU.get(__VU);
  if (!cache) {
    cache = loginYCachea(credential, faseTags);
    if (!cache) {
      journeyFailureRate.add(1);
      // Think time applies even after a failed login: without it, a down or
      // struggling backend turns the harness into a hot-loop hammer (observed:
      // 171k failed iterations in 30 s during the stack-down smoke).
      pensar();
      return;
    }
    cookiesPorVU.set(__VU, cache);
  }
  const { cookieHeader, personaId, role } = cache;

  // Step 2 — session hydration (same call every page mount performs).
  const session = http.get(`${BASE_URL}/api/auth/session`, {
    tags: { name: 'session', ...faseTags },
    headers: { Cookie: cookieHeader },
  });
  sessionDuration.add(session.timings.duration);
  const sessionOk = check(session, {
    'session responds 200': (r) => r.status === 200,
    // The authenticated branch returns the session payload DIRECTLY
    // (user/roles/...) — {authenticated:false} only exists when anonymous.
    'session is authenticated': (r) => {
      if (r.status !== 200) return false;
      const user = r.json('user');
      return Boolean(user && user.id);
    },
  });
  if (!sessionOk) failedSteps += 1;

  // Step 3 — one role-appropriate aggregated read. The persona portal
  // (/api/student) is the route a signed-in student/representante lands on;
  // admins land on the dashboard aggregate. Other roles are NOT part of the
  // calibrated journey and simply take the student portal path here.
  let roleRead;
  if (role === 'admin') {
    roleRead = http.get(`${BASE_URL}/api/dashboard`, {
      tags: { name: 'dashboard', ...faseTags },
      headers: { Cookie: cookieHeader },
    });
  } else {
    roleRead = http.get(`${BASE_URL}/api/student?personaId=${encodeURIComponent(personaId)}`, {
      tags: { name: 'student-portal', ...faseTags },
      headers: { Cookie: cookieHeader },
    });
  }
  roleReadDuration.add(roleRead.timings.duration);
  const roleReadOk = check(roleRead, { 'role read responds 200': (r) => r.status === 200 });
  if (!roleReadOk) failedSteps += 1;

  journeyFailureRate.add(failedSteps > 0, faseTags);

  // Think time: a real user reads the page before navigating again.
  pensar();
}

// ---------------------------------------------------------------------------
// Machine-readable summary. Every scenario exports handleSummary built here:
// <results dir>/summary.json holds the full machine-readable k6 payload PLUS
// an explicit VU-vs-sessions block, and stdout gets a compact text summary
// generated HERE (k6 has no built-in text-summary module to import; this
// keeps the harness reproducible across k6 versions):
//   - vus_max            peak concurrent users at an instant
//   - sessions_completed total journeys executed over the whole run
// ---------------------------------------------------------------------------

export function buildHandleSummary() {
  return function (data) {
    const metricValues = (name) => (data.metrics && data.metrics[name] && data.metrics[name].values) || {};
    const iterations = metricValues('iterations').count || 0;
    // k6's 'vus_max' is CONFIGURED capacity, not observed concurrency; the
    // sampled 'vus' gauge carries what actually ran. Report both honestly.
    const observedPeak = metricValues('vus').max ?? metricValues('vus').value ?? 0;
    const configuredCapacity = metricValues('vus_max').value || 0;
    const failedRate = metricValues('http_req_failed').rate || 0;
    const duration = metricValues('http_req_duration');
    const journeyFailed = metricValues('journey_failure_rate').rate || 0;
    const checks = metricValues('checks');

    const ms = (value) => (value === undefined ? 'n/d' : `${Math.round(value)} ms`);
    const pct = (value) => `${(100 * value).toFixed(2)}%`;
    const dur = data.state && data.state.testRunDurationMs ? Math.round(data.state.testRunDurationMs / 1000) : 0;

    const text = [
      '',
      '── resumen del harness de carga (detalle completo en summary.json) ──',
      `duración de la corrida: ${dur} s`,
      `pico de VUs observado (gauge vus): ${observedPeak} · capacidad configurada (vus_max): ${configuredCapacity}`,
      `sesiones completadas (journeys totales): ${iterations}`,
      `requests fallidas: ${pct(failedRate)}`,
      `http_req_duration p95: ${ms(duration['p(95)'])} · mediana: ${ms(duration.med)} · máx: ${ms(duration.max)}`,
      `journeys con algún paso fallido: ${pct(journeyFailed)}`,
      checks && checks.rate !== undefined ? `checks ok: ${pct(checks.rate)}` : 'checks: n/d',
      '──',
      '',
    ].join('\n');

    const payload = Object.assign({}, data, {
      sessions: {
        definition:
          'VUs = concurrent users at an instant; sessions = total authenticated journeys completed over the whole run (iterations)',
        vus_observed_peak: observedPeak,
        vus_configured_capacity: configuredCapacity,
        capacity_note:
          "k6's 'vus_max' metric is configured capacity, NOT observed concurrency; vus_observed_peak comes from the sampled 'vus' gauge (its max)",
        sessions_completed: iterations,
        identity_note:
          'the credential pool is bounded and reused across VUs: concurrent VUs are NOT the number of distinct identities',
      },
    });

    const resultsDir = __ENV.LOAD_RESULTS_DIR || '/results';
    return {
      stdout: text,
      [`${resultsDir}/summary.json`]: JSON.stringify(payload, null, 2),
    };
  };
}
