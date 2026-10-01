/**
 * Baseline: exactly ONE virtual user walking the authenticated read journey.
 *
 * This is the calibration input for the provisional thresholds: judge the
 * 100-VU steady run against what a single user actually experiences here
 * (recorded per docs/operations/load-testing.md and
 * odd/tasks/100-user-load-test.md). It carries the abort thresholds only —
 * no acceptance thresholds, because its job is to measure headroom, not to
 * pass a bar.
 */

import http from 'k6/http';
import {
  BASE_URL,
  assertLocalBaseUrl,
  authenticatedReadJourney,
  buildHandleSummary,
  credentialForVU,
  loadCredentials,
} from './common.js';

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 1,
      duration: __ENV.LOAD_BASELINE_DURATION || '3m',
    },
  },
  thresholds: {
    // Abort-only (provisional tracker values): abort when the error rate
    // reaches 5% or p95 reaches 3 s. k6 thresholds are PASS conditions:
    // abortOnFail fires when the expression turns false — evaluated over the
    // run-so-far aggregate (delayAbortEval only postpones the FIRST check).
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
  // Belt and braces: common.js already guards at init; this also covers
  // direct edits that remove the init guard.
  assertLocalBaseUrl(BASE_URL);
  return { pool: loadCredentials() };
}

export default function (data) {
  authenticatedReadJourney(credentialForVU(__VU, data.pool));
}

export const handleSummary = buildHandleSummary();
