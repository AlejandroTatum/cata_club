/**
 * The one place that decides WHICH server the e2e suite talks to.
 *
 * ## The failure this replaces
 *
 * `playwright.config.ts` and three specs each carried their own
 * `process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"`. Port 3000 is
 * also where `next start` lands by default, so any long-lived server a
 * developer left running — including builds that predate the branch under
 * test — was adopted by `reuseExistingServer` and the whole suite ran, and
 * PASSED, against week-old code. Nothing in the output said so.
 *
 * Two changes close that:
 *
 *   1. The default target is a port nothing else on this machine claims.
 *      `next dev` (3000) and its fallbacks (3001, 3002…) cannot collide with
 *      it, so "whatever happens to be running" is never the target.
 *   2. `reuseExistingServer` is off in `playwright.config.ts`. The suite
 *      starts the build it is meant to test or it fails; it never inherits a
 *      stranger's process. If something IS squatting on the port, Playwright
 *      reports the conflict instead of quietly using it.
 *
 * `global-setup.ts` then proves the target is this app before any test runs,
 * so an absent or wrong server fails loudly and once, rather than as a wall of
 * confusing assertion errors — or, worse, as a green run against another
 * build.
 *
 * ## Overriding
 *
 * `PLAYWRIGHT_BASE_URL` still points the suite at an already-running server
 * (a preview deploy, a container). Setting it is an explicit, visible choice,
 * and it suppresses the managed `webServer` entirely — Playwright will not
 * start a second server behind your back. `PLAYWRIGHT_E2E_PORT` moves only the
 * managed server's port.
 */

/**
 * The port the managed server is started on and the default target.
 *
 * Deliberately outside the 3000-3010 band Next's dev server walks when its
 * preferred port is taken.
 */
export const E2E_PORT = Number.parseInt(process.env.PLAYWRIGHT_E2E_PORT ?? "3390", 10);

/**
 * `127.0.0.1`, not `localhost`: on a dual-stack host `localhost` can resolve
 * to `::1` while the server listens on IPv4 only, which reads as "connection
 * refused" for reasons that have nothing to do with the app.
 */
export const E2E_MANAGED_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/** An external target the operator asked for, or `undefined`. */
export const E2E_EXTERNAL_BASE_URL: string | undefined =
  process.env.PLAYWRIGHT_BASE_URL?.trim() || undefined;

/** The URL every spec and the config resolve against. */
export const E2E_BASE_URL: string = E2E_EXTERNAL_BASE_URL ?? E2E_MANAGED_BASE_URL;

/** True when the suite is responsible for starting (and stopping) the server. */
export const E2E_SERVER_IS_MANAGED = E2E_EXTERNAL_BASE_URL === undefined;

if (!Number.isInteger(E2E_PORT) || E2E_PORT < 1 || E2E_PORT > 65535) {
  throw new Error(
    `PLAYWRIGHT_E2E_PORT must be a port number, got "${process.env.PLAYWRIGHT_E2E_PORT}".`,
  );
}
