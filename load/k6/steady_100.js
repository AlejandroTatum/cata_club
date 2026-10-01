/**
 * Steady state: N concurrent VUs (default 100; LOAD_STEADY_VUS, e.g. 30 via
 * `make load-steady VUS=30`) walking the authenticated read journey.
 *
 * 100 VUs = 100 users holding the journey AT AN INSTANT (peak concurrency).
 * Over a 10-minute run that completes many more than 100 SESSIONS (journeys);
 * handleSummary reports both numbers separately so they are never conflated.
 *
 * Provisional acceptance (odd/tasks/100-user-load-test.md, calibrated against
 * the 1-VU baseline) evaluates ONLY the 10-minute PLATEAU — requests are
 * phase-tagged (warmup/plateau/rampdown) and the thresholds bind to the
 * {phase:plateau} sub-metrics:
 *   - failed requests < 1%      (`rate<0.01`, plateau only)
 *   - p95 < 800 ms              (`p(95)<800`, plateau only)
 * Provisional aborts (stop the run, do not iterate into damage):
 *   - error rate >= 5%          (`rate<0.05`, abortOnFail)
 *   - p95 >= 3 s                (`p(95)<3000`, abortOnFail)
 * k6's abortOnFail evaluates the run-so-far AGGREGATE at threshold-eval time
 * (delayAbortEval only postpones the first evaluation) — this is documented
 * behavior, not a sliding-window abort. Resource-side aborts (container
 * restart/OOM, DB pool exhaustion, outbox backlog) are enforced by the HOST
 * monitor during the run — see scripts/load/monitor_resources.sh.
 */

import exec from 'k6/execution';

import {
  BASE_URL,
  assertLocalBaseUrl,
  asegurarPoolSuficiente,
  authenticatedReadJourney,
  buildHandleSummary,
  credentialForVU,
  loadCredentials,
} from './common.js';

// Deterministic phase clock: the scenario schedule is known (3 m warm-up,
// then the LOAD_STEADY_DURATION plateau, then ramp-down), so each request is
// tagged warmup/plateau/rampdown from exec.scenario.startTime. Acceptance
// thresholds bind ONLY to the {phase:plateau} sub-metrics; the global abort
// thresholds keep covering the WHOLE run.
const MS_WARMUP = 3 * 60 * 1000;

function duracionMs(texto) {
  const m = /^(\d+)([smh])$/.exec(String(texto).trim());
  if (!m) throw new Error(`LOAD_STEADY_DURATION inválida: '${texto}'`);
  return Number(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2]];
}

// Configurable concurrency: default 100 (the original acceptance run); a
// smaller realistic load (e.g. 30) is `LOAD_STEADY_VUS=30`. The acceptance
// thresholds and aborts below do not change with the VU count.
const VUS_STEADY = Number(__ENV.LOAD_STEADY_VUS || 100);
if (!Number.isInteger(VUS_STEADY) || VUS_STEADY < 1) {
  throw new Error(`LOAD_STEADY_VUS inválida: '${__ENV.LOAD_STEADY_VUS}' (entero >= 1)`);
}

const MS_PLATO = duracionMs(__ENV.LOAD_STEADY_DURATION || '10m');

export function faseActual() {
  const transcurrido = Date.now() - exec.scenario.startTime;
  if (transcurrido < MS_WARMUP) return 'warmup';
  if (transcurrido < MS_WARMUP + MS_PLATO) return 'plateau';
  return 'rampdown';
}

export const options = {
  scenarios: {
    steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // Warm-up (NOT part of the plateau evidence): 0 → VUS_STEADY over
        // 3 minutes (100 VUs ≈ 33 new logins/min), under the backend's 60/min/IP
        // login cap (auth_router.py:43) — every VU shares one IP and each
        // logs in exactly once (per-VU session cache).
        { duration: '3m', target: VUS_STEADY },
        // Plateau: the actual 10-minute measurement window at full load.
        { duration: __ENV.LOAD_STEADY_DURATION || '10m', target: VUS_STEADY },
        // Ramp-down: release VUs instead of cutting them mid-journey.
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Acceptance — PLATEAU ONLY (<1% / p95 < 800 ms): bound to the
    // {phase:plateau} sub-metrics so the 3 m warm-up and ramp-down never
    // dilute or poison the capacity verdict.
    'http_req_failed{phase:plateau}': [{ threshold: 'rate<0.01' }],
    'http_req_duration{phase:plateau}': [{ threshold: 'p(95)<800' }],
    'journey_failure_rate{phase:plateau}': [{ threshold: 'rate<0.01' }],
    // Safety aborts — GLOBAL, whole run including warm-up and ramp-down.
    'http_req_failed': [
      { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '10s' },
    ],
    'http_req_duration': [
      { threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '30s' },
    ],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export function setup() {
  assertLocalBaseUrl(BASE_URL);
  const pool = loadCredentials();
  // Fail-closed (review correction): capacity claims need 1 identity per VU.
  asegurarPoolSuficiente(pool, VUS_STEADY, 'steady_100');
  return { pool };
}

export default function (data) {
  authenticatedReadJourney(credentialForVU(__VU, data.pool), { phase: faseActual() });
}

export const handleSummary = buildHandleSummary();
