/**
 * Lock — issue #771: one navigation for the whole public site, and every link
 * in it reaching a real section from either origin.
 *
 * ## Why an e2e test and not a jsdom assertion
 *
 * `src/components/__tests__/site-navigation-parity.test.tsx` proves the two
 * navbars name the same sections and that the header's hrefs carry the landing's
 * path. It cannot prove the part that actually broke: jsdom neither navigates
 * nor scrolls, so under vitest `/#horarios` and `#horarios` are just two
 * strings. Whether a click lands on the right section — and whether the
 * landing's own click still stays inside the document instead of remounting the
 * page — only a real browser can say.
 *
 * The landing is the heaviest page in the product and the e2e budget on a
 * 4-vCPU runner is the constraint, so the legal-page check stays a single
 * lightweight `page.goto`.
 */
import { test, expect, type Page } from "@playwright/test";

/** The header's own nav, which the legal pages no longer draw. */
const HEADER_NAV = "header nav ul";
/** The landing's own navbar. */
const LANDING_NAV = ".landing-nav-links";

async function navEntries(page: Page, selector: string): Promise<Array<[string, string]>> {
  return page.$$eval(`${selector} a`, (anchors): Array<[string, string]> =>
    anchors.map((anchor): [string, string] => [
      (anchor.textContent ?? "").trim(),
      anchor.getAttribute("href") ?? "",
    ]));
}

test.describe("public navigation (issue #771)", () => {
  test("a legal page draws no section menu, only the way home", async ({ page }) => {
    await page.goto("/terminos");

    // The minimal legal header (client QA): logo and session slot. The landing's
    // section links lead away from the document being read.
    await expect(page.locator(HEADER_NAV)).toHaveCount(0);
    await expect(page.locator("header a[href='/']")).toHaveCount(1);
  });

  test("on the landing, every menu link reaches a real section", async ({ page }) => {
    await page.goto("/");

    const landing = await navEntries(page, LANDING_NAV);
    expect(landing.map(([label]): string => label)).toEqual([
      "Inicio",
      "Valores",
      "Galería",
      "Horarios",
      "Mensualidad",
      "Cómo empezar",
      "Preguntas",
      "Contacto",
      "Patrocinadores",
    ]);

    // "A link to nothing is worse than an inconsistent menu", checked against
    // the rendered document rather than a list.
    const missing = await page.evaluate(
      (hrefs: string[]): string[] =>
        hrefs.filter((href): boolean => document.getElementById(href.replace(/^\/?#/, "")) === null),
      landing.map(([, href]): string => href),
    );
    expect(missing).toEqual([]);
  });

  test("on the landing, the same menu scrolls in place without reloading the page", async ({ page }) => {
    await page.goto("/");

    // A marker only a surviving document keeps. A full navigation — which is
    // what a `/#horarios` href would risk here if the landing ever adopted the
    // off-page form — wipes it.
    await page.evaluate((): void => {
      (window as unknown as { __navProbe?: string }).__navProbe = "same-document";
    });

    const before = await page.evaluate((): number => window.scrollY);
    expect(before).toBe(0);

    await page.locator(`${LANDING_NAV} a`, { hasText: "Horarios" }).click();
    await expect(page.locator("#horarios")).toBeInViewport();

    const probe = await page.evaluate(
      (): string | undefined => (window as unknown as { __navProbe?: string }).__navProbe,
    );
    expect(probe).toBe("same-document");
    expect(await page.evaluate((): number => window.scrollY)).toBeGreaterThan(before);
  });
});

test.describe("public help surface (issue #1374)", () => {
  test("/ayuda answers schedules by linking to the landing's live section", async ({ page }) => {
    await page.goto("/ayuda");

    await expect(page.getByRole("heading", { name: "Preguntas frecuentes" })).toBeVisible();

    // The correction made /ayuda the FAQ alone: no schedule table, no static
    // copy of volatile facts. The answer hands the reader to the one surface
    // that publishes them.
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "¿Cuáles son los horarios?" })).toBeVisible();

    await page.getByRole("button", { name: "¿Cuáles son los horarios?" }).click();
    const link = page.getByRole("link", { name: "Horarios de la página principal" });
    await expect(link).toBeVisible();

    // The anchor is a working one: the click lands on the landing's schedule
    // section, the same destination the site's own "Horarios" nav link uses.
    await link.click();
    await expect(page).toHaveURL(/\/#horarios$/);
    await expect(page.locator("#horarios")).toBeInViewport();
  });
});
