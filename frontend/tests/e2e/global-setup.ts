/**
 * Proves, once, that the e2e target is reachable AND is this application —
 * before a single spec runs.
 *
 * Without this the failure mode is silent rather than loud. A suite pointed at
 * nothing fails with a wall of timeouts that read like app bugs; a suite
 * pointed at the WRONG server can go green, because most of these specs stub
 * the BFF at the network level and assert on rendered markup, which some other
 * build of this app would happily produce. Neither outcome tells you the
 * target was wrong.
 *
 * The probe is `GET /api/auth/session`. It is this product's own BFF route, it
 * needs no credentials and no seeded data, and for a request with no cookies
 * its contract is a 200 with a JSON body — a contract the route-handler unit
 * tests already pin, so this check cannot drift away from the app on its own.
 * A static file server, a different product, or a stopped process all fail it.
 *
 * ## Hero image cache warm-up (issue #1300)
 *
 * Once the target is confirmed, this ALSO awaits `warmHeroImageCache` to
 * completion before returning. Playwright guarantees no worker starts, and
 * therefore no test can navigate anywhere, until `globalSetup` resolves — so
 * running the warm-up here, awaited, is what makes it deterministic rather
 * than a race against real test traffic. `src/instrumentation.ts` runs the
 * same warm-up fire-and-forget at server boot as defense-in-depth for real
 * deployments, but that copy alone is not enough for this suite: on CI's own
 * 4-worker concurrency it lost the race on the very first run, reproducing
 * the exact #1300 hang for the exact URL the original trace named. This
 * awaited copy cannot lose that race — nothing else is running yet.
 */

import { E2E_BASE_URL, E2E_SERVER_IS_MANAGED } from "./e2e-target";
import { warmHeroImageCache } from "../../src/lib/hero-image-cache-warmup";

/** How long to wait for the probe before calling the target absent. */
const PROBE_TIMEOUT_MS = 15_000;

/** The BFF route whose anonymous response identifies this app. */
const PROBE_PATH = "/api/auth/session";

function hint(): string {
  return E2E_SERVER_IS_MANAGED
    ? "The managed server should have been started by playwright.config.ts's `webServer` block; check its output above for a build or startup failure."
    : "PLAYWRIGHT_BASE_URL is set, so no server was started for you. Point it at a running instance of this app, or unset it to let the suite build and start its own.";
}

export default async function globalSetup(): Promise<void> {
  const target = `${E2E_BASE_URL}${PROBE_PATH}`;

  let response: Response;
  try {
    response = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(
      `e2e target is not answering at ${E2E_BASE_URL} (probed ${PROBE_PATH}). ${hint()}`,
      { cause },
    );
  }

  if (!response.ok) {
    throw new Error(
      `e2e target at ${E2E_BASE_URL} answered ${response.status} on ${PROBE_PATH}, ` +
        `but this app answers 200 there for an anonymous request. ` +
        `Something else is serving that address. ${hint()}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `e2e target at ${E2E_BASE_URL} returned "${contentType}" from ${PROBE_PATH} ` +
        `instead of JSON, so it is not this application. ${hint()}`,
    );
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("authenticated" in body)) {
    throw new Error(
      `e2e target at ${E2E_BASE_URL} answered ${PROBE_PATH} with a body this app ` +
        `never produces (no "authenticated" field). ${hint()}`,
    );
  }

  await warmHeroImageCache(E2E_BASE_URL);
}
