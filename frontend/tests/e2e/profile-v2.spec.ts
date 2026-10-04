/**
 * /profile v2 — the four role variants, desktop and 360, against a mocked
 * backend (no live stack).
 *
 * What a unit test in jsdom cannot see and this can: that nothing overflows or
 * clips, that the coal board's yellow ball never lands on its own copy
 * (including at 360), and that the ball's bounce stops under
 * `prefers-reduced-motion`. A screenshot per role and width is written to the
 * git-excluded `.screens/` at the repository root.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { E2E_BASE_URL } from "./e2e-target";
import { MOCK_CLUB_PAYMENT_INFO } from "./helpers/club-payment-info";

const SCREENS_DIR = path.resolve(__dirname, "../../../.screens");

type Role = "admin" | "trainer" | "representante" | "estudiante";

const SESSIONS: Record<Role, unknown> = {
  admin: {
    user: { id: "1", name: "Admin Dev", email: "admin@cataclub.com", role: "admin", representanteId: null },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-10-01T00:00:00.000Z",
  },
  trainer: {
    user: { id: "3", name: "Carlos Mendoza", email: "entrenador@cataclub.com", role: "trainer", representanteId: null },
    roles: ["ENTRENADOR"],
    loggedInAt: "2026-10-01T00:00:00.000Z",
  },
  representante: {
    user: { id: "7", name: "Laura Vera", email: "laura@cataclub.com", role: "representante", representanteId: null },
    roles: ["REPRESENTANTE"],
    loggedInAt: "2026-10-01T00:00:00.000Z",
  },
  estudiante: {
    user: { id: "41", name: "Pedro Salgado", email: "pedro@cataclub.com", role: "estudiante", representanteId: null, personaId: "41" },
    roles: ["ALUMNO"],
    loggedInAt: "2026-10-01T00:00:00.000Z",
  },
};

const PERFIL: Record<Role, unknown> = {
  admin: { correo: "admin@cataclub.com", personaId: 1, nombres: "Admin", apellidos: "Dev", roles: ["ADMINISTRADOR"], telefono: "0999999999", fechaCreacion: "2026-10-04T10:00:00" },
  trainer: { correo: "entrenador@cataclub.com", personaId: 3, nombres: "Carlos", apellidos: "Mendoza", roles: ["ENTRENADOR"], telefono: "0988888888", fechaCreacion: "2026-10-04T10:00:00" },
  representante: { correo: "laura@cataclub.com", personaId: 7, nombres: "Laura", apellidos: "Vera", roles: ["REPRESENTANTE"], telefono: "0981000010", fechaCreacion: "2026-10-04T10:00:00" },
  estudiante: { correo: "pedro@cataclub.com", personaId: 41, nombres: "Pedro", apellidos: "Salgado", roles: ["ALUMNO"], telefono: "0974444444", fechaCreacion: "2026-10-04T10:00:00" },
};

const MEMBERSHIP = (id: number, estado: string) => ({
  id,
  estado,
  personaId: id,
  montoAplicado: "25.00",
  categoria: "Mensual Adultos",
  modalidad: "MENSUAL",
  fechaActivacion: "2026-10-04T10:00:00Z",
  fechaFin: null,
});

const DEPENDANT = (id: string, nombres: string, estado: string | null) => ({
  personaId: id,
  nombres,
  apellidos: "Vera",
  fechaNacimiento: "2014-03-02",
  recentSessions: [],
  membership: estado ? MEMBERSHIP(Number(id), estado) : null,
  representante: { nombres: "Laura", apellidos: "Vera" },
  representanteId: 7,
});

const PORTAL: Record<"representante" | "estudiante", unknown> = {
  representante: {
    self: null,
    representados: [DEPENDANT("41", "Martin", "ACTIVA"), DEPENDANT("42", "Sofia", "SUSPENDIDA")],
    membershipPlans: [],
  },
  estudiante: {
    self: {
      personaId: "41",
      nombres: "Pedro",
      apellidos: "Salgado",
      fechaNacimiento: "1999-10-04",
      recentSessions: [],
      membership: MEMBERSHIP(41, "ACTIVA"),
      representante: null,
      representanteId: null,
    },
    representados: [],
    membershipPlans: [],
  },
};

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function isoInDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

async function mockBackend(page: Page, role: Role): Promise<void> {
  await page.route("**/api/**", (route) => (route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {})));
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/auth/session", (route) => fulfillJson(route, SESSIONS[role]));
  await page.route("**/api/auth/me", (route) => fulfillJson(route, PERFIL[role]));
  await page.route("**/api/auth/me/sesiones*", (route) =>
    fulfillJson(route, [
      { id: 1, dispositivo: "Linux · Chrome", iniciadaEn: "2026-10-04T10:00:00Z", actual: true, vigente: true },
      { id: 2, dispositivo: "Android · Chrome", iniciadaEn: "2026-10-03T10:00:00Z", actual: false, vigente: true },
    ]),
  );
  await page.route("**/api/ranking/notificaciones/mias", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 10 }));
  await page.route("**/api/club/payment-info", (route) => fulfillJson(route, MOCK_CLUB_PAYMENT_INFO));
  if (role === "representante" || role === "estudiante") {
    await page.route("**/api/student?*", (route) => fulfillJson(route, PORTAL[role]));
    await page.route("**/api/membresias/pagos/persona/*", (route) =>
      fulfillJson(route, [
        {
          id: 1, monto: "25.00", motivoRechazo: null, estadoPago: "APROBADO", tipoPago: "TRANSFERENCIA",
          fechaRegistro: "2026-10-04T10:00:00", fechaValidacion: "2026-10-04T10:00:00",
          fechaInicio: isoInDays(-6), fechaFin: isoInDays(24), personaId: 41, membresiaId: 41,
          voucherUrl: null, voucherFormato: null, descuentoValorAplicado: null, descuentoPorcentajeAplicado: null,
        },
      ]),
    );
  }
}

