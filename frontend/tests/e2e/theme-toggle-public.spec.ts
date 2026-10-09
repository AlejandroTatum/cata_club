/**
 * The theme choice on the public pages (S11): /login and the other auth screens
 * and the landing both carry the toggle, share the `cata_theme` key with the
 * panel, and pass the same contrast bar as the app in both themes.
 *
 * No backend is needed: these pages render without a session. The strict CSP is
 * part of the contract (the pre-paint script is the layout's nonce'd one), so
 * any CSP violation reported by the browser fails the run.
 */

import { test, expect, type Page } from "@playwright/test";
import { scanContrast } from "./helpers/contrast-scan";

const STORAGE_KEY = "cata_theme";
const AUTH_PAGES = ["/login", "/forgot-password", "/reset-password?token=x", "/verificar-correo"];

function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to (execute|load|apply)/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function theme(page: Page): Promise<string | null> {
  return page.locator("html").getAttribute("data-theme");
}

test.describe("theme toggle on the public pages", () => {
  test.use({ reducedMotion: "reduce" });

  for (const path of AUTH_PAGES) {
    test(`${path} offers the toggle, applies it and remembers it`, async ({ page }) => {
      const csp = watchCsp(page);
      await page.addInitScript((key) => localStorage.setItem(key, "light"), STORAGE_KEY);
      await page.goto(path);

      const toggle = page.getByRole("button", { name: "Modo oscuro" });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await toggle.click();

      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe("dark");
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(csp).toEqual([]);
    });
  }

  test("the choice made on /login is the one the landing opens with, and back", async ({ page }) => {
    const csp = watchCsp(page);
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("cata_theme", "light");
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto("/login");
    await page.getByRole("button", { name: "Modo oscuro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const landingToggle = page.getByRole("navigation", { name: "Navegación principal" }).getByRole("button", { name: "Modo oscuro" });
    await expect(landingToggle).toHaveAttribute("aria-pressed", "true");

    await landingToggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(csp).toEqual([]);
  });

  for (const width of [390, 360]) {
    test(`the landing toggle is tappable on a ${width}px phone and the lockup, toggle and ENTRAR stay on one row`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      const navbar = page.getByRole("navigation", { name: "Navegación principal" });
      const toggle = navbar.getByRole("button", { name: "Modo oscuro" });
      await expect(toggle).toBeVisible();
      const box = (await toggle.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // One row: the actions start no lower than the lockup's own bottom edge.
      const logo = (await page.locator(".landing-logo").boundingBox())!;
      const actions = (await page.locator(".landing-nav-actions").boundingBox())!;
      expect(actions.y, "actions wrapped under the lockup").toBeLessThan(logo.y + logo.height - 8);
      // No page-wide horizontal overflow.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe("public pages meet the contrast bar in both themes", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(120_000);

  for (const mode of ["light", "dark"] as const) {
    for (const [label, path] of [["landing", "/"], ["login", "/login"]] as const) {
      test(`${label} (${mode})`, async ({ page }) => {
        await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, mode]);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(path);
        await settle(page);
        expect(await theme(page)).toBe(mode);

        const report: string[] = [];
        // The landing reveals sections on scroll: walk it so every band is painted at rest.
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0; y < height; y += 600) {
            await page.evaluate((top) => window.scrollTo(0, top), y);
            await page.waitForTimeout(60);
          }
          await page.waitForTimeout(500);
          const { failures } = await page.evaluate(scanContrast);
          for (const f of failures) {
            report.push(`[${viewport.width}] ${f.selector}  "${f.text}"  fg ${f.fg} on ${f.bg}  ${f.ratio}:1 < ${f.required}:1`);
          }
        }
        expect(report, `${report.length} contrast failures:\n${report.join("\n")}`).toEqual([]);
      });
    }
  }
});
