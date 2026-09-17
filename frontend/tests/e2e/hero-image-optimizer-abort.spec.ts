/**
 * Locks the mechanism behind issue #1300, against the server directly — no
 * browser involved, because the bug lives entirely in `/_next/image`'s
 * server-side request handling.
 *
 * ## The mechanism
 *
 * `/_next/image` shares one in-flight optimization promise per
 * `(href, width, quality)` cache key. The internal fetch that promise awaits
 * reuses the FIRST requester's own TCP socket to serve the file
 * (`next/dist/server/lib/mock-request.js`'s `createRequestResponseMocks`,
 * called from `fetchInternalImage`, passes `socket: _req.socket` — the real
 * socket — into the mocked response it streams the file onto). If that first
 * requester disconnects before the file finishes streaming — exactly what a
 * browser tab does when a Playwright test navigates away, and exactly what
 * any real visitor does by leaving the page — the socket the internal fetch
 * was reusing is already dead, `send` (the static-file streamer) never
 * reaches `finish` on it, and the shared promise never settles: every LATER
 * request for that same key hangs forever, not just the aborted one.
 *
 * ## Why this spec boots its OWN server (issue #1303 correction)
 *
 * An earlier version of this spec ran against the SHARED e2e server
 * (`E2E_BASE_URL`, warmed by `tests/e2e/global-setup.ts` before any spec
 * runs) and asked for a cache key (`q=91`) that warm-up never populates,
 * reasoning that an unwarmed KEY was enough to guarantee its own "aborted"
 * request was the first one that key ever saw. Measured directly, that
 * reasoning was incomplete: the abort race does not depend only on the
 * cache key being cold — it depends on how "hot" the `/_next/image` ROUTE
 * itself already is (JIT tiering, OS page-cache for the source file), from
 * ANY prior traffic, regardless of which key that traffic touched.
 *
 * Concretely, against an unpatched `next`, `node .next/standalone/server.js`,
 * `w=828`, `q=91`, a 2 ms abort, EVERY trial below already included the one
 * readiness `GET /` `bootIsolatedServer` issues before any test can run
 * (see `waitUntilReady`) — "no prior requests" below means no request
 * BEYOND that readiness probe:
 *   - No prior request beyond the readiness probe: never hung (5/5 clean
 *     trials).
 *   - After the suite's full ~27-request hero warm-up (which itself follows
 *     the same readiness probe): never hung, even though `q=91` itself was
 *     never touched by that warm-up (multiple trials, including through
 *     the actual shared e2e server).
 *   - After the readiness probe plus exactly ONE further small, unrelated
 *     priming request (e.g. `GET /api/auth/session`): hung reliably.
 *
 * So a spec that shares the suite's own fully-warmed server — the
 * configuration every real CI run and every real `pnpm exec playwright
 * test` invocation actually uses — cannot reproduce this bug at all: it
 * passes whether `next` is patched or not, proving nothing. The fix is to
 * give this ONE test its own isolated, cold copy of the exact standalone
 * build the suite already produced (see `bootIsolatedServer` below):
 * `HERO_WARMUP_DISABLED` set (so the copy's own `instrumentation.ts`
 * warm-up does not add competing traffic), the readiness probe
 * `bootIsolatedServer` needs anyway, one further priming request (the
 * condition measured above to reproduce the race reliably), then the
 * abort-then-identical-request sequence this file locks against — the
 * exact sequence the RED trial below reproduced 4/4 times. That makes the
 * test deterministic and independent of the shared server's warm state,
 * without touching the warm-up other specs still rely on.
 *
 * The request MUST send the same `Accept` header a real Chromium `<img>`
 * fetch sends: `/_next/image` folds the negotiated output format into its
 * cache key (`ImageOptimizerCache.getCacheKey` in
 * `next/dist/server/image-optimizer.js`), so a request with no `Accept`
 * header lands on a different key (served as JPEG) than the one a browser
 * actually reads (served as WebP) — this is exactly the gap that let the
 * #1300 hang survive an earlier version of the warm-up fix: it was warming
 * the JPEG key while every real request asked for the WebP one.
 */
import http from "node:http";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { createServer } from "node:net";
import { test, expect } from "@playwright/test";
import { HERO_WARMUP_DISABLE_TOKEN } from "../../src/lib/hero-warmup-disable-token";

/**
 * The photo and width issue #1300's own trace named, at `q=91` — one
 * integer outside the hero warm-up's only quality (`q=90`), so this exact
 * cache key is never pre-populated by `warmHeroImageCache`. Kept from the
 * earlier version of this spec: harmless now that the server itself is
 * isolated and cold, but it also means nothing else (a browser, another
 * spec) could ever have touched this exact key before this test does.
 */
