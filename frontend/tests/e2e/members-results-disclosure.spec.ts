import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

/** Resolved in ONE place — see `e2e-target.ts` for why it is not port 3000. */
const BASE_URL = E2E_BASE_URL;
const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
const ACCOUNT = {
  id: "1",
  role: "representante",
  nombres: "María",
  apellidos: "González",
  email: "maria@example.test",
  telefono: "0999999999",
  estudiantes: [{
    id: "10",
    nombres: "Sofía",
    apellidos: "González",
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
  }],
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockMembersRuntime(page: Page, accounts = [ACCOUNT], personasCapped = false): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: MOCK_ACCESS_TOKEN, url: BASE_URL }]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, {
    user: { id: "1", name: "Admin Demo", email: "admin@example.test", role: "admin", representanteId: null },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-07-21T00:00:00.000Z",
  }));
  await page.route("**/api/members", (route: Route) => fulfillJson(route, { accounts, niveles: [], personasCapped }));
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) => fulfillJson(route, []));
}

test("members disclose visible results and essential membership information at 390px without pagination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMembersRuntime(page);

  await page.goto("/members");

  await expect(page.getByRole("status", { name: "Resultados mostrados" })).toHaveText("1 resultados mostrados");

  /*
   * Below `sm` an account is now a card (members/page.tsx `AccountCard`), not
   * a five-column table row with most of its cells CSS-hidden. The assertion
   * that identity and status are ON SCREEN at 390px is unchanged in intent —
   * it just reads the card. It is scoped to the account's own list item so a
   * name rendered anywhere else on the page cannot satisfy it.
   */
  const accountCard = page.getByRole("listitem").filter({ hasText: "María González" });
  await expect(accountCard.getByText("María González")).toBeVisible();
  await expect(accountCard.getByText("Activo", { exact: true })).toBeVisible();
  // The contact details the old phone layout dropped are disclosed too — the
  // card is the whole account, not a truncated view of it.
  await expect(accountCard.getByText("0999999999")).toBeVisible();
  // …and the wide desktop table is still not what a phone is served.
  await expect(page.getByRole("columnheader", { name: "Contacto" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: /paginación/i })).toHaveCount(0);

  // Membership info lives in the account's Editar modal (the row does not
  // expand) — one card per student under "Estudiantes a cargo".
  //
  // Exactly ONE edit trigger is reachable here. The old layout left two per
  // account (the desktop cell plus a mobile duplicate) and the previous
  // version of this test worked around that with a `:visible` CSS filter;
  // asserting the count instead pins the fix rather than tolerating it.
  const edit = page.getByRole("button", { name: "Editar María González" });
  await expect(edit).toHaveCount(1);
  await edit.click();
  const dialog = page.getByRole("dialog");
  const membershipTerm = dialog.getByRole("term").filter({ hasText: "Membresía" });
  await expect(membershipTerm).toBeVisible();
  // Not just the label: the membership's actual state is what the admin came
  // for. Read from the term's own <dd> — the dialog carries other "Activa"
  // badges, and a page-wide text match would be satisfied by any of them.
  await expect(
    membershipTerm.locator("xpath=..").getByRole("definition"),
  ).toHaveText("Activa");
});

test("members show an incomplete-coverage notice when 200 personas collapse into one account", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMembersRuntime(page, [ACCOUNT], true);

  await page.goto("/members");

  await expect(page.getByRole("status", { name: "Resultados mostrados" })).toHaveText("1 resultados mostrados");
  await expect(page.getByText(/La fuente devuelve hasta 200 registros/)).toContainText("puede estar incompleto");
  await expect(page.getByRole("navigation", { name: /paginación/i })).toHaveCount(0);
});
