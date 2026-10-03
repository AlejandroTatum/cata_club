import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const SESSION = {
  user: { id: "7", name: "Laura Vera", email: "laura@cataclub.test", role: "representante", representanteId: null },
  roles: ["REPRESENTANTE"], loggedInAt: "2026-07-21T00:00:00.000Z",
};

// This journey mocks every API boundary; no real payment, account or database is touched.
test("a representative adds a minor and registers the first pending payment", async ({ page }) => {
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/auth/session") return respond(SESSION);
    if (path === "/api/personas/instituciones") return respond([]);
    if (path === "/api/membresias/tipos") return respond([{ id: 3, categoria: "Infantil", precio: "30.00", modalidad: "MENSUAL", activo: true, enUso: false }]);
    if (path === "/api/personas/me/representados") return respond({
      representado: { id: 42, nombres: "Mateo", apellidos: "Vera", cedula: "1798765432", fechaNacimiento: "2014-05-12" },
    }, 201);
    if (path === "/api/membresias/representado/pago") return respond({ id: 91, estadoPago: "PENDIENTE_VALIDACION" }, 201);
    if (path === "/api/student") return respond({ self: null, representados: [], membershipPlans: [] });
    return respond({ items: [], total: 0, skip: 0, limit: 20 });
  });

  await page.goto("/student/add-dependent");
  await page.getByLabel(/^Nombres/).fill("Mateo");
  await page.getByLabel(/^Apellidos/).fill("Vera");
  await page.getByLabel(/^Cédula/).fill("1798765432");
  await page.getByLabel("Día").fill("12");
  await page.getByLabel("Mes", { exact: true }).selectOption("05");
  await page.getByLabel("Año").fill("2014");
  await page.getByRole("button", { name: /siguiente/i }).click();
  await page.getByLabel(/^Tipo de sangre/).selectOption("O_POSITIVO");
  await page.getByRole("button", { name: /siguiente/i }).click();
  await page.getByLabel(/cuándo desea pagar/i).selectOption("now");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /agregar dependiente/i }).click();

  await expect(page.getByText(/el dependiente ya fue agregado/i)).toBeVisible();
  await page.getByLabel(/plan de membresía/i).selectOption("3");
  await page.getByLabel(/medio de pago/i).selectOption("EFECTIVO");
  const paymentRequest = page.waitForRequest("**/api/membresias/representado/pago");
  await page.getByRole("button", { name: /registrar pago/i }).click();
  const payment = await paymentRequest;
  expect(payment.postDataJSON()).toEqual({ personaId: 42, tipoMembresiaId: 3, tipoPago: "EFECTIVO", meses: 1 });
  await expect(page).toHaveURL(/\/student(?:\?|$)/);
});
