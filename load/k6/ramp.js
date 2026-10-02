/**
 * Ramp: grow the VU count stepwise to find the knee where latency or errors
 * start to degrade. Diagnostic by design: it carries the abort thresholds,
 * not the steady acceptance bar.
 *
 * Reading it honestly: k6 aggregates its trends over the whole run, so the
 * knee is read from the monitor's per-interval samples
 * (resources.jsonl) alongside the per-step arrival shape — or from the raw
 * per-request JSON stream when LOAD_K6_JSON=1 (see
 * docs/operations/load-testing.md). This script reports the coarse shape,
 * not per-step percentiles.
 */

import {
  BASE_URL,
  assertLocalBaseUrl,
  asegurarPoolSuficiente,
  authenticatedReadJourney,
  buildHandleSummary,
  credentialForVU,
  loadCredentials,
} from './common.js';

const maxVus = Number(__ENV.LOAD_RAMP_MAX_VUS || 100);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      // 0 → maxVus in >= 3 minutes: at most ~33 NEW logins per minute, under
      // the backend's 60/min/IP login cap (auth_router.py:43) — every VU
      // shares one IP and each logs in exactly once (per-VU session cache).
      stages: [
        { duration: '3m', target: maxVus },
        { duration: '1m', target: maxVus },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Abort-only (provisional tracker values): abort when error rate reaches
    // 5% or p95 reaches 3 s. k6 thresholds are PASS conditions: abortOnFail
    // fires when the expression turns false, over the run-so-far aggregate.
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
  // The ramp makes capacity claims: one identity per target VU, no sharing.
  asegurarPoolSuficiente(pool, maxVus, 'ramp');
  return { pool };
}

export default function (data) {
  authenticatedReadJourney(credentialForVU(__VU, data.pool));
}

export const handleSummary = buildHandleSummary();