const HERO_IMAGE_PATH = "/_next/image?url=%2Flanding%2Fhero-competition.jpg&w=828&q=91";

/** Same `Accept` header a real Chromium `<img>` request sends — see the
 *  file doc comment for why this changes the cache key entirely. */
const CHROMIUM_IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

/** Far under the original 15 s ceiling: a healthy cache-hit answers in tens
 *  of milliseconds, so this only needs enough room for CI's own load. */
const RESOLVE_WITHIN_MS = 5_000;

/**
 * How long the first request is left open before it is torn down. Swept
 * 0–30 ms against the isolated server described in the file doc comment;
 * 2 ms (the original manually-measured value) reproduced the hang
 * reliably once the server had answered the readiness probe and the one
 * priming request below — see `bootIsolatedServer`.
 */
const ABORT_AFTER_MS = 2;

/** A small, unrelated request that answers instantly and touches no image
 *  route — measured to be the difference between a server that reproduces
 *  the #1300 race and one that never does (see the file doc comment). */
const PRIMING_PATH = "/api/auth/session";

/** How long to wait for the isolated child server to start accepting
 *  connections before giving up. */
const SERVER_READY_TIMEOUT_MS = 30_000;

/** How long `stop()` waits for a graceful `SIGTERM` exit before escalating
 *  to `SIGKILL` — generous for a loopback Node process with nothing else
 *  to flush, but bounded so a stuck child never hangs the test run. */
const GRACEFUL_STOP_TIMEOUT_MS = 3_000;

/** Caps how much of the isolated child's stderr this spec retains for
 *  failure diagnostics — enough to show a real crash, not enough to leak
 *  an unbounded log if the child is unexpectedly chatty. */
const STDERR_TAIL_LIMIT = 4_000;

function get(baseUrl: string, path: string, options: { abortAfterMs?: number } = {}): Promise<{ settled: boolean; status?: number }> {
  const url = new URL(path, baseUrl);
  return new Promise((resolveGet) => {
    const req = http.get(url, { headers: { accept: CHROMIUM_IMAGE_ACCEPT } }, (res) => {
      res.resume();
      res.on("end", () => resolveGet({ settled: true, status: res.statusCode }));
    });
    req.on("error", () => resolveGet({ settled: true }));
    if (options.abortAfterMs !== undefined) {
      setTimeout(() => req.destroy(), options.abortAfterMs);
    }
  });
}

/** Polls `GET /` until it answers (any status) or the timeout elapses. This
 *  IS a real request the isolated server serves — see the file doc comment
 *  for why "no prior requests" in the RED/GREEN evidence always means "none
 *  beyond this one". */
async function waitUntilReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolveProbe, rejectProbe) => {
        const req = http.get(baseUrl, () => resolveProbe());
        req.on("error", rejectProbe);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`isolated server at ${baseUrl} never answered within ${SERVER_READY_TIMEOUT_MS}ms`);
}

/** An OS-assigned free TCP port on the loopback interface. */
async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address && typeof address === "object") {
        const port = address.port;
        probe.close(() => resolvePort(port));
      } else {
        probe.close();
        rejectPort(new Error("could not determine a free port"));
      }
    });
  });
}

/**
 * Boots a throwaway, cold copy of the exact `.next/standalone` build the
 * suite already produced (CI's "Prepare standalone" step, or this repo's
 * own `pnpm build` + copy, both of which run before Playwright starts a
 * single worker — see `playwright.config.ts`).
 *
 * The copy uses GNU `cp -al` (hardlinks, not a real data copy — instant
 * regardless of `node_modules` size) so booting it costs nothing, then
 * deletes `.next/cache` from the COPY ONLY: hardlinks make a `rm -rf` on
 * one copy's directory entries never touch the other copy's, so this is
 * safe even if the SHARED server (used by every other spec) has already
 * warmed its own cache by the time this runs. By the time this function
 * resolves, the server has served exactly one request — the readiness
 * probe (`waitUntilReady`) — which is the "no prior requests beyond the
 * readiness probe" condition the file doc comment measured, and the one
 * condition the shared, pre-warmed e2e server can never offer.
 */
