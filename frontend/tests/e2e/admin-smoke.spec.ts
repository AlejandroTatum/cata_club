/**
 * Smoke test: admin login → dashboard → members page.
 *
 * Verifies the core admin navigation flow works end-to-end:
 * 1. Login as admin demo persona.
 * 2. Dashboard loads with expected content.
 * 3. Navigate to /members and confirm the page renders.
 *
 * This is a deterministic smoke test — it covers the happy path only.
 * Full regression coverage belongs in unit tests.
 *
 * Login now goes through the real BFF (POST /api/auth/login → FastAPI), and
 * this environment has no seeded backend to log into. The BFF's own
 * request/response contract (form-encoding, cookie attributes, error
 * mapping) is already covered by the route-handler unit tests in
 * src/app/api/auth/__tests__/. This spec instead intercepts the same-origin
 * /api/auth/* routes at the network level so it can exercise the real
 * frontend flow — form submit, redirect, protected navigation — without
 * depending on FastAPI or seeded data.
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

// A syntactically plausible JWT (3 non-empty dot-separated segments) —
// satisfies middleware.ts's coarse cookie-presence check. Never a real
// token; nothing decodes it in this mocked flow.
const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

const AUTHENTICATED_HEADERS = {
  "set-cookie": `access_token=${MOCK_ACCESS_TOKEN}; Path=/; HttpOnly; SameSite=Lax`,
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

/**
 * Mocks the BFF's same-origin auth routes with a stateful handshake, not a
 * blanket "always authenticated" stub. `/api/auth/session` starts
 * unauthenticated so the app's mount-time hydration (AuthContext calls it
 * before any form interaction) can't alone satisfy the dashboard redirect —
 * only a genuine POST to `/api/auth/login`, carrying the expected
 * credentials, flips the mock to authenticated. This is what actually
 * proves the login FORM works, not just that a cookie happens to exist.
 */
async function mockAuthRoutes(page: Page): Promise<void> {
  let authenticated = false;

  // A catch-all first: the shell asks for more than this screen does, and an
  // unanswered call reaches the real BFF, fails, and logs the session out.
  // This walk goes dashboard -> members -> attendance, and the dashboard's
  // AppShell alone calls `/api/dashboard` for the admin's pending-payments
  // badge before either page under test is even reached.
  await page.route("**/api/**", (route: Route) =>
    route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {}),
  );
  // The catch-all above answers every GET with `[]`, but the bell (issue #281)
  // reads `data.items` — an array breaks it. Last-registered wins, so this
  // specific route overrides the catch-all.
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  // The members page destructures `{ accounts }` from the response — the
  // catch-all's bare `[]` has no such property and would leave `accounts`
  // undefined, crashing the render this test still walks through.
  await page.route("**/api/members", (route: Route) =>
    fulfillJson(route, { accounts: [], personasCapped: false }),
  );
  // Issue #400 (criterio 4/5): `/api/payments` answers `{ items, total }`
  // (real pagination), not a bare array — the dashboard's
  // `fetchPaymentValidations()` reads `result.items`, which the catch-all's
  // `[]` leaves `undefined` and crashes `buildActivityFeed` on render. The
  // trailing `*` matches the `?skip=&limit=…` query string every GET here
  // carries; an exact `**/api/payments` glob does not.
  await page.route("**/api/payments*", (route: Route) =>
    fulfillJson(route, { items: [], total: 0 }),
  );

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

test.describe("Admin smoke", () => {
  test("login as admin, reach dashboard, open members page", async ({ page }) => {
    await mockAuthRoutes(page);

    // ── Step 1: Navigate to login page ──
    await page.goto("/login");
    // Wait for auth skeleton to resolve and the form to render (stable user-visible control)
    await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /bienvenido/i })).toBeVisible();

    // ── Step 2: Fill in admin credentials ──
    await page.getByLabel(/correo electrónico/i).fill("admin@cataclub.com");
    await page.getByRole("textbox", { name: /contraseña/i }).fill("admin123");
    await page.getByRole("button", { name: /iniciar sesión/i }).click();

    // ── Step 3: Verify redirect to dashboard ──
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /panel de control/i })).toBeVisible();

    // ── Step 4: Navigate to members page via nav link ──
    // Use exact name to match the sidebar "Miembros" link, not the dashboard
    // quick action "Gestionar Miembros" which has a different accessible name.
    await page.getByRole("link", { name: "Miembros", exact: true }).click();
    await expect(page).toHaveURL(/\/members/);
    // Every authenticated screen now states its own name through the shell's
    // PageHeader (AppShell -> PageHeader renders the real, visible <h1>), so
    // the page's title is "Miembros" and not the old in-content "Miembros del
    // Club". Pinned by level AND exact name: the point of the assertion is
    // that the screen announces itself as the page's top-level heading, which
    // a substring match against some section heading would not prove.
    await expect(
      page.getByRole("heading", { name: "Miembros", exact: true, level: 1 }),
    ).toBeVisible();

    // ── Step 5: Navigate to attendance page ──
    await page.getByRole("link", { name: "Asistencias", exact: true }).click();
    await expect(page).toHaveURL(/\/attendance/);
    await expect(
      page.getByRole("heading", { name: "Asistencias", exact: true, level: 1 }),
    ).toBeVisible();
  });
});
