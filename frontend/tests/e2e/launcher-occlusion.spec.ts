/**
 * The rule issue #59 asked for, written as geometry instead of class names:
 * NO `position: fixed` element may cover the centre of an interactive control.
 *
 * ## Why the centre, and why `elementFromPoint`
 *
 * A floating launcher that merely overlaps a button is a cosmetic complaint.
 * One that owns the point a click lands on is a dead control: the button is
 * visible, it is in the tab order, and pointing at it hits the float instead.
 * `document.elementFromPoint(cx, cy)` is the same probe the issue used to
 * prove it, so this spec asserts on the browser's own hit test rather than on
 * a rect intersection we computed ourselves.
 *
 * ## Why three scroll positions and not one
 *
 * The issue described the defect as "the last two visible rows", which reads
 * as a page-foot problem that bottom padding would solve. It is not: the page
 * scrolls under a viewport-fixed element, so at every scroll offset a
 * DIFFERENT row sits in the corner. Sweeping the top, the middle and the foot
 * is what distinguishes "the last rows are covered" from "whatever is in the
 * corner is covered", and only the second is true.
 *
 * ## Why only `lg` and up
 *
 * Two different rules govern the two size classes, and conflating them would
 * make this spec unsatisfiable.
 *
 *   · From `lg` up the launcher is 76x76 at a 20px inset, and nothing else is
 *     bottom-anchored. Its corner overlaps the right-aligned action lane every
 *     `ui/Table` screen uses, at every scroll offset. That is #59.
 *   · Below `lg` the admin phone tab bar is `fixed inset-x-0 bottom-0`, and
 *     page content passing under a bottom navigation bar mid-scroll is what a
 *     bottom navigation bar IS. The shell already reserves for it with
 *     `pb-[78px]`, so nothing is trapped under it once the page is scrolled
 *     home. That is a different contract from "a float owns a corner nobody
 *     reserved", and it is not what this spec measures.
 *
 * ## What #89 added below `lg`, and why it is a different assertion
 *
 * Page content under the tab bar is the bar's own business, but the LAUNCHER
 * under the tab bar is not: the launcher's whole contract is that it yields to
 * bottom furniture, and at 390×844 it was measured resting INSIDE the bar's
 * band with `transform: none` at 300ms, 800ms, 1500ms and 3000ms.
 *
 * The rule above cannot see it. Measured on /members at 390×844 with the
 * defect live:
 *
 * | Element                  | Rect                                  |
 * |--------------------------|---------------------------------------|
 * | tab bar                  | y 782..844                            |
 * | launcher, unlifted       | x 338..382, y 784..828                |
 * | tab "Panel"              | x 8..99, centre 53                    |
 * | tab "Miembros"           | x 103..193, centre 148                |
 * | tab "Pagos"              | x 197..288, centre 242                |
 * | tab "Más"                | x 292..382, **centre 337**            |
 *
 * The launcher's left edge is 338 and the last tab's centre is 337. ONE pixel.
 * The float covered the right 44px of a 90px destination and every tab centre
 * stayed clickable, so "no fixed element owns a control's centre" was true the
 * entire time the launcher was sitting on the bar. A centre probe would have
 * reported clear.
 *
 * So the phone case asserts the launcher's OWN promise instead — it clears
 * bottom furniture by `OBSTACLE_GAP_PX` — and it asks twice, because the two
 * defects behind #89 failed at different times: one left the launcher down
 * until an unrelated frame shipped (~2s), the other let it climb and then drop
 * back within ~300ms of arriving.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const BASE_URL = E2E_BASE_URL;
const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

/** Enough rows that the table outruns the tallest viewport under test. */
const ACCOUNTS = Array.from({ length: 40 }, (_unused, index) => {
  const n = index + 1;
  return {
    id: String(n),
    role: "representante",
    nombres: `Nombre${n}`,
    apellidos: `Apellido${n}`,
    email: `representante${n}@example.test`,
    telefono: "0999999999",
    estudiantes: [
      {
        id: String(1000 + n),
        nombres: `Estudiante${n}`,
        apellidos: `Apellido${n}`,
        grupoId: null,
        activo: true,
        membresia: {
          tipo: "mensual",
          estado: "activa",
          fechaInicio: "2026-07-01",
          fechaFin: "2026-07-31",
          monto: 85,
        },
        ultimoPago: null,
      },
    ],
  };
});

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

