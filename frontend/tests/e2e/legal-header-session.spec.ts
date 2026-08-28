/**
 * Lock — issue #782: on a public legal page, the header's session slot must
 * never offer "Iniciar sesión" to somebody who is already inside.
 *
 * ## Why an e2e test and not only a jsdom assertion
 *
 * `src/components/__tests__/Header.test.tsx` proves the three states of the
 * slot by handing the component a session that is already resolved, loading,
 * or absent. What it cannot prove is the ORDER those states arrive in for a
 * real visitor, because that order is not the component's to choose: the
 * session lives behind an `HttpOnly` cookie only the BFF can read, so the
 * server renders the bar knowing nothing, and the answer lands one round trip
 * after hydration. Under vitest that round trip does not exist.
 *
 * The defect this guards is therefore a WINDOW, not a state: a slot that
 * defaults to the anonymous answer looks correct in every unit test and still
 * flashes "Iniciar sesión" at every signed-in reader for as long as the
 * session request takes. Holding that request open here makes the window wide
 * enough to observe, and asserting inside it is the only way to say the
 * placeholder is doing its job.
 *
 * One `page.goto`, on the lightest page that draws this bar — the e2e budget
 * on a 4-vCPU runner is the constraint (see `site-navigation.spec.ts`).
 */
import { test, expect, type Route } from "@playwright/test";

/** The account of somebody reading the terms from inside the product. */
const SIGNED_IN_SESSION = {
  user: {
    id: "1",
    name: "Admin Demo",
    email: "admin@example.test",
    role: "admin",
    representanteId: null,
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-08-27T00:00:00.000Z",
};

test.describe("legal pages and a live session (issue #782)", () => {
  test("never offers 'Iniciar sesión' to a reader who is already signed in", async ({ page }) => {
    // The session answer, held until this test lets it go.
    let answer: () => void = (): void => {};
    const held = new Promise<void>((resolve): void => {
      answer = resolve;
    });

    await page.route("**/api/auth/session", async (route: Route): Promise<void> => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SIGNED_IN_SESSION),
      });
    });
    // Polled by the header once a session exists; answered here so the page
    // under test never waits on a backend it does not need.
    await page.route("**/api/ranking/notificaciones/mias", (route: Route): Promise<void> =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, skip: 0, limit: 20 }),
      }),
    );

    await page.goto("/terminos");

    const loginLink = page.locator("header a[href='/login']");
    const accountMenu = page.getByRole("button", { name: /Menú de cuenta/i });

    // The bar is already drawn — the part of it that depends on no session.
    await expect(page.locator("header nav ul a")).toHaveCount(6);
    // …and while the answer is outstanding it names neither state. A login
    // link here is the whole defect: it is what the reader sees first, and
    // what he clicks before the real answer ever arrives.
    await expect(loginLink).toHaveCount(0);
    await expect(accountMenu).toHaveCount(0);

    answer();

    await expect(accountMenu).toBeVisible();
    await expect(loginLink).toHaveCount(0);
  });
});