async function bootIsolatedServer(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const standaloneDir = resolvePath(process.cwd(), ".next/standalone");
  if (!existsSync(standaloneDir)) {
    throw new Error(
      `${standaloneDir} does not exist — this spec needs the standalone build ` +
        `Playwright's own webServer (or CI's "Prepare standalone" step) already produces, ` +
        `and expects to run from the frontend/ directory (process.cwd() was ${process.cwd()}).`,
    );
  }

  // Scratch dir lives NEXT TO the standalone build (inside `.next/`, already
  // gitignored), not under the OS tmpdir: `cp -al`'s hardlinks fail with
  // "cross-device link" the moment the scratch dir sits on a different
  // filesystem/mount than the source, which `/tmp` often is (tmpfs, a
  // separate volume, ...) relative to the checkout.
  const workDir = await mkdtemp(join(dirname(standaloneDir), "hero-abort-"));
  const isolatedDir = join(workDir, "standalone");
  execFileSync("cp", ["-al", standaloneDir, isolatedDir]);
  await rm(join(isolatedDir, ".next", "cache"), { recursive: true, force: true });

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child: ChildProcess = spawn("node", ["server.js"], {
    cwd: isolatedDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      HERO_WARMUP_DISABLED: HERO_WARMUP_DISABLE_TOKEN,
    },
    // stdout is unused noise; stderr is captured below (bounded) so a boot
    // or readiness failure can show the child's own error instead of just
    // "never answered". Neither stream is left unread — an unread "pipe"
    // can fill its OS buffer and block the child's own writes.
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
  });

  // Without a listener, an 'error' event (e.g. `node` missing from PATH)
  // would throw and crash the whole Playwright worker instead of failing
  // just this test with a readable message.
  let spawnError: Error | undefined;
  child.on("error", (error: Error) => {
    spawnError = error;
  });

  // Created once, right after spawn, so it is already listening no matter
  // when `stop()` is actually called — never re-registered later, which
  // would risk attaching a fresh `once('exit', ...)` AFTER the event had
  // already fired and been missed.
  const exited = new Promise<void>((resolveExit) => {
    child.once("exit", () => resolveExit());
  });

  const stop = async (): Promise<void> => {
    child.kill("SIGTERM");
    const exitedGracefully = await Promise.race([
      exited.then(() => true as const),
      new Promise<false>((r) => setTimeout(() => r(false), GRACEFUL_STOP_TIMEOUT_MS)),
    ]);
    if (!exitedGracefully) {
      // SIGTERM did not land in time — escalate. `exited` is the same
      // promise as above: if the process exits between the timeout above
      // and this line, it is already resolved and this awaits instantly.
      child.kill("SIGKILL");
      await exited;
    }
    // Only remove the scratch directory once the child is confirmed gone —
    // removing it while the process might still be alive risks pulling
    // the standalone build (and its cache) out from under a live server.
    await rm(workDir, { recursive: true, force: true });
  };

  try {
    await waitUntilReady(baseUrl);
  } catch (error) {
    await stop();
    const diagnostics = [
      spawnError ? `spawn error: ${spawnError.message}` : undefined,
      stderrTail ? `isolated server stderr:\n${stderrTail}` : undefined,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");
    throw new Error(
      `isolated server never became ready${diagnostics ? `\n${diagnostics}` : ""}`,
      { cause: error },
    );
  }

  return { baseUrl, stop };
}

test.describe("hero image optimizer survives an aborted first request (issue #1300)", () => {
  let server: { baseUrl: string; stop: () => Promise<void> } | undefined;

  test.beforeAll(async () => {
    server = await bootIsolatedServer();
    // The priming request measured necessary to reproduce the race — see
    // the file doc comment. It touches no image route and answers
    // instantly either way.
    await get(server.baseUrl, PRIMING_PATH);
  });

  test.afterAll(async () => {
    // Optional: `beforeAll` can fail before `server` is ever assigned
    // (missing standalone dir, `cp` failure, readiness timeout) — in that
    // case there is nothing to stop, and this must not mask that failure
    // behind a `TypeError: Cannot read properties of undefined`.
    await server?.stop();
  });

  test("a request identical to one that was just aborted still resolves", async () => {
    const baseUrl = server!.baseUrl;

    // The abort itself: this request is intentionally torn down mid-flight,
    // the same way a browser tab does when a test navigates away from it.
    const aborted = get(baseUrl, HERO_IMAGE_PATH, { abortAfterMs: ABORT_AFTER_MS });

    // The regression: another request for the IDENTICAL cache key, sent
    // right after. On the buggy server this is the one that hangs.
    const second = get(baseUrl, HERO_IMAGE_PATH);

    await aborted;

    const outcome = await Promise.race([
      second.then((result) => ({ ...result, timedOut: false as const })),
      new Promise<{ timedOut: true }>((resolvePromise) => setTimeout(() => resolvePromise({ timedOut: true }), RESOLVE_WITHIN_MS)),
    ]);

    expect(outcome.timedOut, `the second request for ${HERO_IMAGE_PATH} never resolved within ${RESOLVE_WITHIN_MS}ms after the first was aborted — the #1300 hang reproduced`).toBe(false);
    if (!outcome.timedOut) {
      expect(outcome.status).toBe(200);
    }
  });
});