/** Cookie + route mocks: the members list renders with no backend behind it. */
async function mockAdminMembers(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: MOCK_ACCESS_TOKEN, url: BASE_URL }]);
  await page.route("**/api/**", (route: Route): Promise<void> =>
    route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {}),
  );
  await page.route("**/api/auth/session", (route: Route): Promise<void> =>
    fulfillJson(route, {
      user: { id: "1", name: "Admin Demo", email: "admin@example.test", role: "admin", representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: "2026-07-21T00:00:00.000Z",
    }),
  );
  await page.route("**/api/members", (route: Route): Promise<void> =>
    fulfillJson(route, { accounts: ACCOUNTS, niveles: [], personasCapped: false }),
  );
}

interface Occlusion {
  control: string;
  controlRect: string;
  centre: string;
  hit: string;
  occluder: string;
  occluderRect: string;
}

/**
 * Every interactive control whose centre the browser resolves to a `fixed`
 * ancestor other than the control itself.
 */
const SWEEP_OCCLUSIONS = (): Occlusion[] => {
  const INTERACTIVE =
    'a[href],button,input,select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])';
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const describe = (el: Element): string => {
    const label = el.getAttribute("aria-label") ?? el.textContent ?? "";
    return `<${el.tagName.toLowerCase()}> ${label.trim().slice(0, 40)}`;
  };
  const box = (el: Element): string => {
    const r = el.getBoundingClientRect();
    return `(${Math.round(r.x)},${Math.round(r.y)}) ${Math.round(r.width)}x${Math.round(r.height)}`;
  };
  const fixedAncestor = (start: Element): Element | null => {
    for (let el: Element | null = start; el; el = el.parentElement) {
      if (getComputedStyle(el).position === "fixed") return el;
    }
    return null;
  };

  const found: Occlusion[] = [];
  for (const control of document.querySelectorAll(INTERACTIVE)) {
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Only what the user can actually point at right now.
    if (cx < 0 || cx > viewportWidth - 1 || cy < 0 || cy > viewportHeight - 1) continue;

    const hit = document.elementFromPoint(cx, cy);
    if (!hit || hit === control || control.contains(hit)) continue;
    const occluder = fixedAncestor(hit);
    // Page content overlapping page content is the page's own business; this
    // rule is about elements that left the flow and took the corner.
    if (!occluder || occluder === control || occluder.contains(control)) continue;

    found.push({
      control: describe(control),
      controlRect: box(control),
      centre: `(${Math.round(cx)},${Math.round(cy)})`,
      hit: `<${hit.tagName.toLowerCase()}>`,
      occluder: describe(occluder),
      occluderRect: box(occluder),
    });
  }
  return found;
};

/** The admin's phone tab bar, by the name a screen reader announces. */
const TAB_BAR_LABEL = "Navegación principal (móvil)";

/** `OBSTACLE_GAP_PX` in `HelpChatDock`: what "clear of it" is worth in pixels. */
const OBSTACLE_GAP_PX = 12;

interface PhoneCorner {
  /** Pixels of daylight between the launcher's foot and the bar's top edge. */
  gap: number | null;
  detail: string;
}

