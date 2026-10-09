/**
 * #1668 — every state of the member payments page at 1440px and 390px: ONE
 * primary action, no horizontal overflow, and (when `PAGOS_SHOTS_DIR` is set)
 * a screenshot of each state for the design review. The runtime is fully
 * mocked, so what is measured is the layout, not the QA database.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const BASE_URL = E2E_BASE_URL;
const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
const SHOTS_DIR = process.env.PAGOS_SHOTS_DIR;

const membresia = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "10",
  tipo: "Mensual Infantil",
  estado: "activa",
  fechaInicio: "2026-09-01",
  fechaFin: "2026-09-30",
  cubiertoHasta: "2026-10-31",
  monto: 25,
  esGratuidadFamiliar: false,
  mesesAdeudados: 0,
  ...extra,
});

const accountWith = (student: Record<string, unknown>): Record<string, unknown> => ({
  id: "1",
  role: "estudiante",
  nombres: "Mateo",
  apellidos: "Prueba",
  email: "mateo@example.test",
  telefono: "0999999999",
  estudiantes: [{ id: "10", nombres: "Mateo", apellidos: "Prueba", grupoId: null, activo: true, membresia: null, ultimoPago: null, ...student }],
});

const pago = (extra: Record<string, unknown>): Record<string, unknown> => ({
  id: 9,
  monto: "25.00",
  motivoRechazo: null,
  estadoPago: "APROBADO",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-09-22T10:00:00",
  fechaValidacion: "2026-09-23T10:00:00",
  fechaInicio: "2026-09-22",
  fechaFin: "2026-10-21",
  personaId: 10,
  membresiaId: 10,
  voucherUrl: null,
  voucherFormato: null,
  comprobanteOficialUrl: null,
  ...extra,
});

interface Scenario {
  name: string;
  account: Record<string, unknown>;
  pagos: Array<Record<string, unknown>>;
  action: string;
}

const SCENARIOS: Scenario[] = [
  { name: "sin-membresia", account: accountWith({}), pagos: [], action: "tipo-socio" },
  {
    name: "pendiente",
    account: accountWith({
      membresia: membresia({ estado: "vencida", estadoBackend: "INACTIVA", cubiertoHasta: null }),
      ultimoPago: { estado: "pendiente_validacion", fechaPago: "2026-10-06", monto: 25, periodo: "" },
    }),
    pagos: [pago({ id: 10, estadoPago: "PENDIENTE_VALIDACION", fechaValidacion: null, fechaInicio: "2026-10-01", fechaFin: "2026-10-31", voucherUrl: "https://files.example/voucher.pdf" })],
    action: "revisar-pago",
  },
  {
    name: "vencida",
    account: accountWith({
      membresia: membresia({ estado: "vencida", cubiertoHasta: "2026-07-31", mesesAdeudados: 2, montoAdeudado: 50 }),
      ultimoPago: { estado: "aprobado", fechaPago: "2026-07-01", monto: 25, periodo: "" },
    }),
    pagos: [pago({ fechaInicio: "2026-07-01", fechaFin: "2026-07-31" })],
    action: "registrar-pago",
  },
  {
    name: "activo",
    account: accountWith({
      membresia: membresia(),
      ultimoPago: { estado: "aprobado", fechaPago: "2026-09-22", monto: 25, periodo: "" },
    }),
    pagos: [pago({})],
    action: "registrar-pago",
  },
];

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockRuntime(page: Page, scenario: Scenario): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: MOCK_ACCESS_TOKEN, url: BASE_URL }]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, {
    user: { id: "1", name: "Admin Dev", email: "admin@example.test", role: "admin", representanteId: null },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-07-21T00:00:00.000Z",
  }));
  await page.route("**/api/dashboard", (route: Route) => fulfillJson(route, {}));
  await page.route("**/api/members/1", (route: Route) => fulfillJson(route, { account: scenario.account }));
  await page.route("**/api/ranking/notificaciones/mias*", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/personas/*/beneficio", (route: Route) => fulfillJson(route, null));
  await page.route("**/api/membresias/pagos/persona/*", (route: Route) => fulfillJson(route, scenario.pagos));
  await page.route("**/api/membresias/pagos/9", (route: Route) => fulfillJson(route, scenario.pagos[0]));
  await page.route("**/api/membresias/pagos/9/correcciones", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/membresias/tipos**", (route: Route) =>
    fulfillJson(route, [{ id: 1, categoria: "MENSUAL_INFANTIL", nombre: "Mensual Infantil", precio: 25, activo: true }]),
  );
  await page.route("**/api/descuentos**", (route: Route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 200 }));
}

async function expectNoSidewaysOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string, width: number): Promise<void> {
  if (!SHOTS_DIR) return;
  await page.screenshot({ path: `${SHOTS_DIR}/1668-ux-${name}-${width === 390 ? "mobile" : "desktop"}.png`, fullPage: true });
}

for (const width of [1440, 390]) {
  test.describe(`member payments page at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });

    for (const scenario of SCENARIOS) {
      test(`${scenario.name}: one primary action and no sideways overflow`, async ({ page }) => {
        await mockRuntime(page, scenario);
        await page.goto("/members/1/pagos");

        await expect(page.locator("[data-primary-action]")).toHaveCount(1);
        await expect(page.locator("[data-primary-action]")).toHaveAttribute("data-primary-action", scenario.action);
        await expect(page.getByRole("heading", { name: "Mateo Prueba" })).toBeVisible();
        await expectNoSidewaysOverflow(page);
        await shot(page, scenario.name, width);
      });
    }

    test("first payment: both choices open as guided steps with a «Cancelar»", async ({ page }) => {
      await mockRuntime(page, SCENARIOS[0]);
      await page.goto("/members/1/pagos");

      await page.getByRole("button", { name: /^Socio nuevo/ }).click();
      await expect(page.getByText(/paso 1 de 2/i)).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancelar" })).toBeVisible();
      await expectNoSidewaysOverflow(page);
      await shot(page, "socio-nuevo", width);

      await page.getByRole("button", { name: "Cancelar" }).click();
      await page.getByRole("button", { name: /^Socio antiguo/ }).click();
      await expect(page.getByLabel(/fecha de su último pago/i)).toBeVisible();
      await expectNoSidewaysOverflow(page);
      await shot(page, "socio-antiguo", width);
    });

    test("correction form opens under the approved payment, stating what it changes", async ({ page }) => {
      await mockRuntime(page, SCENARIOS[3]);
      await page.goto("/members/1/pagos");

      await page.getByRole("button", { name: "Corregir monto o meses" }).click();
      await expect(page.getByRole("heading", { name: /corregir el pago de \$25,00 del 22\/09 al 21\/10/i })).toBeVisible();
      await page.getByLabel(/^hasta/i).fill("2026-10-31");
      await page.getByLabel(/^motivo/i).fill("Se registró el mes equivocado");
      await expect(page.getByText("Hasta: 21/10/2026 → 31/10/2026")).toBeVisible();
      await expectNoSidewaysOverflow(page);
      await shot(page, "correccion", width);
    });
  });
}
