/**
 * #644 — the assistant panel on a phone, measured in a real browser.
 *
 * ## Why this file exists at all
 *
 * `ChatWidget.test.tsx` covers the same contract, and for two of its clauses
 * that coverage is worth very little on its own:
 *
 *   · jsdom has no layout. "The close control is a 44px touch target" and "the
 *     sheet fills the visual viewport" are assertions about class names there,
 *     and a class name is a request, not a box. Here they are `getBoundingClientRect`.
 *   · jsdom does not move focus when a key is pressed. A focus-trap test can
 *     therefore be green against a component with no trap in it — this repo has
 *     been bitten by exactly that with native `<dialog>`, which jsdom stubs to
 *     an `open` attribute and nothing else. Here Tab is a real Tab, delivered
 *     by the browser's own focus manager.
 *
 * ## What is still simulated, and why it has to be
 *
 * A headless browser has no virtual keyboard. What a virtual keyboard IS to a
 * web page, though, is fully specified: `visualViewport.height` shrinks and a
 * `resize` fires on it. That is reproduced here on the real `VisualViewport`
 * object, and the panel's real listener answers it. The keyboard is simulated;
 * the component's response to it is not.
 *
 * `/login` is the host page because it is light, needs no session, and is an
 * `auth` shell — so the launcher floats there at every width (see
 * `HelpChatDock`'s note on where the rail carries the assistant instead).
 */

import { expect, test, type Page } from "@playwright/test";

const LAUNCHER = /Abrir CATA-BOT/i;
const CLOSE = /Cerrar CATA-BOT/i;
const COMPOSER = /Mensaje para CATA-BOT/i;
const SEND = /Enviar mensaje/i;

/** The panel, addressed the way a screen reader finds it. */
const PANEL = 'div[role="dialog"][aria-label*="CATA-BOT"]';

interface SheetMetrics {
  panel: { top: number; left: number; width: number; height: number };
  visual: { top: number; height: number; width: number };
  /** Distance from the composer's bottom edge to the foot of the visible area. */
  composerSlack: number;
  /** True when the panel itself scrolls — it must not; the history does. */
  panelScrolls: boolean;
  historyOverflowY: string;
  bodyOverflow: string;
  close: { width: number; height: number };
  ariaModal: string | null;
}

/** Everything the sheet contract turns on, read in one round trip. */
const READ_METRICS = (panelSelector: string): SheetMetrics => {
  const panel = document.querySelector(panelSelector) as HTMLElement;
  const rect = panel.getBoundingClientRect();
  const viewport = window.visualViewport;
  const form = panel.querySelector("form") as HTMLElement;
  const history = panel.querySelector(".overflow-y-auto") as HTMLElement;
  const close = panel.querySelector('button[aria-label*="Cerrar"]') as HTMLElement;
  const closeRect = close.getBoundingClientRect();
  const visualHeight = viewport?.height ?? window.innerHeight;

  return {
    panel: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    visual: { top: viewport?.offsetTop ?? 0, height: visualHeight, width: viewport?.width ?? window.innerWidth },
    composerSlack: visualHeight - form.getBoundingClientRect().bottom,
    panelScrolls: panel.scrollHeight > panel.clientHeight,
    historyOverflowY: getComputedStyle(history).overflowY,
    bodyOverflow: getComputedStyle(document.body).overflow,
    close: { width: closeRect.width, height: closeRect.height },
    ariaModal: panel.getAttribute("aria-modal"),
  };
};

/** The `aria-label` of whatever the browser says is focused right now. */
const ACTIVE_LABEL = (): string =>
  document.activeElement?.getAttribute("aria-label") ??
  document.activeElement?.tagName.toLowerCase() ??
  "none";

async function openPanel(page: Page): Promise<void> {
  const launcher = page.getByRole("button", { name: LAUNCHER });
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  await launcher.click();
  await expect(page.locator(PANEL)).toBeVisible();
}

/**
 * Shrink the visual viewport the way a virtual keyboard does, on the real
 * `VisualViewport` object, and fire the event the platform fires.
 */