const VIEWPORTS = [
  { label: "1440", width: 1440, height: 1000 },
  { label: "360", width: 360, height: 740 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`profile v2 @${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const role of ["admin", "trainer", "representante", "estudiante"] as const) {
      test(role, async ({ page }) => {
        await mockBackend(page, role);
        await page.goto("/profile");
        await expect(page.getByTestId("profile-hero")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready.then(() => undefined));

        // Nothing overflows the viewport…
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(vp.width + 1);

        // …and nothing the card says is clipped: name, role word and correo fit their own boxes.
        const clipped = await page.evaluate(() => {
          const hero = document.querySelector("[data-testid='profile-hero']");
          if (!hero) return ["no hero"];
          const out: string[] = [];
          for (const el of Array.from(hero.querySelectorAll<HTMLElement>("h2, [data-testid='profile-shoulder'], [data-testid='profile-correo']"))) {
            if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName}:${el.textContent?.slice(0, 30)}`);
            const r = el.getBoundingClientRect();
            const h = hero.getBoundingClientRect();
            if (r.right > h.right + 1 || r.left < h.left - 1) out.push(`out of card: ${el.textContent?.slice(0, 30)}`);
          }
          return out;
        });
        expect(clipped).toEqual([]);

        // The coal board's motif — ball included — never meets its own copy.
        if (role === "admin" || role === "trainer") {
          const result = await page.evaluate(() => {
            const board = document.querySelector("[data-testid='profile-role-board']") as HTMLElement;
            const ball = board.querySelector("circle[fill='#FFD600']") as SVGCircleElement;
            const b = ball.getBoundingClientRect();
            const motif = (ball.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
            const box = board.getBoundingClientRect();
            const overlaps: string[] = [];
            for (const el of Array.from(board.querySelectorAll<HTMLElement>("p, h2"))) {
              const range = document.createRange();
              range.selectNodeContents(el);
              for (const r of Array.from(range.getClientRects())) {
                if (r.width === 0) continue;
                // The whole motif (table lines, net, dots), not just the ball: white
                // lines under the copy would measure 2:1, so the two must never meet.
                const hit = r.left < motif.right && r.right > motif.left && r.top < motif.bottom && r.bottom > motif.top;
                if (hit) overlaps.push(el.textContent?.slice(0, 24) ?? "");
              }
            }
            return {
              overlaps,
              topRight: b.left + b.width / 2 > box.left + box.width / 2 && b.top + b.height / 2 < box.top + box.height / 2,
            };
          });
          expect(result.overlaps, "no part of the motif may sit under the board's text").toEqual([]);
          expect(result.topRight, "the ball sits in the board's top-right quadrant").toBe(true);
        }

        if (role === "estudiante") {
          const days = Number(await page.getByTestId("profile-coverage").evaluate((el) => parseInt(el.textContent ?? "", 10)));
          expect(days).toBeGreaterThanOrEqual(23);
          expect(days).toBeLessThanOrEqual(25);
        }

        fs.mkdirSync(SCREENS_DIR, { recursive: true });
        await page.screenshot({ path: path.join(SCREENS_DIR, `profile-v2-${role}-${vp.label}.png`), fullPage: true });
      });
    }
  });
}

test("the ball's bounce stops under prefers-reduced-motion", async ({ browser }) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ reducedMotion, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await mockBackend(page, "admin");
    await page.goto("/profile");
    await expect(page.getByTestId("profile-hero")).toBeVisible();
    const name = await page
      .locator("[data-testid='profile-shoulder'] .profile-ball")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe(reducedMotion === "reduce" ? "none" : "profile-ball-bounce");
    await context.close();
  }
});
