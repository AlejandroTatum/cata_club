/**
 * BackLink navigation + toast coverage.
 *
 * Logs in as the admin demo persona (same network-mock pattern as
 * admin-smoke.spec.ts — /api/auth/* intercepted at the network level, no
 * seeded backend), then covers two concerns added across 9 pages:
 *
 * 1. Getting back out of a screen is always a real next/link `<a href>` to a
 *    fixed parent route — never router.back(). Admin top-level destinations
 *    (/members, /payments) dropped their in-page BackLink — they are reached
 *    from the sidebar and left the same way — so the guarantee is checked on
 *    the sidebar's own "Panel de Control" link. The trainer flow still
 *    renders the shared BackLink (src/components/BackLink.tsx).
 * 2. useToast() (src/contexts/ToastContext.tsx) surfaces a visible toast
 *    after a mutating action — covered here via /payments' reject flow
 *    (error path, since it needs no extra setup beyond one mocked request).
 */
import { test, expect, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

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
  // The catch-all above answers every GET with `[]`, but the bell (issue #281)
  // reads `data.items` — an array breaks it. Last-registered wins, so this
  // specific route overrides the catch-all.
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
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
  test("members: the way back to /dashboard is a real sidebar link, not router.back()", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/members", (route) =>
      fulfillJson(route, { accounts: [], personasCapped: false }),
    );

    await page.goto("/members");
    const home = page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Panel de Control", exact: true });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute("href", "/dashboard");

    await home.click();
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
    // A 1×1 transparent PNG rather than a placehold.co URL: the proof preview
    // is a plain <img>, and the only external request the suite made was this
    // one. Inline, the preview resolves the same way on every machine.
    proofPreviewUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    validationStatus: "pendiente",
  };

  test("payments: the way back to /dashboard is a real link, and a failed reject shows an error toast", async ({ page }) => {
    await loginAsAdmin(page);
    // The trailing `*` is load-bearing (issue #400, criterio 4/5): every GET
    // now carries `?skip=&limit=…`, which an exact `**/api/payments` glob
    // (no wildcard) does NOT match — the request fell through to the real
    // network instead of this mock. `**/api/payments*` still does not swallow
    // the more specific `**/api/payments/pay-1` route below (`*` never
    // crosses a `/`).
    await page.route("**/api/payments*", (route) => {
      // Issue #400 (criterio 4/5): `/api/payments` now answers
      // `{ items, total }` (real pagination), not a bare array.
      if (route.request().method() === "GET") {
        return fulfillJson(route, { items: [PAYMENT_ROW], total: 1 });
      }
      return route.fallback();
    });
    // updatePaymentValidation() (src/services/api.ts) sends PUT, not PATCH.
    await page.route("**/api/payments/pay-1", (route) => {
      if (route.request().method() === "PUT") {
        // The status (500) is what drives the assertion below, not this body:
        // `toUserMessage` never reads a 5xx's `detail`/`message`, so this text
        // is deliberately never shown anywhere — it just has to be a plausible
        // failed-request body.
        return fulfillJson(route, { error: "server_error", message: "No se pudo procesar el rechazo." }, 500);
      }
      // GET is `reportRealOutcomeAfterFailure`'s (src/app/payments/page.tsx)
      // re-check via `fetchPaymentValidationById` — issue #456 never shows a
      // "failed" toast without first confirming, from the server, that the
      // write really didn't land. Answer with the SAME still-`pendiente` row:
      // without this route the request fell through to the generic `**/api/**`
      // catch-all above, which answers every GET with `[]`. An empty array's
      // `.validationStatus` reads `undefined`, which `!== "pendiente"` is
      // true — so the re-check code wrongly concluded the write had landed
      // anyway and showed the "se confirmó, aunque la conexión falló" warning
      // instead of the real error this test asserts on below.
      return fulfillJson(route, PAYMENT_ROW);
    });

    await page.goto("/payments");

    /*
     * /payments no longer renders a BackLink: the redesign made it a top-level
     * destination, and those are entered and left through the sidebar rather
     * than through an in-page "Volver al Panel" that duplicated it. The user
     * outcome the old assertion protected — an admin on /payments can always
     * get back to the dashboard, by a REAL link to a fixed route and not by
     * router.back() — is unchanged, so it is asserted on the control that now
     * carries it. A history-based control would have no href to assert.
     */
    const home = page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Panel de Control", exact: true });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute("href", "/dashboard");

    // Trigger the reject flow with the mutating request mocked to fail.
    // Open the queued payment through its own action, whose accessible name
    // names the payment it opens — the row's text is not a control.
    const openRequest = page.getByRole("button", {
      name: "Revisar el pago de Sofía González",
    });
    await openRequest.click();
    await page.getByRole("button", { name: "Rechazar pago…" }).click();
    // A reason is mandatory (composeRejectionReason returns "" without one and
    // the submit stays disabled), so the flow has to pick one — this is the
    // rejection the payload would carry.
    await page.getByRole("radio", { name: "El comprobante no se lee" }).check();
    await page
      .getByRole("textbox", { name: /nota para el responsable/i })
      .fill("El comprobante está borroso.");
    await page.getByRole("button", { name: "Rechazar y avisar" }).click();

    /*
     * Issue #456 retired the deferred "Deshacer" hold (`useDeferredCommit` /
     * `src/lib/deferred-commit.ts` — both gone): the request fires the moment
     * the admin confirms, and `decide()` (src/app/payments/page.tsx) never
     * declares success or failure before the real PUT resolves. On failure it
     * does not assume "nothing happened" either — `reportRealOutcomeAfterFailure`
     * re-fetches the payment's real state first (mocked via the GET branch on
     * the payments/pay-1 route above, still `pendiente`), confirms the write
     * never landed, and only then shows the error. So the toast can land as
     * soon as that PUT + GET round trip completes — no fixed window to wait out.
     *
     * The mocked failure is a 500, and `toUserMessage` (src/lib/error-message.ts)
     * deliberately gives every 5xx the SAME generic sentence app-wide, no matter
     * what the caller's own fallback text says — a 5xx `detail` describes the
     * SERVER's failure, never the user's business, so there is nothing
     * operation-specific worth showing (see `error-message.test.ts`, "gives
     * every 5xx the same answer, whatever the body said").
     */
    await expect(
      page.getByRole("alert").filter({ hasText: /problema de nuestro lado/i }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // And its description names the payment, so the admin knows what to redo
    // (the exact copy `reportRealOutcomeAfterFailure` uses once the re-check
    // confirms the payment is still pending — see payments/page.tsx).
    await expect(
      page.getByRole("alert").filter({ hasText: /sigue en la cola de pendientes/i }).first(),
    ).toBeVisible();

    // The detail view carries its own way back to the queue, and a failed
    // rejection must leave the payment where it was rather than swallow it.
    // It is a real `BackLink` (a link, not a button) since the redesign put
    // the control through the design system's shared back-navigation piece.
    //
    // The label comes from `lib/destinations.ts`, not from this screen: the
    // registry lists "Volver a la cola" as one of the four hand-written
    // spellings it replaced, so asserting it here was asserting the defect.
    // A back control names its DESTINATION, and the destination is the
    // section, not the shape it happens to have on that screen.
    await page.getByRole("link", { name: /volver a membresías y pagos/i }).click();
    await expect(openRequest).toBeVisible();

    await home.click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