/** The one number the phone case turns on, plus everything needed to read a failure. */
const PHONE_CORNER = (label: string): PhoneCorner => {
  const bar = document.querySelector(`nav[aria-label="${label}"]`);
  const launcher = document.querySelector('button[aria-label*="CATA-BOT"]');
  if (!bar || !launcher) {
    return { gap: null, detail: `bar ${bar ? "present" : "ABSENT"}, launcher ${launcher ? "present" : "ABSENT"}` };
  }

  const barRect = bar.getBoundingClientRect();
  const launcherRect = launcher.getBoundingClientRect();
  const tabs = [...bar.querySelectorAll('a[href],button,[role="button"]')]
    .map((tab): string => {
      const r = tab.getBoundingClientRect();
      const name = (tab.getAttribute("aria-label") ?? tab.textContent ?? "").trim().slice(0, 12);
      return `${name} x${Math.round(r.left)}..${Math.round(r.right)} c${Math.round(r.left + r.width / 2)}`;
    })
    .join(", ");

  return {
    gap: Math.round(barRect.top - launcherRect.bottom),
    detail:
      `bar y ${Math.round(barRect.top)}..${Math.round(barRect.bottom)}, ` +
      `launcher x ${Math.round(launcherRect.left)}..${Math.round(launcherRect.right)} ` +
      `y ${Math.round(launcherRect.top)}..${Math.round(launcherRect.bottom)} ` +
      `transform ${getComputedStyle(launcher).transform}; tabs ${tabs}`,
  };
};

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`no fixed element covers an interactive control on /members at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockAdminMembers(page);

    await page.goto("/members");
    await expect(page.locator("table")).toBeVisible({ timeout: 20_000 });
    // The launcher measures its own corner on a `requestAnimationFrame`, so
    // give the first measurement a frame to land before probing.
    await page.waitForTimeout(500);

    const report: string[] = [];
    for (const position of ["top", "middle", "foot"] as const) {
      await page.evaluate((where: string): void => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, where === "top" ? 0 : where === "middle" ? Math.round(max / 2) : max);
      }, position);
      await page.waitForTimeout(300);

      const occlusions = await page.evaluate(SWEEP_OCCLUSIONS);
      report.push(
        `${position}: ${occlusions.length === 0 ? "clear" : occlusions
          .map(
            (o) =>
              `${o.control} ${o.controlRect} centre ${o.centre} -> ${o.hit} of ${o.occluder} ${o.occluderRect}`,
          )
          .join(" | ")}`,
      );
      expect(
        occlusions,
        `scrolled to the ${position} of /members at ${viewport.width}x${viewport.height}`,
      ).toEqual([]);
    }

    await testInfo.attach(`occlusion-${viewport.width}x${viewport.height}`, {
      body: report.join("\n"),
      contentType: "text/plain",
    });
  });
}

/**
 * #89, at the width the tab bar exists at. Two probes, one defect each:
 *
 *   · 500ms after the bar is on screen. The measurement used to be queued on
 *     `requestAnimationFrame`, and instrumented on this exact page the first
 *     callback was requested at 77ms and ran at 2055ms — so 500ms lands well
 *     inside the window where the launcher was still sitting on the bar.
 *   · 2500ms later, once every transition has finished. The launcher used to
 *     climb and then fall back within ~300ms, because it re-derived its
 *     resting corner from where it was DRAWN while its own 200ms transform
 *     transition was still running.
 */
test("the launcher clears the phone tab bar at 390x844", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdminMembers(page);

  await page.goto("/members");
  await expect(page.getByRole("navigation", { name: TAB_BAR_LABEL })).toBeVisible({ timeout: 20_000 });

  const report: string[] = [];
  for (const [moment, settle] of [
    ["as soon as the bar lands", 500],
    ["once everything has settled", 2500],
  ] as const) {
    await page.waitForTimeout(settle);

    const corner = await page.evaluate(PHONE_CORNER, TAB_BAR_LABEL);
    report.push(`${moment}: gap ${corner.gap} :: ${corner.detail}`);

    expect(corner.gap, `${moment}, at 390x844 :: ${corner.detail}`).toBeGreaterThanOrEqual(
      OBSTACLE_GAP_PX,
    );
  }

  await testInfo.attach("occlusion-390x844", { body: report.join("\n"), contentType: "text/plain" });
});
