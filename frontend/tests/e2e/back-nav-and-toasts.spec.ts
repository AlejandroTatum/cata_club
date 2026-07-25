/**
 * BackLink navigation + toast coverage.
 *
 * Logs in as the admin demo persona (same network-mock pattern as
 * admin-smoke.spec.ts — /api/auth/* intercepted at the network level, no
 * seeded backend), then covers two concerns added across 9 pages:
 *
 * 1. The shared BackLink (src/components/BackLink.tsx) renders a real
 *    next/link `<a href>` to a fixed parent route — never router.back() —
 *    on /members, /payments, and /ranking.
 * 2. useToast() (src/contexts/ToastContext.tsx) surfaces a visible toast
 *    after a mutating action — covered here via /payments' reject flow
 *    (error path, since it needs no extra setup beyond one mocked request).
 */
import { test, expect, type Page, type Route } from "@playwright/test";

const MOCK_SESSION = {
  user: {
    id: "1",
    name: "Admin Demo",
    email: "admin@cataclub.com",
    role: "admin" as const,
    representanteId: null,
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: new Date().toISOString(),
};

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
const AUTHENTICATED_HEADERS = {
  "set-cookie": `access_token=${MOCK_ACCESS_TOKEN}; Path=/; HttpOnly; SameSite=Lax`,
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/**
 * Same stateful auth handshake as admin-smoke.spec.ts: /api/auth/session
 * starts unauthenticated, and only a genuine POST to /api/auth/login with
 * the expected credentials flips it — proving the login form itself works,
 * not just that a cookie happens to exist.
 *
 * Registered first, alongside the generic data-endpoint catch-all — both
 * are then overridable by more specific routes a test registers afterwards,
 * since Playwright runs the most-recently-registered matching handler first.
 */
async function mockAuthRoutes(page: Page): Promise<void> {
  let authenticated = false;

  // Generic fallback for any other same-origin /api/* call this spec
  // doesn't care about the contents of: empty array for GET (safe default
  // for list endpoints), empty object otherwise.
  await page.route("**/api/**", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, []);
    return fulfillJson(route, {});
  });

  await page.route("**/api/auth/session", (route: Route): Promise<void> => {
    if (!authenticated) {
      return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: AUTHENTICATED_HEADERS,
      body: JSON.stringify(MOCK_SESSION),
    });
  });

  await page.route("**/api/auth/login", async (route: Route): Promise<void> => {
    const body = route.request().postDataJSON() as { email?: string; password?: string };
    if (body?.email !== "admin@cataclub.com" || body?.password !== "admin123") {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_credentials", message: "Credenciales inválidas." }),
      });
    }
    authenticated = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: AUTHENTICATED_HEADERS,
      body: JSON.stringify(MOCK_SESSION),
    });
  });
}

async function loginAsAdmin(page: Page): Promise<void> {
  await mockAuthRoutes(page);
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill("admin@cataclub.com");
  await page.getByRole("textbox", { name: /contraseña/i }).fill("admin123");
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

test.describe("Back navigation + toasts", () => {
  test("members: BackLink is a real link to /dashboard, not router.back()", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/members", (route) =>
      fulfillJson(route, { accounts: [], niveles: [], personasCapped: false }),
    );

    await page.goto("/members");
    const back = page.getByRole("link", { name: /volver al panel/i });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/dashboard");

    await back.click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("ranking (admin): BackLink -> /dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/members", (route) =>
      fulfillJson(route, { accounts: [], niveles: [], personasCapped: false }),
    );

    await page.goto("/ranking");
    const back = page.getByRole("link", { name: /volver al panel/i });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/dashboard");

    await back.click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  const PAYMENT_ROW = {
    id: "pay-1",
    studentName: "Sofía González",
    responsablePagoName: "María González",
    membershipPeriod: "2026-07",
    membershipType: "mensual",
    expectedAmount: 85,
    paymentMethod: "transferencia",
    uploadedAt: "2026-07-20T00:00:00.000Z",
    currentMembershipStatus: "pendiente",
    proofFileName: "voucher.png",
    proofFileType: "image",
    proofPreviewUrl: "https://placehold.co/600x400.png",
    validationStatus: "pendiente",
  };

  test("payments: BackLink -> /dashboard, and a failed reject shows an error toast", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/payments", (route) => {
      if (route.request().method() === "GET") return fulfillJson(route, [PAYMENT_ROW]);
      return route.fallback();
    });
    // updatePaymentValidation() (src/services/api.ts) sends PUT, not PATCH.
    await page.route("**/api/payments/pay-1", (route) => {
      if (route.request().method() === "PUT") {
        return fulfillJson(route, { error: "server_error", message: "No se pudo procesar el rechazo." }, 500);
      }
      return route.fallback();
    });

    await page.goto("/payments");
    const back = page.getByRole("link", { name: /volver al panel/i });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/dashboard");

    // Trigger the reject flow with the mutating request mocked to fail.
    await page.getByText("Sofía González").first().click();
    await page.getByRole("button", { name: /rechazar/i }).first().click();
    await page.getByRole("textbox").last().fill("Comprobante ilegible");
    await page.getByRole("button", { name: /rechazar solicitud|confirmar rechazo|rechazar/i }).last().click();

    await expect(
      page.getByRole("alert").filter({ hasText: /error al rechazar el pago/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // BackLink is intentionally hidden while a request's detail view is
    // open (`{!selectedRequest && <BackLink .../>}` in payments/page.tsx)
    // — return to the list first, then confirm it's back and functional.
    await page.getByRole("button", { name: /volver a la lista/i }).click();
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("trainer/nivel: BackLink -> /trainer for the trainer actor (same panel, different role)", async ({ page, baseURL }) => {
    // Session established directly (cookie + /api/auth/session), like
    // members-results-disclosure.spec.ts — no need to drive the login form
    // again here since that path is already covered by the admin login
    // above and by admin-smoke.spec.ts.
    await page.context().addCookies([
      { name: "access_token", value: MOCK_ACCESS_TOKEN, url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.route("**/api/**", (route) => {
      if (route.request().method() === "GET") return fulfillJson(route, []);
      return fulfillJson(route, {});
    });
    await page.route("**/api/auth/session", (route) =>
      fulfillJson(route, {
        user: { id: "2", name: "Trainer Demo", email: "trainer@cataclub.com", role: "trainer", representanteId: null },
        roles: ["ENTRENADOR"],
        loggedInAt: new Date().toISOString(),
      }),
    );
    await page.route("**/api/members", (route) =>
      fulfillJson(route, { accounts: [], niveles: [], personasCapped: false }),
    );

    await page.goto("/trainer/nivel");

    const back = page.getByRole("link", { name: /volver a entrenador/i });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/trainer");

    await back.click();
    await expect(page).toHaveURL(/\/trainer$/);
  });
});
