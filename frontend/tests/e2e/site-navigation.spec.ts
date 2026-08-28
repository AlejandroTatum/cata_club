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
 * Two `page.goto` calls, deliberately: the landing is the heaviest page in the
 * product and the e2e budget on a 4-vCPU runner is the constraint. The trip
 * from `/terminos` ends ON the landing, so the "does this section exist"
 * sweep over all six links rides along for free.
 */
import { test, expect, type Page } from "@playwright/test";

/** The header's own nav on the legal pages, never the footer's link columns. */
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
  test("from a legal page, the menu travels to the landing and lands on the section", async ({ page }) => {
    await page.goto("/terminos");

    const header = await navEntries(page, HEADER_NAV);
    expect(header.map(([label]): string => label)).toEqual([
      "Inicio",
      "Horarios",
      "Valores",
      "Logros",
      "Galería",
      "Contacto",
    ]);
    // Every href carries the landing's path. A bare `#horarios` here would name
    // a section of the legal page, which has none: the click would do nothing.
    expect(header.map(([, href]): string => href)).toEqual([
      "/#inicio",
      "/#horarios",
      "/#valores",
      "/#logros",
      "/#galeria",
      "/#contacto",
    ]);

    await page.locator(`${HEADER_NAV} a`, { hasText: "Horarios" }).click();

    await expect(page).toHaveURL(/\/#horarios$/);
    const schedule = page.locator("#horarios");
    await expect(schedule).toBeInViewport();

    // Now that we are on the landing, resolve every destination the header
    // offered. This is the "a link to nothing is worse than an inconsistent
    // menu" clause, checked against the rendered document rather than a list.
    const missing = await page.evaluate(
      (hrefs: string[]): string[] =>
        hrefs.filter((href): boolean => document.getElementById(href.slice(2)) === null),
      header.map(([, href]): string => href),
    );
    expect(missing).toEqual([]);

    // Same menu, same order, on the page we just arrived at.
    const landing = await navEntries(page, LANDING_NAV);
    expect(landing.map(([label]): string => label)).toEqual(header.map(([label]): string => label));
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