async function raiseKeyboard(page: Page, visibleHeight: number): Promise<void> {
  await page.evaluate((height: number): void => {
    const viewport = window.visualViewport as VisualViewport;
    Object.defineProperty(viewport, "height", { configurable: true, get: (): number => height });
    viewport.dispatchEvent(new Event("resize"));
  }, visibleHeight);
  await page.waitForTimeout(120);
}

const PHONES = [
  { width: 390, height: 844, label: "390x844" },
  { width: 320, height: 568, label: "320x568 — narrower than the issue asked for" },
  { width: 844, height: 390, label: "844x390 — the same phone on its side" },
] as const;

/**
 * Every phone case runs with touch emulation on, and that is load-bearing
 * rather than decoration. `SHEET_MEDIA_QUERY`'s landscape clause is gated on
 * `pointer: coarse` so a desktop window dragged short never becomes a sheet,
 * and Playwright's default `Desktop Chrome` reports `pointer: fine` — without
 * `hasTouch` the 844x390 case is a DESKTOP 844x390, and it correctly gets the
 * corner card. That distinction is asserted from the other side further down.
 */
test.describe("on a touch device", () => {
  test.use({ hasTouch: true });

  for (const phone of PHONES) {
    test(`the panel is a sheet inside the visual viewport at ${phone.label}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await page.goto("/login");
      await openPanel(page);

      const metrics = await page.evaluate(READ_METRICS, PANEL);
      await testInfo.attach(`sheet-${phone.width}x${phone.height}`, {
        body: JSON.stringify(metrics, null, 2),
        contentType: "application/json",
      });

      // Inside the VISUAL viewport, which is the whole point: `100vh` would be
      // the layout viewport and would hang below the fold on a real phone.
      expect(metrics.panel.top).toBeCloseTo(metrics.visual.top, 0);
      expect(metrics.panel.height).toBeCloseTo(metrics.visual.height, 0);
      expect(metrics.panel.left).toBe(0);
      expect(metrics.panel.width).toBe(phone.width);
      // Full-bleed from the top of the visible area is not something the
      // corner card can be at any width: it is inset 12px from the right and
      // capped at 72vh, so `left === 0` and a full-height match rule it out.
      // (Asserting "wider than 340" would not — at 320 the sheet is 320.)

      // The composer is on screen, and the history is what scrolls.
      expect(metrics.composerSlack).toBeGreaterThanOrEqual(0);
      expect(metrics.panelScrolls).toBe(false);
      expect(metrics.historyOverflowY).toBe("auto");

      // A 44px touch target, and the page held still behind it.
      expect(metrics.close.width).toBeGreaterThanOrEqual(44);
      expect(metrics.close.height).toBeGreaterThanOrEqual(44);
      expect(metrics.bodyOverflow).toBe("hidden");
      expect(metrics.ariaModal).toBe("true");
    });
  }
});

/**
 * #873 (light panel) / #1007 (dark panel) — rendered surface colours on the
 * sheet, measured in a real browser instead of read off a class name.
 *
 * `ChatWidget.test.tsx` and `chat-contrast.test.tsx` already prove the
 * CLASSES and the maths; this is the one place that proves the cascade
 * actually paints them — Tailwind's build step, `globals.css`'s `.card` rule
 * and any later override all sit between a class name and a pixel, and none
 * of them are exercised in jsdom.
 */
test("the sheet paints the coal ladder, not a white-on-white stack", async ({ page }) => {
  // No `hasTouch` needed here: at 390px the media query's WIDTH clause alone
  // selects the sheet, regardless of pointer type — the `pointer: coarse`
  // gate only matters for the landscape clause (see the file header).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await openPanel(page);

  const colors = await page.evaluate((panelSelector: string) => {
    const panel = document.querySelector(panelSelector) as HTMLElement;
    const header = panel.querySelector("header") as HTMLElement;
    const form = panel.querySelector("form") as HTMLElement;
    const history = panel.querySelector(".overflow-y-auto") as HTMLElement;
    return {
      header: getComputedStyle(header).backgroundColor,
      form: getComputedStyle(form).backgroundColor,
      history: getComputedStyle(history).backgroundColor,
    };
  }, PANEL);

  // #1007 — coal-2 for the header and composer (they share the same inset
  // step on purpose), coal for the history underneath them. Two fills, not
  // three, and neither is white.
  expect(colors.header).toBe("rgb(28, 28, 33)");
  expect(colors.history).toBe("rgb(19, 19, 22)");
  expect(colors.form).toBe("rgb(28, 28, 33)");
  expect(colors.header).toBe(colors.form);
  expect(colors.header).not.toBe(colors.history);
  expect(Object.values(colors)).not.toContain("rgb(255, 255, 255)");
});

test("the floating launcher paints coal, never white, before the panel opens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");

  const launcher = page.getByRole("button", { name: LAUNCHER });
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  const fill = await launcher.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor);
  expect(fill).toBe("rgb(19, 19, 22)");
});

/**
 * The other side of the `pointer: coarse` gate: the same 844x390 box, on a
 * machine with a mouse. Without this the landscape clause could be widened to
 * every short window and both suites would stay green.
 */
test("a short DESKTOP window keeps the corner card, mouse and all", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/login");
  await openPanel(page);

  const metrics = await page.evaluate(READ_METRICS, PANEL);
  expect(metrics.panel.width).toBe(340);
  expect(metrics.panel.left).toBeGreaterThan(0);
  expect(metrics.ariaModal).toBe("false");
  expect(metrics.bodyOverflow).not.toBe("hidden");
});

test("the sheet follows the visual viewport when the keyboard opens, and back", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await openPanel(page);

  const before = await page.evaluate(READ_METRICS, PANEL);
  expect(before.panel.height).toBeCloseTo(844, 0);

  // 444px of keys: the visible area is 400px tall and the sheet has to be too,
  // or the composer is under them — which is the complaint in #644.
  await raiseKeyboard(page, 400);
  const typing = await page.evaluate(READ_METRICS, PANEL);

  await testInfo.attach("keyboard-390x844", {
    body: JSON.stringify({ before, typing }, null, 2),
    contentType: "application/json",
  });

  expect(typing.panel.height).toBeCloseTo(400, 0);
  expect(typing.composerSlack).toBeGreaterThanOrEqual(0);
  // Still one scrolling region, and still the history.
  expect(typing.panelScrolls).toBe(false);
  expect(typing.historyOverflowY).toBe("auto");

  // And it gives the space back when the keyboard goes away.
  await raiseKeyboard(page, 844);
  expect((await page.evaluate(READ_METRICS, PANEL)).panel.height).toBeCloseTo(844, 0);
});

test("the history scrolls on its own while the sheet and the page do not", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A long answer, so the history outgrows its own box with three turns.
  await page.route("**/api/chatbot", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reply: "Respuesta larga. ".repeat(60) }),
    }),
  );
  await page.goto("/login");
  await openPanel(page);

  for (const question of ["uno", "dos", "tres"]) {
    await page.getByLabel(COMPOSER).fill(question);
    await page.getByRole("button", { name: SEND }).click();
    await expect(page.locator(`${PANEL} p[data-rol="asistente"]`).last()).toBeVisible();
  }

  const scrolling = await page.evaluate((selector: string) => {
    const panel = document.querySelector(selector) as HTMLElement;
    const history = panel.querySelector(".overflow-y-auto") as HTMLElement;
    history.scrollTop = 0;
    return {
      historyOverflows: history.scrollHeight > history.clientHeight,
      panelOverflows: panel.scrollHeight > panel.clientHeight,
      documentOverflows: document.documentElement.scrollHeight > window.innerHeight,
      scrolledTo: ((): number => {
        history.scrollTop = 40;
        return history.scrollTop;
      })(),
      pageOffset: window.scrollY,
    };
  }, PANEL);

  expect(scrolling.historyOverflows).toBe(true);
  expect(scrolling.scrolledTo).toBe(40);
  // The overflow lives in exactly one place. If the panel or the document had
  // grown instead, the composer would be somewhere below the fold.
  expect(scrolling.panelOverflows).toBe(false);
  expect(scrolling.pageOffset).toBe(0);
});

test("focus is trapped in the sheet and handed back to the launcher on close", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await openPanel(page);

  // A draft, so the send button is enabled and is therefore the LAST stop in
  // the tab order — a trap tested against a disabled last element proves less.
  await page.getByLabel(COMPOSER).fill("hola");

  const travel: string[] = [];
  await page.getByRole("button", { name: SEND }).focus();
  travel.push(await page.evaluate(ACTIVE_LABEL));

  // Forward off the last control must wrap to the first.
  await page.keyboard.press("Tab");
  travel.push(await page.evaluate(ACTIVE_LABEL));

  // Backward off the first must wrap to the last — a DIFFERENT control. Both
  // directions landing on the same element is exactly how a handler that never
  // reads `shiftKey` passes a trap test.
  await page.keyboard.press("Shift+Tab");
  travel.push(await page.evaluate(ACTIVE_LABEL));

  await testInfo.attach("focus-travel", { body: travel.join(" -> "), contentType: "text/plain" });

  expect(travel[0]).toMatch(SEND);
  expect(travel[1]).toMatch(CLOSE);
  expect(travel[2]).toMatch(SEND);
  expect(travel[1]).not.toBe(travel[2]);

  // Closing returns the caret to the control that opened the panel, rather
  // than dropping it on <body> and sending the next Tab to the top of the page.
  await page.getByRole("button", { name: CLOSE }).click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  expect(await page.evaluate(ACTIVE_LABEL)).toMatch(LAUNCHER);
});

test("Tab inside the sheet never reaches the page behind it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await openPanel(page);
  await page.getByLabel(COMPOSER).fill("hola");

  // More presses than the panel has focusable controls: if the trap leaks, one
  // of these lands on the login form and the label stops belonging to CATA-BOT.
  const visited: string[] = [];
  for (let step = 0; step < 14; step += 1) {
    await page.keyboard.press("Tab");
    visited.push(
      await page.evaluate((selector: string) => {
        const panel = document.querySelector(selector);
        const active = document.activeElement;
        return panel && active && panel.contains(active) ? "inside" : "ESCAPED";
      }, PANEL),
    );
  }

  expect(new Set(visited)).toEqual(new Set(["inside"]));
});

/**
 * #725 — the sheet's close control, on the one page that has a sticky navbar.
 *
 * ## Why this test is hosted on `/` and every test above is not
 *
 * That difference IS the bug. Every case above proves the sheet on `/login`,
 * which is an `auth` shell: nothing there is `position: sticky`, so nothing
 * ever competed with the sheet for the top of the screen and the whole suite
 * stayed green while the control was completely dead on the landing. A modal's
 * geometry measured only where nothing can cover it is geometry measured in the
 * one place the question cannot come up.
 *
 * ## Why `elementFromPoint` over the whole button and not `toBeVisible()`
 *
 * `toBeVisible()` was already true with the defect live — the sheet painted, the
 * button was in the tab order and had its 44px box. What it did not have was a
 * single pixel that answered a tap: measured in WebKit at 390x844 against
 * `main` @ 149c5c9, the landing navbar (`z-index: 50`, and 179px tall once its
 * links wrap onto a phone) covered all 1936 pixels of a `z-40` sheet's close
 * button. So this sweeps every pixel of the control rather than probing its
 * centre — a fix that uncovered only the middle would be a fix that leaves the
 * edges dead, and `launcher-occlusion.spec.ts` states the house rule this
 * borrows: no out-of-flow element may own the point a click lands on.
 *
 * ## Why the tap is asserted separately from the hit test
 *
 * Hit-testing and dispatch can disagree, and the failure mode here was not
 * "nothing happens" — the tap landed on the navbar's "ENTRAR" CTA and NAVIGATED
 * the visitor to `/login` with the sheet still open on top. The URL assertion
 * is what would catch that specific regression coming back; a `toHaveCount(0)`
 * on its own would not distinguish "closed" from "navigated away".
 *
 * ## Why this has to be a browser test at all
 *
 * There is no Escape key on a phone, and the sheet offers nothing else: it
 * covers the viewport exactly so there is no backdrop, the component listens
 * for no swipe, opening it pushes no history entry so hardware back leaves the
 * site, and the launcher is `pointer-events: none` while it is up. The close
 * button is the only exit, which is why "is it reachable" is worth a lock.
 *
 * One `goto`, two viewports: the landing is the heaviest page in the app and CI
 * runs four workers on four vCPU, so the second case resizes rather than
 * reloading.
 */
test.describe("the assistant sheet on the landing", () => {
  test.use({ hasTouch: true });

  test("its close control is tappable, and the navbar does not own the tap", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const report: unknown[] = [];

    for (const phone of [
      { width: 390, height: 844, label: "390x844 portrait" },
      { width: 844, height: 390, label: "844x390 landscape" },
    ]) {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await openPanel(page);

      const close = page.getByRole("button", { name: CLOSE });
      const box = await close.boundingBox();
      if (!box) throw new Error(`no box for the close control at ${phone.label}`);

      // Every pixel of the control, asked of the browser's own hit test.
      const occlusion = await page.evaluate(() => {
        const button = document.querySelector(
          'div[role="dialog"][aria-label*="CATA-BOT"] button[aria-label*="Cerrar"]',
        ) as HTMLElement;
        const rect = button.getBoundingClientRect();
        let live = 0;
        const blockers = new Set<string>();
        for (let y = Math.ceil(rect.top); y < rect.bottom; y += 1) {
          for (let x = Math.ceil(rect.left); x < rect.right; x += 1) {
            const hit = document.elementFromPoint(x, y);
            if (hit === button || button.contains(hit)) {
              live += 1;
            } else if (hit && !hit.contains(button)) {
              // An ANCESTOR answering is not occlusion — the button's own
              // `<header>` wins the fringe pixels where the 44px box lands on a
              // fraction, and a parent cannot paint over its own child. Only
              // something outside the button's own line of descent is a cover.
              const owner = hit.closest("a,button,nav") ?? hit;
              blockers.add(
                owner.tagName.toLowerCase() +
                  (owner.className ? `.${String(owner.className).split(" ")[0]}` : ""),
              );
            }
          }
        }
        return {
          live,
          total: Math.round(rect.width) * Math.round(rect.height),
          blockers: [...blockers],
        };
      });

      report.push({ phone: phone.label, ...occlusion });

      // The control is a 44px target and essentially all of it must answer.
      // Not `> 0`: a fix that clears only the centre leaves the edges dead.
      expect(occlusion.blockers, `covered at ${phone.label}`).toEqual([]);
      expect(occlusion.live / occlusion.total).toBeGreaterThan(0.95);

      // And a real tap dismisses it, without going anywhere.
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator(PANEL)).toHaveCount(0);
      expect(new URL(page.url()).pathname, `navigated away at ${phone.label}`).toBe("/");
    }

    await testInfo.attach("close-control-occlusion", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  });
});

test("the desktop panel is the same corner card it has always been", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await openPanel(page);

  const metrics = await page.evaluate(READ_METRICS, PANEL);
  await testInfo.attach("desktop-1440x900", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });

  // 340px wide, off the right edge, nowhere near full height.
  expect(metrics.panel.width).toBe(340);
  expect(metrics.panel.left).toBeGreaterThan(1000);
  expect(metrics.panel.height).toBeLessThan(900);
  // And none of the sheet's behaviour follows it here.
  expect(metrics.ariaModal).toBe("false");
  expect(metrics.bodyOverflow).not.toBe("hidden");

  // Tab out of the corner card reaches the page, as it always did.
  await page.getByLabel(COMPOSER).fill("hola");
  await page.getByRole("button", { name: SEND }).focus();
  await page.keyboard.press("Tab");
  const stillInside = await page.evaluate((selector: string) => {
    const panel = document.querySelector(selector);
    return !!(panel && document.activeElement && panel.contains(document.activeElement));
  }, PANEL);
  expect(stillInside).toBe(false);

  // #1007 — the corner card's own header and composer are coal-2 here too:
  // the geometry above is unchanged, the surfaces are not.
  const colors = await page.evaluate((panelSelector: string) => {
    const panel = document.querySelector(panelSelector) as HTMLElement;
    const header = panel.querySelector("header") as HTMLElement;
    const form = panel.querySelector("form") as HTMLElement;
    return {
      header: getComputedStyle(header).backgroundColor,
      form: getComputedStyle(form).backgroundColor,
    };
  }, PANEL);
  expect(colors.header).toBe("rgb(28, 28, 33)");
  expect(colors.form).toBe("rgb(28, 28, 33)");
});
