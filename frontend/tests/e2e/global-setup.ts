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
 */

import { E2E_BASE_URL, E2E_SERVER_IS_MANAGED } from "./e2e-target";

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
}
