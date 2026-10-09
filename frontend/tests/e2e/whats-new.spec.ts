/**
 * The what's-new welcome dialog (T18; S16 release notes on login, S4 safety),
 * measured in a browser.
 *
 * Starts from EMPTY storage on purpose: the config seeds the "seen" mark into
 * every other spec, and this is the one that must prove first-visit display.
 * Like the batch specs it answers the same-origin BFF itself; the subject is
 * the dialog, not the backend.
 *
 * Set `WHATS_NEW_SHOTS_DIR` to also write the review screenshots (admin,
 * trainer, student × light/dark × 1440/390) to that directory.
 */

import { mkdirSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";
import { EMPTY_STORAGE_STATE } from "./whats-new-seen";

test.use({ storageState: EMPTY_STORAGE_STATE });

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const SESSIONS = {
  admin: {
    user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin", representanteId: null },
    roles: ["ADMINISTRADOR"],
    first: "Modo oscuro: actívalo desde tu menú de cuenta, también en el inicio de sesión.",
  },
  entrenador: {
    user: { id: "7", name: "Tomás Rivas", email: "tomas@cataclub.com", role: "trainer", representanteId: null },
    roles: ["ENTRENADOR"],
    first: "Modo oscuro: actívalo desde tu menú de cuenta.",
  },
  estudiante: {
    user: { id: "41", name: "Sofía Vera", email: "sofia@cataclub.com", role: "estudiante", representanteId: null, personaId: "41" },
    roles: ["ALUMNO"],
    first: "Modo oscuro: actívalo desde tu menú de cuenta.",
  },
} as const;

type RoleName = keyof typeof SESSIONS;

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function signIn(page: Page, role: RoleName, legalPending = false): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", (route) => (route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {})));
  await page.route("**/api/ranking/notificaciones/mias", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
  await page.route("**/api/dashboard", (route) =>
    fulfillJson(route, { totalPersonas: 120, totalAlumnos: 98, activeMemberships: 80, pendingPayments: 7, todaySchedules: 4, personasSinMembresia: 12 }),
  );
  await page.route("**/api/auth/consentimiento-legal", (route) => fulfillJson(route, { pendiente: legalPending, version: "2.3" }));
  await page.route("**/api/auth/session", (route) => {
    const { first: _first, ...session } = SESSIONS[role];
    return fulfillJson(route, { ...session, loggedInAt: new Date().toISOString() });
  });
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "CataClub se renovó" });

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem("cata_theme", value), theme);
}

/** A static, backend-free screen of the authenticated shell, valid for every role. */
const FIRST_SCREEN = "/ayuda";

for (const role of ["admin", "estudiante"] as const) {
  test(`${role}: shows on the first screen, closes, and stays closed after a reload`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, role);
    await page.goto(FIRST_SCREEN);

    await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
    await expect(dialog(page).getByRole("listitem").first()).toHaveText(SESSIONS[role].first);
    await expect(dialog(page).getByRole("button", { name: "Entendido" })).toBeFocused();

    await dialog(page).getByRole("button", { name: "Entendido" }).click();
    await expect(dialog(page)).toBeHidden();

    await page.reload();
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
    await expect(dialog(page)).toBeHidden();
  });
}

test("Escape marks it seen and Ver ayuda goes to /ayuda", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, "admin");
  await page.goto(FIRST_SCREEN);
  await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await page.reload();
  await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
  await expect(dialog(page)).toBeHidden();

  await page.evaluate(() => localStorage.clear());
  await page.goto("/groups");
  await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
  await dialog(page).getByRole("link", { name: "Ver ayuda" }).click();
  await expect(page).toHaveURL(/\/ayuda$/);
  await expect(dialog(page)).toBeHidden();
});

test("never shows on the landing or the public login page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
  await expect(dialog(page)).toBeHidden();
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await expect(dialog(page)).toBeHidden();
});

test("waits for the legal re-accept gate", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, "admin", true);
  await page.goto(FIRST_SCREEN);
  await expect(page.getByRole("dialog", { name: /términos y condiciones/i })).toBeVisible({ timeout: 20_000 });
  await expect(dialog(page)).toBeHidden();
});

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`dialog animation follows prefers-reduced-motion: ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize(DESKTOP);
    await signIn(page, "admin");
    await page.goto(FIRST_SCREEN);
    await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
    const duration = await dialog(page).evaluate((el) => getComputedStyle(el).animationDuration);
    const ms = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
    if (reducedMotion === "reduce") expect(ms).toBe(0);
    else expect(ms).toBeGreaterThan(0);
  });
}

test("dark theme paints the panel dark with light text", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await setTheme(page, "dark");
  await signIn(page, "admin");
  await page.goto(FIRST_SCREEN);
  await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
  const { bg, fg } = await dialog(page).evaluate((el) => {
    const lum = (css: string): number => {
      const [r, g, b] = (css.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((n) => {
        const c = Number(n) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return { bg: lum(getComputedStyle(el).backgroundColor), fg: lum(getComputedStyle(el.querySelector("li")!).color) };
  });
  expect(bg).toBeLessThan(0.1);
  expect(fg).toBeGreaterThan(0.5);
});

for (const [label, viewport] of [["phone 390", PHONE], ["desktop 1440", DESKTOP]] as const) {
  test(`no horizontal overflow and the dialog fits the viewport (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, "admin");
    await page.goto(FIRST_SCREEN);
    await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    // The phone sheet slides in; measure it once it has landed.
    await page.waitForTimeout(400);
    const box = (await dialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  });
}

const SHOTS_DIR = process.env.WHATS_NEW_SHOTS_DIR;
if (SHOTS_DIR) {
  for (const role of Object.keys(SESSIONS) as RoleName[]) {
    for (const theme of ["light", "dark"] as const) {
      for (const [label, viewport] of [["1440", DESKTOP], ["390", PHONE]] as const) {
        test(`screenshot ${role} ${theme} ${label}`, async ({ page }) => {
          mkdirSync(SHOTS_DIR, { recursive: true });
          await page.setViewportSize(viewport);
          await setTheme(page, theme);
          await signIn(page, role);
          await page.goto(FIRST_SCREEN);
          await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
          await page.waitForTimeout(400);
          await page.screenshot({ path: `${SHOTS_DIR}/${role}-${theme}-${label}.png` });
        });
      }
    }
  }
}
