/**
 * Theme contrast sweep: every route each seeded role can reach, in one theme.
 *
 * Owner feedback (design-identity L17): the student WeekPlan day chips showed
 * white text on a light chip in dark mode. The root class was role pages with
 * hard-coded light utilities that no audit had ever visited, so this spec
 * crawls instead of sampling: it logs in as each seeded role, collects every
 * destination from the navigation (sidebar, bottom nav, account menu) plus the
 * in-page tabs, and walks every visible text node asserting WCAG 2.x contrast
 * (>= 4.5:1, or >= 3:1 for large text: >= 24px, or >= 18.66px bold).
 *
 * It talks to a REAL seeded backend (`make seed` / the dev compose), so like the
 * `.live.` specs it is opt-in: `E2E_THEME_SWEEP=1`. Without it the suite stays
 * runnable in any checkout. `E2E_SWEEP_THEME=light` runs the same crawl in
 * light mode, which is the regression proof that a dark fix did not move light.
 *
 * Non-text UI (WCAG 1.4.11, owner feedback L21: the "Para empezar" icon chip,
 * a light icon on a pale chip): every visible Lucide icon is measured too, its
 * stroke colour against the backdrop it is drawn on, at >= 3:1. An icon that
 * sits on a gradient or image is skipped, like text is.
 *
 * Failures are reported as route + selector + colors + ratio.
 */

import { test, expect, type Page } from "@playwright/test";
import { scanContrast } from "./helpers/contrast-scan";
import { loginViaUi } from "./helpers/live-login";

const ENABLED = process.env.E2E_THEME_SWEEP === "1";
const THEME = process.env.E2E_SWEEP_THEME === "light" ? "light" : "dark";
const THEME_STORAGE_KEY = "cata_theme";

interface Role {
  name: string;
  email: string;
  password: string;
  landing: RegExp;
  /** Destinations the navigation does not link to but the role reaches in-page. */
  extra: string[];
}

const ROLES: Role[] = [
  {
    name: "admin",
    email: "admin@cataclub.com",
    password: "admin12345",
    landing: /\/dashboard/,
    extra: ["/members/carnets", "/admin/crear-cuenta"],
  },
  {
    name: "trainer",
    email: "entrenador@cataclub.com",
    password: "trainer12345",
    landing: /\/trainer|\/dashboard/,
    extra: ["/trainer/attendance/history"],
  },
  {
    name: "student",
    email: "ana@cataclub.com",
    password: "alumno123",
    landing: /\/student/,
    extra: [
      "/student/enroll",
      "/student/add-dependent",
      "/student/medical-record",
      "/student/payments",
      "/student/attendance",
    ],
  },
  {
    name: "representante",
    email: "laura@cataclub.com",
    password: "alumno123",
    landing: /\/student/,
    extra: [
      "/student/enroll",
      "/student/add-dependent",
      "/student/medical-record",
      "/student/payments",
      "/student/attendance",
    ],
  },
];

const ALWAYS = ["/profile", "/ayuda"];

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
];

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  // Skeletons and fade-ins: let motion finish so colours are the resting ones.
  await page.waitForTimeout(400);
}

async function navHrefs(page: Page): Promise<string[]> {
  const trigger = page.getByRole("button", { name: /menú de cuenta de/i });
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    await page.waitForTimeout(200);
  }
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a[href], [role='dialog'] a[href]"))
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h.startsWith("/")),
  );
  await page.keyboard.press("Escape");
  return hrefs;
}

function routable(href: string): boolean {
  const path = href.split("?")[0].split("#")[0];
  return path !== "/" && !path.startsWith("/landing") && !path.startsWith("/api") && !path.startsWith("/login");
}

test.describe(`${THEME} contrast sweep across every role`, () => {
  test.skip(!ENABLED, "needs the seeded dev backend; run with E2E_THEME_SWEEP=1");
  test.setTimeout(300_000);

  for (const role of ROLES) {
    test(`${role.name}: every reachable route meets WCAG contrast`, async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => localStorage.setItem(key, value),
        [THEME_STORAGE_KEY, THEME],
      );
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginViaUi(page, role.email, role.password, role.landing);
      await settle(page);

      const routes = new Set<string>([page.url().replace(/^https?:\/\/[^/]+/, "")]);
      for (const href of [...(await navHrefs(page)), ...role.extra, ...ALWAYS]) {
        if (routable(href)) routes.add(href);
      }
      // A member's payment ledger is only linked from rows of /members.
      if (role.name === "admin") {
        await page.goto("/members");
        await settle(page);
        const ledger = await page.evaluate(
          () => document.querySelector<HTMLAnchorElement>("a[href^='/members/'][href$='/pagos']")?.getAttribute("href") ?? null,
        );
        if (ledger) routes.add(ledger);
      }

      const report: string[] = [];
      let total = 0;
      let checkedTotal = 0;
      let skippedTotal = 0;
      let iconsTotal = 0;

      async function scanHere(label: string): Promise<void> {
        const { failures, checked, skipped, iconsChecked } = await page.evaluate(scanContrast);
        checkedTotal += checked;
        iconsTotal += iconsChecked;
        skippedTotal += skipped;
        total += failures.length;
        for (const f of failures) {
          report.push(
            `${label}  ${f.selector}  "${f.text}"  fg ${f.fg} on ${f.bg}  ${f.ratio}:1 < ${f.required}:1  (${f.font})`,
          );
        }
      }

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const route of routes) {
          await page.goto(route);
          await settle(page);
          if (!new URL(page.url()).pathname.startsWith(route.split("?")[0])) continue; // redirected away
          await expect(page.locator("html")).toHaveAttribute("data-theme", THEME);
          await scanHere(`[${viewport.label}] ${route}`);

          // In-page tabs (e.g. the student WeekPlan) hide content until selected.
          const tabs = page.getByRole("tab");
          const count = await tabs.count();
          for (let i = 0; i < count; i++) {
            const tab = tabs.nth(i);
            if (!(await tab.isVisible().catch(() => false))) continue;
            await tab.click().catch(() => undefined);
            await page.waitForTimeout(250);
            await scanHere(`[${viewport.label}] ${route} tab#${i}`);
          }
        }
      }

      console.log(
        `${THEME} sweep ${role.name}: ${routes.size} routes, ${checkedTotal} text nodes and ${iconsTotal} icons checked, ${skippedTotal} on gradients/images skipped, ${total} failures`,
      );
      expect(report, `${total} contrast failures for ${role.name}:\n${report.join("\n")}`).toEqual([]);
    });
  }
});
