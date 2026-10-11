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
 * Failures are reported as route + selector + colors + ratio.
 */

import { test, expect, type Page } from "@playwright/test";
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

interface Failure {
  selector: string;
  text: string;
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  font: string;
}

/** Runs in the page: returns every text node whose contrast is below its bar. */
function scanContrast(): { failures: Failure[]; checked: number; skipped: number } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  type RGBA = [number, number, number, number];
  const cache = new Map<string, RGBA>();
  function parse(css: string): RGBA {
    const hit = cache.get(css);
    if (hit) return hit;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    // getImageData returns premultiplied-undone 8-bit values; alpha is exact enough.
    const out: RGBA = [d[0], d[1], d[2], d[3] / 255];
    cache.set(css, out);
    return out;
  }
  function blend(top: RGBA, under: [number, number, number]): [number, number, number] {
    const a = top[3];
    return [
      top[0] * a + under[0] * (1 - a),
      top[1] * a + under[1] * (1 - a),
      top[2] * a + under[2] * (1 - a),
    ];
  }
  function lum(c: [number, number, number]): number {
    const f = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  const hex = (c: number[]): string =>
    "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  /** Backdrop under `el`: layers bottom-up until the first opaque one. */
  function backdrop(el: Element): { rgb: [number, number, number]; unknown: boolean } {
    const layers: RGBA[] = [];
    let node: Element | null = el;
    let unknown = false;
    let opaque = false;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage !== "none" && /gradient|url/.test(cs.backgroundImage)) {
        // A gradient or image paints behind the text: its colour is not a single value.
        unknown = true;
        break;
      }
      const bg = parse(cs.backgroundColor);
      if (bg[3] > 0) {
        layers.push(bg);
        if (bg[3] >= 0.995) {
          opaque = true;
          break;
        }
      }
      node = node.parentElement;
    }
    let rgb: [number, number, number] = opaque ? [layers[layers.length - 1][0], layers[layers.length - 1][1], layers[layers.length - 1][2]] : [255, 255, 255];
    const start = opaque ? layers.length - 2 : layers.length - 1;
    for (let i = start; i >= 0; i--) rgb = blend(layers[i], rgb);
    return { rgb, unknown };
  }

  function describe(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node && node !== document.body && depth < 4; depth++) {
      const cls = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      parts.unshift(node.tagName.toLowerCase() + (node.id ? `#${node.id}` : "") + (cls ? `.${cls}` : ""));
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  const failures: Failure[] = [];
  const seen = new Set<string>();
  let checked = 0;
  let skipped = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!text || !el) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || cs.display === "none") continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rect = range.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    // Disabled controls are exempt (WCAG 1.4.3 incidental).
    if (el.closest(":disabled, [aria-disabled='true']")) continue;
    // Next's dev/route announcer and the Next error overlay are not product UI.
    if (el.closest("next-route-announcer, nextjs-portal")) continue;

    let opacity = 1;
    for (let a: Element | null = el; a; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity);
    if (opacity < 0.05) continue;

    const { rgb: bg, unknown } = backdrop(el);
    if (unknown) {
      skipped++;
      continue;
    }
    const fgRaw = parse(cs.color);
    const fgRgb = blend([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], bg);
    const l1 = lum(fgRgb);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const required = large ? 3 : 4.5;
    checked++;
    if (ratio + 1e-6 >= required) continue;
    const selector = describe(el);
    const key = selector + hex(fgRgb) + hex(bg);
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push({
      selector,
      text: text.slice(0, 40),
      fg: hex(fgRgb),
      bg: hex(bg),
      ratio: Math.round(ratio * 100) / 100,
      required,
      font: `${px}px/${cs.fontWeight}`,
    });
  }
  return { failures, checked, skipped };
}

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

      async function scanHere(label: string): Promise<void> {
        const { failures, checked, skipped } = await page.evaluate(scanContrast);
        checkedTotal += checked;
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
        `${THEME} sweep ${role.name}: ${routes.size} routes, ${checkedTotal} text nodes checked, ${skippedTotal} on gradients/images skipped, ${total} failures`,
      );
      expect(report, `${total} contrast failures for ${role.name}:\n${report.join("\n")}`).toEqual([]);
    });
  }
});
