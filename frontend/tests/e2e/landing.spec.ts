/**
 * Landing page E2E smoke test.
 *
 * Verifies the landing page renders correctly and the main CTA navigates
 * to the login page. This is deterministic and uses semantic queries only.
 *
 * The hero was rewritten: the page's single `<h1>` used to be the club's name
 * and is now its promise ("FORMANDO CAMPEONES PARA LA VIDA"), with the name
 * demoted to the brand mark and the kicker above the headline. Both halves of
 * what the old assertion protected are still checked — the hero renders its
 * headline, AND the page still identifies the club — they are just two
 * elements now instead of one.
 */

import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders hero and navigates to login via CTA", async ({ page }) => {
    await page.goto("/");

    // The hero headline is the page's only h1 (LandingPage.tsx `Hero`).
    await expect(
      page.getByRole("heading", {
        name: /formando\s+campeones\s+para\s+la\s+vida/i,
        level: 1,
      })
    ).toBeVisible();

    // The club still names itself — now through the navbar brand mark.
    await expect(page.getByRole("link", { name: /cata club, inicio/i })).toBeVisible();

    // The navbar's quiet "ENTRAR" is the landing's one door to the login form;
    // the hero's loud CTAs go to enrolment instead. Asserting the href as well
    // as the click keeps this a real navigation to a fixed route.
    const cta = page.getByRole("link", { name: /^entrar$/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/login");

    // Navigate to login via CTA
    await cta.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // Assert login form has rendered
    await expect(
      page.getByRole("heading", { name: /bienvenido/i })
    ).toBeVisible({ timeout: 10_000 });
  });
});
