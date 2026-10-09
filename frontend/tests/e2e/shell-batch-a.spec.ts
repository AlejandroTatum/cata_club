/**
 * Shell fixes from the T14 audit, batch A (S13, S9, S4), measured in a browser.
 *
 *  - RC4  the «Reportar un problema» launcher is icon-only on a phone and never
 *         sits on the last thing on the page;
 *  - RC14 the `/ayuda` shortcut tiles do not clip their own text;
 *  - RC13 `/student/enroll` for a signed-in visitor lives in the app shell and
 *         its two buttons stay inside their card;
 *  - RC5  the pulse tiles never push the page sideways, and the shell's own
 *         controls (back link, bell) reach 44px on a narrow window.
 *
 * Like `sidebar-no-scroll.spec.ts` it intercepts the same-origin BFF: the
 * subject is layout, not the backend. The phone is a 390px DESKTOP-pointer
 * window on purpose: that is how the audit measured, and it is the case the
 * coarse-pointer floor in `globals.css` does not cover.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const SESSIONS = {
  admin: {
    user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin", representanteId: null },
    roles: ["ADMINISTRADOR"],
  },
  estudiante: {
    user: { id: "41", name: "Sofía Vera", email: "sofia@cataclub.com", role: "estudiante", representanteId: null, personaId: "41" },
    roles: ["ALUMNO"],
  },
} as const;

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function signIn(page: Page, role: keyof typeof SESSIONS): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {}),
  );
  await page.route("**/api/ranking/notificaciones/mias", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
  await page.route("**/api/dashboard", (route) =>
    fulfillJson(route, { totalPersonas: 120, totalAlumnos: 98, activeMemberships: 80, pendingPayments: 7, todaySchedules: 4, personasSinMembresia: 12 }),
  );
  await page.route("**/api/auth/session", (route) =>
    fulfillJson(route, { ...SESSIONS[role], loggedInAt: new Date().toISOString() }),
  );
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test.describe("Shell batch A", () => {
  test("RC4: the launcher is an icon on a phone and clears the last row", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, "admin");
    await page.goto("/ayuda");

    const fab = page.locator("button[data-report-ignore]");
    await expect(fab).toBeVisible({ timeout: 20_000 });
    const box = (await fab.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeLessThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const fabAtEnd = (await fab.boundingBox())!;
    const lastBottom = await page.evaluate(() => {
      const main = document.querySelector("main");
      const last = main?.lastElementChild as HTMLElement | null;
      return last ? last.getBoundingClientRect().bottom : 0;
    });
    // At the end of the scroll the last block of the page ends above the launcher.
    expect(lastBottom).toBeLessThanOrEqual(fabAtEnd.y);
  });

  test("RC4: the launcher keeps its words from md up", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, "admin");
    await page.goto("/ayuda");
    const fab = page.locator("button[data-report-ignore]");
    await expect(fab).toBeVisible({ timeout: 20_000 });
    expect((await fab.boundingBox())!.width).toBeGreaterThan(120);
  });

  for (const viewport of [DESKTOP, PHONE]) {
    test(`RC14: /ayuda shortcut tiles do not clip their text at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, "admin");
      await page.goto("/ayuda");

      const list = page.getByRole("list", { name: "Accesos rápidos" });
      await expect(list).toBeVisible({ timeout: 20_000 });
      const clipped = await list.getByRole("link").evaluateAll((links) =>
        links
          .flatMap((link) => [link, ...Array.from(link.querySelectorAll("span"))])
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => (el.textContent ?? "").trim().slice(0, 40)),
      );
      expect(clipped).toEqual([]);

      const lefts = await list.getByRole("link").evaluateAll((links) => links.map((l) => Math.round(l.getBoundingClientRect().left)));
      // A rail holds one column: every tile starts at the same x.
      expect(new Set(lefts).size).toBe(1);
      await noHorizontalOverflow(page);
    });
  }

  test("RC13: /student/enroll for a signed-in visitor sits in the shell and its buttons stay in the card", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, "estudiante");
    await page.goto("/student/enroll");

    await expect(page.getByRole("heading", { name: "Ya tienes una sesión iniciada" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".app-shell")).toHaveCount(1);

    const card = page.locator("main section").first();
    const cardBox = (await card.boundingBox())!;
    for (const name of ["Agregar jugador (menor de edad)", "Cerrar sesión para inscribir a otra persona"]) {
      const target = page.getByText(name).first();
      const box = (await target.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    }
    await noHorizontalOverflow(page);
  });

  test("RC5: pulse tiles never push the page sideways on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, "admin");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });

    const overflowing = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-tone]'))
        .filter((tile) => tile.scrollWidth > tile.clientWidth + 1)
        .map((tile) => (tile.textContent ?? "").slice(0, 30)),
    );
    expect(overflowing).toEqual([]);
    await noHorizontalOverflow(page);
  });

  test("RC5: the back link and the bell reach 44px on a narrow window", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, "admin");
    await page.goto("/ayuda");

    const back = page.getByRole("link", { name: "Volver al Panel de Control" });
    await expect(back).toBeVisible({ timeout: 20_000 });
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const bell = page.getByRole("button", { name: /Notificaciones/ }).first();
    const bellBox = (await bell.boundingBox())!;
    expect(bellBox.height).toBeGreaterThanOrEqual(44);
    expect(bellBox.width).toBeGreaterThanOrEqual(44);
  });
});
