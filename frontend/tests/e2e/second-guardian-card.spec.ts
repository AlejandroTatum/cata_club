import { expect, test, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const SESSION = {
  user: { id: "7", name: "Laura Vera", email: "laura@cataclub.test", role: "representante", representanteId: null },
  roles: ["REPRESENTANTE"], loggedInAt: "2026-10-05T00:00:00.000Z",
};

const PORTAL = {
  self: null,
  representados: [{
    personaId: "42", nombres: "Mateo", apellidos: "Vera", fechaNacimiento: "2014-05-12",
    recentSessions: [], membership: null, representante: null, representanteId: 7,
  }],
  membershipPlans: [],
};

// Every API boundary is mocked; no account, e-mail or database is touched.
async function mockPortal(page: Page, minors: unknown[], onInvite?: (body: unknown) => void) {
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/auth/session") return respond(SESSION);
    if (path === "/api/student") return respond(PORTAL);
    // The portal reads the selected child's payments and schedule as plain lists.
    if (path.startsWith("/api/membresias/pagos/persona/") || path.startsWith("/api/asistencias/alumnos/")) return respond([]);
    if (path === "/api/co-representantes/mios") return respond(minors);
    if (path === "/api/co-representantes/invitaciones") {
      onInvite?.(route.request().postDataJSON());
      return respond({ estado: "INVITADO", personaIds: [42] }, 201);
    }
    return respond({ items: [], total: 0, skip: 0, limit: 20 });
  });
}

const MENOR = { personaId: 42, nombres: "Mateo", apellidos: "Vera", segundoGuardian: null, completo: false };

test("the primary representative invites a second guardian from the home", async ({ page }) => {
  let sent: unknown;
  await mockPortal(page, [{ ...MENOR, rol: "PRINCIPAL" }], (body) => { sent = body; });

  await page.goto("/student");
  await page.getByRole("button", { name: /invitar a otro representante/i }).click();
  await page.getByLabel(/correo de la persona a invitar/i).fill("pablo@cataclub.test");
  await page.getByLabel("Nombres").fill("Pablo");
  await page.getByLabel("Apellidos").fill("Torres");
  await page.getByLabel("Cédula").fill("1710034065");
  await page.getByLabel("Fecha de nacimiento").fill("1982-04-04");
  await page.getByLabel("Teléfono").fill("0991234567");
  const request = page.waitForRequest("**/api/co-representantes/invitaciones");
  await page.getByRole("button", { name: /enviar invitación/i }).click();
  await request;

  expect(sent).toEqual({
    personaIds: [42],
    correo: "pablo@cataclub.test",
    datos: { nombres: "Pablo", apellidos: "Torres", cedula: "1710034065", fechaNacimiento: "1982-04-04", telefono: "0991234567" },
  });
});

test("a second guardian sees no invite button", async ({ page }) => {
  await mockPortal(page, [{ ...MENOR, rol: "SEGUNDO", completo: true }]);

  await page.goto("/student");
  await expect(page.getByText(/eres su segundo representante/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /invitar a otro representante/i })).toHaveCount(0);
});
