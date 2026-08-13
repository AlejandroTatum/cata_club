/**
 * Dead canvas, measured on every paginated screen (#85).
 *
 * ## What "dead canvas" is, and why it needed a definition
 *
 * #36 asked that no admin screen leave more than ~200px of it. Nobody had ever
 * written down how to measure it, so the number travelled from issue to issue
 * as a single reading of a single screen. It is defined here, once:
 *
 *   dead canvas = viewport height − the bottom edge of the last child of
 *                 `<main>`, at scroll top, floored at zero.
 *
 * `<main>` itself cannot answer the question. `AppShell` gives it `flex-1`
 * (`AppShell.tsx:786`), so its own box always reaches the bottom of the glass
 * no matter how little is in it — measure the element and every screen reports
 * ~32px. What is empty is the space under the last thing drawn, which is why
 * the reading is taken off `main.children` and not off `main`.
 *
 * Reproduced on `/discounts` with the issue's four seeded discounts: 476px at
 * 1440×900 and 656px at 1920×1080, the two numbers #85 opens with.
 *
 * ## What this file settles
 *
 * #85 chose "more rows per page" over "a narrower measure". Measured across
 * every paginated list, at two row densities, that choice has nothing to act
 * on — and the two assertions below are the reason, stated as bounds a future
 * page-size change has to survive:
 *
 *   1. A page that FILLS leaves no meaningful dead canvas already.
 *   2. A page that leaves dead canvas is a page that did NOT fill — so there
 *      are no further rows for a larger page size to mount.
 *
 * Together those make dead canvas and a capped page mutually exclusive states.
 *
 * ## What this deliberately does NOT check
 *
 * `/discounts` and the collapsed `/groups` accordion are measured and recorded
 * but exempt from the bound. Neither is a paginated list: `/discounts` renders
 * its whole catalog with no pager at all, and the collapsed accordion is a
 * card per horario. Their canvas is a function of how many records exist, not
 * of a page size, and no rows-per-page number reaches it. They are kept in the
 * table because leaving them out would make the measurement look like it
 * covered the screen #85 opened on when it does not.
 *
 * Phone and tablet widths are also out of scope: below `sm` these lists are
 * card stacks, not tables, and they scroll at every row count.
 *
 * ## The second measure (#85, option B)
 *
 * Those same two screens are the ones #85 finally acted on, and the action was
 * NOT to close their canvas — it cannot be closed, for the reason above. They
 * are drawn on a 1024px content measure instead of the product's 1408px
 * (`AppShell` `measure="short"`), so the four discounts read as a column with
 * a margin rather than as a page that ran out of rows.
 *
 * The readings prove exactly that, and no more. `dead` on those two screens is
 * IDENTICAL either side of the change:
 *
 * | Screen             | 1366×768 | 1440×900 | 1920×1080 |
 * |--------------------|----------|----------|-----------|
 * | `/discounts`       | 344      | 476      | 656       |
 * | `/groups` collapsed| 508      | 640      | 820       |
 *
 * What moved is the width of the block above it — recorded per reading as
 * `contentWidth`, and bounded below:
 *
 * | Screen             | 1366×768   | 1440×900   | 1920×1080   |
 * |--------------------|------------|------------|-------------|
 * | `/discounts` before| 1078       | 1152       | 1356        |
 * | `/discounts` after | **972**    | **972**    | **972**     |
 * | `/groups` before   | 1078       | 1152       | 1356        |
 * | `/groups` after    | **972**    | **972**    | **972**     |
 *
 * The reverse of a narrower measure is a table squeezed into a sideways
 * scroll, so that is asserted too, on the screens the cap touches. The
 * `/discounts` table's min-content is 527px beside the 340px rail; at 972px of
 * content it has 610px, and the cap was chosen against that floor — 896px of
 * pane (844px of content) is where it starts scrolling.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockSession(page: Page, role: "admin" | "trainer"): Promise<void> {
  await page.context().addCookies([
    { name: "access_token", value: MOCK_ACCESS_TOKEN, url: E2E_BASE_URL },
  ]);
  await page.route("**/api/auth/session", (route: Route) =>
    fulfillJson(route, {
      user: { id: "1", name: "Demo", email: "demo@example.test", role, representanteId: null },
      roles: [role === "admin" ? "ADMINISTRADOR" : "ENTRENADOR"],
      loggedInAt: "2026-07-21T00:00:00.000Z",
    }),
  );
  // Both fire on every authenticated screen from `AppShell`; unstubbed they
  // hang the shell and every reading below would be of a half-drawn page.
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/dashboard", (route: Route) => fulfillJson(route, {}));
}

interface Reading {
  /** Bottom edge of the last child of `<main>`, in viewport pixels. */
  contentBottom: number;
  /** Viewport height minus that edge, floored at zero. */
  dead: number;
  /** How far the page scrolls past the viewport. The other side of the trade. */
  overflow: number;
  /** Width of the widest first-level block — the measure the screen is drawn on. */
  contentWidth: number;
  /**
   * Horizontal scrollers whose content does not fit, as `client/scroll`.
   *
   * The reverse of a width cap: a table that no longer fits its column does
   * not report as an error, it just starts scrolling sideways, and a list you
   * have to drag to read the last column of is worse than an empty page.
   */
  sideways: string[];
}

async function readCanvas(page: Page): Promise<Reading> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) throw new Error("no <main> on this page");
    const box = main.getBoundingClientRect();
    const children = [...main.children];
    const contentBottom = Math.max(box.top, ...children.map((el) => el.getBoundingClientRect().bottom));
    return {
      contentBottom: Math.round(contentBottom),
      dead: Math.max(0, Math.round(window.innerHeight - contentBottom)),
      overflow: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      contentWidth: Math.round(
        Math.max(0, ...children.map((el) => el.getBoundingClientRect().width)),
      ),
      sideways: [...main.querySelectorAll<HTMLElement>(".overflow-x-auto")]
        .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.clientWidth}/${el.scrollWidth}`),
    };
  });
}

/**
 * The three desktop heights that decide the trade.
 *
 * 1366×768 is the shortest laptop in common use and the one that pays for a
 * larger page size; 1440×900 and 1920×1080 are the two #85 measured on.
 */
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** The issue's own criterion, and the bound a shrunken page size would break. */
const DEAD_CANVAS_BUDGET = 200;

/**
 * The reverse, bounded.
 *
 * Every rows-per-page number in the product is 10. Raising them to 20 was
 * built and measured: it closes nothing at 1440×900 or 1920×1080 (there was
 * nothing left to close) and adds 480–600px of scroll to every list at
 * 1366×768, taking the tallest page from 1.72 to 2.45 viewports. Two viewports
 * is a ceiling with room over today's worst reading, not a restatement of it.
 */
const SCROLL_BUDGET_VIEWPORTS = 2;

/**
 * What `measure="short"` leaves for content: 1024px of pane less the shell's
 * 26px gutters. The bound is `<=`, because at a viewport narrower than the cap
 * the window is already the measure and nothing is capped.
 */
const SHORT_MEASURE_CONTENT = 972;

// ---------------------------------------------------------------------------
// Fixtures
//
// Every list is seeded at two densities. FULL is four pages' worth, so the
// rendered page is capped by the page size and a larger one would mount more
// rows — the best case for "more rows per page". SHORT is fewer records than
// one page, which is the state that actually produces dead canvas and the
// state in which a larger page size mounts nothing.
// ---------------------------------------------------------------------------

const FULL = 40;
const SHORT = 4;

const DISCOUNTS = [
  { id: 1, nombre: "Beca municipal", porcentaje: "100.00", monto: null, activo: true },
  { id: 2, nombre: "Convenio empresa", porcentaje: null, monto: "5.00", activo: true },
  { id: 3, nombre: "Hermanos", porcentaje: "15.00", monto: null, activo: true },
  { id: 4, nombre: "Pago anual", porcentaje: "10.00", monto: null, activo: false },
];

const SCHEDULES = [
  {
    id: 11,
    diaSemana: "lun",
    horaInicio: "18:00",
    horaFin: "19:00",
    categoria: "FORMATIVO",
  },
];

function rows<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i + 1));
}

const accounts = (n: number) =>
  rows(n, (i) => ({
    id: String(i),
    role: "representante",
    nombres: `Nombre${i}`,
    apellidos: `Apellido${i}`,
    email: `persona${i}@example.test`,
    telefono: "0999999999",
    estudiantes: [
      {
        id: `s${i}`,
        nombres: `Est${i}`,
        apellidos: `Apellido${i}`,
        grupoId: null,
        activo: true,
        membresia: {
          id: i,
          tipo: "mensual",
          estado: "activa",
          fechaInicio: "2026-07-01",
          fechaFin: "2026-07-31",
          monto: 85,
        },
        ultimoPago: null,
      },
    ],
  }));

/**
 * A distinct `fecha` per record, because `/trainer/attendance/history`
 * paginates SESSIONS — it groups records by `fecha|horario`
 * (`trainer-day-utils.ts:160`), so N records on one day would be a single row.
 */
const records = (n: number) =>
  rows(n, (i) => ({
    id: `rec-${i}`,
    fecha: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
    horario: `Lunes ${String(8 + Math.floor(i / 28)).padStart(2, "0")}:00 — 19:00`,
    personaId: i,
    estudiante: `Ana López ${i}`,
    estado: "present",
  }));

const payments = (n: number) =>
  rows(n, (i) => ({
    id: `pv-${i}`,
    studentName: `Ana López ${i}`,
    responsablePagoName: `María González ${i}`,
    membershipPeriod: "2026-07",
    membershipType: "Mensual",
    expectedAmount: 85,
    paymentMethod: "Transferencia",
    uploadedAt: "2026-07-05T12:00:00Z",
    currentMembershipStatus: "vencida",
    proofFileName: "voucher.jpg",
    proofFileType: "image",
    // The queue's persisted default filter is "pendiente"; anything else and
    // the list is empty for a reason that has nothing to do with page size.
    validationStatus: "pendiente",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }));

const personas = (n: number) =>
  rows(n, (i) => ({
    id: i,
    nombres: `Ana${i}`,
    apellidos: `López${i}`,
    cedula: "1104567890",
    fechaNacimiento: "2012-03-04",
    telefono: "0999999999",
    telefonoContacto: null,
    fechaRegistro: "2026-07-02",
  }));

const alumnos = (n: number) => ({
  items: rows(n, (i) => ({
    id: i,
    personaId: i,
    personaNombreCompleto: `Ana López ${i}`,
    edad: 12,
    horarioId: 11,
    horarioDia: "lun",
    horarioHoraInicio: "18:00",
    horarioHoraFin: "19:00",
    fechaAsignacion: "2026-01-01T00:00:00Z",
  })),
  total: n,
  skip: 0,
  limit: 200,
});

async function mockGroups(page: Page, n: number): Promise<void> {
  await mockSession(page, "admin");
  await page.route("**/api/groups/horarios", (r) => fulfillJson(r, SCHEDULES));
  await page.route("**/api/groups/horarios/*/alumnos*", (r) => fulfillJson(r, alumnos(n)));
  await page.route("**/api/members", (r) =>
    fulfillJson(r, { accounts: [], personasCapped: false }),
  );
  await page.goto("/groups");
}

interface Screen {
  name: string;
  /** False for the two screens that have no pager — recorded, not bounded. */
  paginated: boolean;
  /** True for the screens `AppShell` draws with `measure="short"`. */
  short?: boolean;
  open: (page: Page, n: number) => Promise<void>;
}

const SCREENS: Screen[] = [
  {
    name: "members",
    paginated: true,
    open: async (page, n) => {
      await mockSession(page, "admin");
      await page.route("**/api/members", (r) =>
        fulfillJson(r, { accounts: accounts(n), personasCapped: false }),
      );
      await page.goto("/members");
      await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "attendance",
    paginated: true,
    open: async (page, n) => {
      await mockSession(page, "admin");
      await page.route("**/api/attendance/schedules", (r) => fulfillJson(r, SCHEDULES));
      await page.route("**/api/attendance/records*", (r) => fulfillJson(r, records(n)));
      await page.goto("/attendance");
      await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "payments",
    paginated: true,
    open: async (page, n) => {
      await mockSession(page, "admin");
      await page.route("**/api/payments", (r) => fulfillJson(r, payments(n)));
      await page.goto("/payments");
      await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "reports",
    paginated: true,
    open: async (page, n) => {
      await mockSession(page, "admin");
      await page.route("**/api/attendance/schedules", (r) => fulfillJson(r, SCHEDULES));
      await page.route("**/api/personas/reportes/nuevos-por-periodo*", (r) =>
        fulfillJson(r, personas(n)),
      );
      await page.goto("/reports");
      // `periodo` is the default preset, and the range quick-preset defaults to
      // "this_month" (issue #201) with dates already resolved on first render —
      // no manual fill needed to make the preview exist. The manual "Desde"/
      // "Hasta" inputs only render under the "Personalizado" range preset, which
      // this canvas-occupancy check has no reason to select.
      await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "trainer history",
    paginated: true,
    open: async (page, n) => {
      await mockSession(page, "trainer");
      await page.route("**/api/attendance/schedules", (r) => fulfillJson(r, SCHEDULES));
      await page.route("**/api/attendance/records*", (r) => fulfillJson(r, records(n)));
      await page.goto("/trainer/attendance/history");
      await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "trainer roster",
    paginated: true,
    open: async (page, n) => {
      await mockSession(page, "trainer");
      await page.route("**/api/attendance/schedules", (r) => fulfillJson(r, SCHEDULES));
      await page.route("**/api/attendance/records*", (r) => fulfillJson(r, []));
      await page.route("**/api/groups/horarios/*/alumnos*", (r) => fulfillJson(r, alumnos(n)));
      // The deep link restores the wizard straight to the roster step, which
      // is where the paginated list lives.
      await page.goto("/trainer/attendance?horario=11&paso=lista");
      await expect(page.getByText("Ana López 1", { exact: true })).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "groups roster",
    paginated: true,
    // The roster paginates, but it lives INSIDE `/groups`, so it is drawn on
    // the same short measure as the collapsed accordion. Both states are
    // measured for exactly that reason.
    short: true,
    open: async (page, n) => {
      await mockGroups(page, n);
      await page
        .getByRole("button", { name: /^Ver alumnos de / })
        .first()
        .click({ timeout: 20_000 });
      // The roster's own count, not a row — the collapsed card already holds a
      // list, so waiting on "a list item" would measure the page before the
      // accordion had drawn anything.
      await expect(page.getByText(`Alumnos asignados (${n})`)).toBeVisible({ timeout: 20_000 });
      // The roster row's age used to render as "Nombre · N años" in one text
      // node; converting the row to DataRow/DataBox split it into a separate
      // element holding just "N años" (no "· " prefix survives it).
      await expect(page.getByText(/\d+ años/).first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "discounts",
    paginated: false,
    short: true,
    open: async (page) => {
      await mockSession(page, "admin");
      await page.route("**/api/descuentos", (r) => fulfillJson(r, DISCOUNTS));
      await page.goto("/discounts");
      await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "groups collapsed",
    paginated: false,
    short: true,
    open: async (page) => {
      await mockGroups(page, 1);
      await expect(page.getByRole("button", { name: /^Ver alumnos de / }).first()).toBeVisible({
        timeout: 20_000,
      });
    },
  },
];

/** The pager only exists when the records outran the page size. */
async function pageIsFull(page: Page): Promise<boolean> {
  return (await page.getByRole("button", { name: "Página siguiente" }).count()) > 0;
}

/**
 * #85's option B, as two bounds — what the cap does, and what it costs.
 *
 * Deliberately says nothing about `dead`: the cap does not change it, the
 * readings above record that it does not, and a bound claiming otherwise would
 * be a bound on a thing that did not happen.
 */
function assertMeasure(
  screen: Screen,
  reading: Reading,
  viewport: { width: number; height: number },
  at: string,
): void {
  if (screen.short) {
    // 1. The screen really is on the narrower measure — at every desktop
    //    width, not just the one someone looked at.
    expect(reading.contentWidth, `content measure on ${screen.name} at ${at}`).toBeLessThanOrEqual(
      SHORT_MEASURE_CONTENT,
    );
    // 2. The reverse. A narrower column that pushes a table into a sideways
    //    scroll has traded an empty page for an unreadable one; the cap was
    //    picked 83px clear of the floor where that starts.
    expect(reading.sideways, `sideways scroll on ${screen.name} at ${at}`).toEqual([]);
    return;
  }

  // The other side of "exactly two screens are short": everything else still
  // gets the product's measure. Checked where the two differ — below 1024 the
  // window is narrower than either cap and the comparison means nothing.
  if (viewport.width >= 1440) {
    expect(reading.contentWidth, `content measure on ${screen.name} at ${at}`).toBeGreaterThan(
      SHORT_MEASURE_CONTENT,
    );
  }
}

test.describe("dead canvas", () => {
  for (const viewport of VIEWPORTS) {
    const at = `${viewport.width}×${viewport.height}`;

    for (const screen of SCREENS) {
      test(`${screen.name} fills the canvas at ${at}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        await screen.open(page, FULL);

        const reading = await readCanvas(page);
        const full = await pageIsFull(page);

        // Recorded, not only asserted — the same contract `content-measure`
        // keeps: the next person to change a page size should be able to read
        // what these were before they did.
        await testInfo.attach(`${screen.name}-full-${viewport.width}`, {
          body: JSON.stringify({ ...reading, pageIsFull: full }),
          contentType: "text/plain",
        });

        assertMeasure(screen, reading, viewport, at);

        if (!screen.paginated) return;

        expect(full, `${screen.name} should have outrun its page size`).toBe(true);
        // 1. A page that fills leaves no canvas worth closing. This is the
        //    criterion #36 wrote and #85 believed was unmet.
        expect(reading.dead, `dead canvas on ${screen.name} at ${at}`).toBeLessThanOrEqual(
          DEAD_CANVAS_BUDGET,
        );
        // 2. …and the other side of it: the page a full list produces still
        //    fits inside two viewports on the shortest laptop.
        expect(reading.contentBottom, `page height on ${screen.name} at ${at}`).toBeLessThanOrEqual(
          SCROLL_BUDGET_VIEWPORTS * viewport.height,
        );
      });

      if (!screen.paginated) continue;

      test(`${screen.name} leaves canvas only on a part page at ${at}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize(viewport);
        await screen.open(page, SHORT);

        const reading = await readCanvas(page);
        const full = await pageIsFull(page);

        await testInfo.attach(`${screen.name}-short-${viewport.width}`, {
          body: JSON.stringify({ ...reading, pageIsFull: full }),
          contentType: "text/plain",
        });

        // The measure is a property of the SCREEN, so it holds at the record
        // count that leaves canvas as well as at the one that fills it — and a
        // part page is where a squeezed table would show up first.
        assertMeasure(screen, reading, viewport, at);

        // The whole argument of #85, as one assertion: wherever dead canvas
        // survives, the page did NOT fill — there were fewer records than the
        // page size — so no larger page size has a row left to mount into it.
        // A change that closed canvas by raising a page size would have to
        // make this fail first.
        if (reading.dead > DEAD_CANVAS_BUDGET) {
          expect(full, `${screen.name} left ${reading.dead}px on a FULL page at ${at}`).toBe(false);
        }
      });
    }
  }
});
