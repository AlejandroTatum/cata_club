/**
 * QA4 mobile audit — every main route, per role, on a phone engine.
 *
 * Runs under `mobile-chromium` (Pixel 7, 412×915) and again at 360×740, the
 * narrowest phone still in use. The backend is mocked at the network layer,
 * exactly like the other e2e specs, so no live stack is needed. Each screen is
 * checked for:
 *   (a) no horizontal overflow;
 *   (b) tap targets of at least 44×44 CSS px (violations are collected and
 *       compared against the documented allow-list below);
 *   (c) no console errors from app code (see `isIgnorableConsoleError`);
 *   (d) no voseo anywhere and no «usted» outside the legal pages (S6).
 * A full-page screenshot and a JSON report per screen are attached to the
 * test (`testInfo.outputPath`, inside the git-ignored `test-results/`). Set
 * MOBILE_AUDIT_SCREENS=1 to also copy them to odd/qa4/mobile-audit/screens/;
 * nothing is ever written outside those two places.
 *
 * The file is named `.mobile.spec.ts` on purpose: that is what the
 * `mobile-chromium` project matches, and it keeps the desktop project from
 * running a phone audit.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  buildUstedRegisterRegex,
  USTED_IMPERATIVOS,
  USTED_IMPERATIVOS_CON_CLITICO,
  USTED_PRONOMBRES,
} from "../../src/lib/__tests__/usted-register-lock";
import { E2E_BASE_URL } from "./e2e-target";
import { MOCK_CLUB_PAYMENT_INFO } from "./helpers/club-payment-info";

/** Resolved from this file, never from the cwd; only written when MOBILE_AUDIT_SCREENS=1. */
const SHOTS_DIR = path.resolve(__dirname, "../../../odd/qa4/mobile-audit/screens");
const COPY_SCREENS = process.env.MOBILE_AUDIT_SCREENS === "1";
const MIN_TARGET = 44;

type Role = "public" | "admin" | "representante" | "estudiante" | "entrenador";

const SESSIONS: Record<Exclude<Role, "public">, unknown> = {
  admin: {
    user: { id: "1", name: "Admin Demo", email: "admin@cataclub.test", role: "admin", representanteId: null },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-10-01T00:00:00.000Z",
  },
  entrenador: {
    user: { id: "3", name: "Carlos Entrenador", email: "carlos@cataclub.test", role: "trainer", representanteId: null },
    roles: ["ENTRENADOR"],
    loggedInAt: "2026-10-01T00:00:00.000Z",
  },
  representante: {
    user: { id: "7", name: "Laura Vera", email: "laura@cataclub.test", role: "representante", representanteId: null },
    roles: ["REPRESENTANTE"],
    loggedInAt: "2026-10-01T00:00:00.000Z",
  },
  estudiante: {
    user: { id: "41", name: "Sofía Vera", email: "sofia@cataclub.test", role: "estudiante", representanteId: null, personaId: "41" },
    roles: ["ALUMNO"],
    loggedInAt: "2026-10-01T00:00:00.000Z",
  },
};

interface Screen {
  role: Role;
  name: string;
  path: string;
  /** Legal pages stay in «usted»; everywhere else is «tú». */
  legal?: boolean;
}

const SCREENS: Screen[] = [
  { role: "public", name: "landing", path: "/" },
  { role: "public", name: "login", path: "/login" },
  { role: "public", name: "enroll", path: "/student/enroll" },
  { role: "public", name: "ayuda", path: "/ayuda" },
  { role: "public", name: "terminos", path: "/terminos", legal: true },
  { role: "public", name: "privacidad", path: "/privacidad", legal: true },
  { role: "representante", name: "add-dependent", path: "/student/add-dependent" },
  { role: "representante", name: "portal", path: "/student" },
  { role: "representante", name: "payments", path: "/student/payments" },
  { role: "representante", name: "attendance", path: "/student/attendance" },
  { role: "representante", name: "profile", path: "/profile" },
  { role: "representante", name: "medical-record", path: "/student/medical-record" },
  { role: "estudiante", name: "portal", path: "/student" },
  { role: "estudiante", name: "payments", path: "/student/payments" },
  { role: "estudiante", name: "attendance", path: "/student/attendance" },
  { role: "estudiante", name: "profile", path: "/profile" },
  { role: "estudiante", name: "medical-record", path: "/student/medical-record" },
  { role: "entrenador", name: "day", path: "/trainer" },
  { role: "entrenador", name: "attendance", path: "/trainer/attendance" },
  { role: "entrenador", name: "students", path: "/trainer/students" },
  { role: "entrenador", name: "profile", path: "/profile" },
  { role: "admin", name: "dashboard", path: "/dashboard" },
  { role: "admin", name: "members", path: "/members" },
  { role: "admin", name: "payments", path: "/payments" },
  { role: "admin", name: "groups", path: "/groups" },
  { role: "admin", name: "discounts", path: "/discounts" },
  { role: "admin", name: "tarifas", path: "/tarifas" },
  { role: "admin", name: "reports", path: "/reports" },
  { role: "admin", name: "actividad", path: "/admin/actividad" },
  { role: "admin", name: "reportes-error", path: "/admin/reportes-error" },
  { role: "admin", name: "galeria", path: "/galeria" },
  { role: "admin", name: "sponsors", path: "/sponsors" },
  { role: "admin", name: "profile", path: "/profile" },
];

const VIEWPORTS = [
  { label: "412", width: 412, height: 915 },
  { label: "360", width: 360, height: 740 },
];

/**
 * Documented tap-target exceptions. A violation is allowed only when it is
 * classified `inline-link` or its `screen|label` matches `ALLOW_LIST`; anything
 * else fails the spec.
 *
 *  - `inline-link`: an `<a>` whose computed `display` is `inline` and whose
 *    parent's text is more than 3 characters longer than the link's own text,
 *    i.e. a link that sits inside a sentence. WCAG 2.5.8 exempts inline
 *    targets, and padding them would break the line box. A standalone link
 *    (own `display: block|inline-block|flex`, or the only text in its parent)
 *    is never classified this way.
 *
 * The `::after` hit-area exemption lives in `probe`: a control is skipped when
 * its `::after` has content, is `position: absolute` and its computed width and
 * height are both at least `MIN_TARGET`. Only the pseudo-element's size is
 * checked, not that it is centred on the control (the password eye is the only
 * user today). A skip link is not listed: it is hidden until keyboard focus, so
 * the visibility check already drops it.
 */
const ALLOWED_KINDS = new Set(["inline-link"]);
/** `screen|label` pairs reviewed by the owner or documented in the report. */
const ALLOW_LIST: { key: RegExp; reason: string }[] = [
  // Minors from odd/qa4/mobile-audit/report.md. Each one is a secondary text
  // link or disclosure, not a primary action; delete the entry when it is fixed.
  { key: /^public-login\|(Inscríbete|Escríbenos por WhatsApp|¿Olvidaste tu contraseña\?)/, reason: "text links under the login form (report: minor)" },
  { key: /^public-(terminos|privacidad)\|(cataclub\.loja@proton\.me|WhatsApp 09)/, reason: "contact links inside the legal text (report: minor)" },
  { key: /^(estudiante|representante)-portal\|(Imprimir carnet|Ver pagos|Ver mis asistencias|Ver las asistencias de)/, reason: "secondary card links on the portal (report: minor)" },
  { key: /^admin-dashboard\|(82% del total|Revisar pagos|0 de 0 registros)/, reason: "stat-tile footer links on the dashboard (report: minor)" },
  { key: /^admin-actividad\|(Jugadores|Entrenadores|Representantes|Ver como tabla)/, reason: "legend chips and a disclosure on Actividad (report: minor)" },
  { key: /^entrenador-day\|Es una estimación/, reason: "a disclosure summary on the trainer day (report: minor)" },
];

/** Voseo forms only: the unaccented forms (`hace`, `usa`…) are plain third person, so they are not listed. */
const VOSEO_STRICT = /(?<![\p{L}])(?:tenés|podés|querés|hacé|elegí|ingresá|seleccioná|escribí|subí|cargá|completá|revisá|confirmá|presioná|tocá|mirá|fijate|avisanos|contactanos|escribinos|llamanos|registrate|inscribite|anotate|sabés|necesitás|vení|decí|poné|sacá|usá|buscá|probá|volvé|andá|esperá|intentá|verificá|guardá|descargá|compartí|agregá|cambiá|editá|eliminá|cerrá|abrí|seguí|continuá|vos)(?![\p{L}])/iu;

/**
 * The app-wide register lock (`usted-register-lock.ts`) is the single source of
 * truth: its imperative-position rule matches «Complete el formulario» but not
 * the tú / third-person subjunctive «para que el club revise». Each match is
 * classified as usted or voseo by the lock's own word lists.
 */
const USTED_FORMS = new Set(
  [...USTED_PRONOMBRES, ...USTED_IMPERATIVOS, ...USTED_IMPERATIVOS_CON_CLITICO].map((w) => w.toLowerCase()),
);

function registerViolations(text: string, legal: boolean): { voseo: string[]; usted: string[] } {
  const hits = [...(text.match(buildUstedRegisterRegex()) ?? []), ...(text.match(new RegExp(VOSEO_STRICT.source, "giu")) ?? [])];
  const usted = hits.filter((h) => USTED_FORMS.has(h.toLowerCase()));
  const voseo = hits.filter((h) => !USTED_FORMS.has(h.toLowerCase()));
  return { voseo: [...new Set(voseo)], usted: legal ? [] : [...new Set(usted)] };
}

/**
 * Console errors that never fail the audit. Deliberately narrow; everything
 * else from app code fails it.
 *  - Not from this app's origin (third-party scripts, extensions, fonts):
 *    not ours to fix and not reproducible offline. Errors without a location
 *    (page errors) are app code and are never ignored here.
 *  - The unauthenticated session probe: `/api/auth/session` answers 401 on
 *    public pages by design and Chromium logs that as a console error. Matched
 *    by the failing URL, so it does not depend on event ordering.
 * Ignored errors are still attached to the report.
 */
function isIgnorableConsoleError(text: string, url: string): boolean {
  if (url && !url.startsWith(E2E_BASE_URL)) return true;
  return /status of 401/.test(text) && /\/api\/auth\/session(?:\?|$)/.test(url);
}

/** React minified #418 / dev «Hydration failed»: a server/client markup mismatch. */
const HYDRATION_ERROR = /Minified React error #418|Hydration failed|hydrat(?:ion|ed) .*(?:mismatch|didn't match)/i;

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Long names on purpose: a name that cannot wrap is what breaks a 360px layout. */
const ACCOUNT = {
  id: "1", role: "representante", nombres: "María de los Ángeles", apellidos: "González Montenegro de la Torre",
  email: "maria.de.los.angeles.gonzalez.montenegro@example.test", telefono: "0999999999",
  estudiantes: [{
    id: "10", nombres: "Sofía Valentina", apellidos: "González Montenegro", grupoId: null, activo: true,
    membresia: {
      id: "10", tipo: "Mensual", estado: "vencida", fechaInicio: "2026-06-01", fechaFin: "2026-06-30", monto: 25,
      esGratuidadFamiliar: false, mesesAdeudados: 2, montoAdeudado: 50,
    },
    ultimoPago: null,
  }],
};

const PAYMENT = {
  id: "pv-001", studentName: "Sofía Valentina González Montenegro", responsablePagoName: "María de los Ángeles González",
  membershipPeriod: "Octubre 2026", membershipType: "Mensual", expectedAmount: 25, paymentMethod: "TRANSFERENCIA",
  uploadedAt: "2026-10-01T10:00:00.000Z", currentMembershipStatus: "pendiente", proofFileType: "image",
  validationStatus: "pending", startDate: "2026-10-01",
};

const PAGE_OF = <T,>(items: T[]) => ({ items, total: items.length, skip: 0, limit: 10 });

const DEP = (id: string, nombres: string, birth: string) => ({
  personaId: id,
  nombres,
  apellidos: "Vera Montenegro de la Torre",
  fechaNacimiento: birth,
  recentSessions: [],
  membership: {
    id: Number(id), estado: "ACTIVA", personaId: Number(id), montoAplicado: "40.00",
    categoria: "Competitivo de alto rendimiento", modalidad: "MENSUAL",
    fechaActivacion: "2026-01-10", fechaFin: "2026-12-31",
  },
  representante: { nombres: "Laura", apellidos: "Vera" },
  representanteId: 7,
});

const PORTAL_GUARDIAN = {
  self: null,
  representados: [DEP("41", "Sofía", "2016-03-02"), DEP("42", "Martín", "2010-08-19")],
  membershipPlans: [],
};
// An adult: a minor with an own account is redirected away from the medical record by design.
const PORTAL_STUDENT = { self: DEP("41", "Sofía", "1995-03-02"), representados: [], membershipPlans: [] };

/**
 * Answers every `/api/**` call, so nothing reaches the real BFF (an unanswered
 * 401 logs the session out mid-audit). Registered most-generic first: the last
 * registered route wins.
 */
async function mockBackend(page: Page, role: Role): Promise<void> {
  await page.route("**/api/**", (route) => (route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {})));
  if (role === "public") {
    await page.route("**/api/auth/session", (route) => fulfillJson(route, {}, 401));
  } else {
    await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
    await page.route("**/api/auth/session", (route) => fulfillJson(route, SESSIONS[role]));
  }
  await page.route("**/api/ranking/notificaciones/mias", (route) => fulfillJson(route, PAGE_OF([])));
  await page.route("**/api/club/payment-info", (route) => fulfillJson(route, MOCK_CLUB_PAYMENT_INFO));
  await page.route("**/api/payments*", (route) => fulfillJson(route, PAGE_OF([PAYMENT])));
  await page.route("**/api/members", (route) => fulfillJson(route, { accounts: [ACCOUNT], personasCapped: false }));
  await page.route("**/api/attendance/schedules", (route) => fulfillJson(route, [{ id: 11, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00" }]));
  await page.route("**/api/groups/horarios/11/alumnos*", (route) =>
    fulfillJson(route, {
      items: [{
        id: 1, personaId: 9, personaNombreCompleto: "Ana María de los Ángeles López Montenegro", edad: 12, horarioId: 11,
        horarioDia: "lun", horarioHoraInicio: "18:00", horarioHoraFin: "19:00", fechaAsignacion: "2026-01-01T00:00:00Z",
      }],
      total: 1, skip: 0, limit: 200,
    }),
  );
  await page.route("**/api/student?*", (route) => fulfillJson(route, role === "estudiante" ? PORTAL_STUDENT : PORTAL_GUARDIAN));
  await page.route("**/api/personas/*/beneficio", (route) => fulfillJson(route, null));
  await page.route("**/api/dashboard", (route) =>
    fulfillJson(route, { totalPersonas: 120, totalAlumnos: 98, activeMemberships: 80, pendingPayments: 7, todaySchedules: 4, personasSinMembresia: 12 }),
  );
  await page.route("**/api/actividad/resumen*", (route) =>
    fulfillJson(route, {
      range: "7d",
      generatedAt: "2026-10-04T12:00:00.000Z",
      span: "1d",
      periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        start: `2026-09-${28 + (d % 3)}T00:00:00.000Z`,
        visitors: { alumnos: 10 + d, entrenadores: 2, representantes: 5 },
        attendances: 20 + d, payments: 3, enrollments: 1,
      })),
      uniqueVisitors: { alumnos: 40, entrenadores: 3, representantes: 22, total: 65 },
      status: [{ key: "app", level: "ok" }, { key: "errors", level: "ok" }, { key: "notifications", level: "ok" }],
      queuedByQuota: 0,
      health: null,
    }),
  );
  await page.route("**/api/schedules", (route) =>
    fulfillJson(route, [
      { category: "Competitivo de alto rendimiento", ages: "Selección", blocks: [{ days: ["LUNES", "MIERCOLES"], startTime: "18:00", endTime: "20:00" }] },
      { category: "Infantil", ages: "8 a 12 años", blocks: [{ days: ["MARTES"], startTime: "16:00", endTime: "17:00" }] },
    ]),
  );
}

interface TargetViolation { kind: string; label: string; tag: string; w: number; h: number }
interface Probe {
  overflow: { scrollWidth: number; innerWidth: number; culprits: string[] };
  targets: TargetViolation[];
  text: string;
}

/** Runs in the page: layout is only knowable there. */
function probe({ min, width }: { min: number; width: number }): Probe {
  const root = document.documentElement;
  const culprits: string[] = [];
  // `window.innerWidth` is NOT the yardstick: Chrome mobile zooms out to fit
  // overflowing content and then reports the widened layout viewport as the
  // inner width, which would make every overflow look fine. The configured
  // viewport width is the truth.
  const innerWidth = width;
  if (root.scrollWidth > innerWidth + 1 || window.innerWidth > innerWidth + 1) {
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > innerWidth + 1) {
        culprits.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 3).join(".") : ""} (${Math.round(r.right)})`);
        if (culprits.length >= 5) break;
      }
    }
  }
  const labelOf = (el: Element): string =>
    (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("placeholder") || el.getAttribute("name") || el.getAttribute("href") || el.id || "")
      .replace(/\s+/g, " ").trim().slice(0, 60);
  const targets: TargetViolation[] = [];
  const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (!(el as HTMLElement).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Off-canvas (closed drawer) — not reachable, not a target.
    if (r.right <= 0 || r.left >= innerWidth) continue;
    // Visually hidden controls (sr-only).
    if (r.width <= 1 || r.height <= 1) continue;
    if (el.closest("[inert], [aria-hidden='true']")) continue;
    let w = r.width, h = r.height;
    // A checkbox/radio inside a label is hit through the label.
    const lab = el.closest("label");
    if (lab && lab !== el) { const lr = lab.getBoundingClientRect(); w = Math.max(w, lr.width); h = Math.max(h, lr.height); }
    // A hit area drawn with ::after (the password eye) counts when it is absolutely
    // positioned and at least `min` square. Centring is not verified.
    const after = getComputedStyle(el, "::after");
    if (after.content !== "none" && after.position === "absolute" && parseFloat(after.width) >= min && parseFloat(after.height) >= min) continue;
    if (w >= min - 0.5 && h >= min - 0.5) continue;
    const tag = el.tagName.toLowerCase();
    let kind = "target";
    if (tag === "a") {
      const display = getComputedStyle(el).display;
      const parentText = (el.parentElement?.innerText ?? "").replace(/\s+/g, " ").trim();
      const own = (el as HTMLElement).innerText.replace(/\s+/g, " ").trim();
      if (display === "inline" && parentText.length > own.length + 3) kind = "inline-link";
    }
    targets.push({ kind, label: labelOf(el), tag, w: Math.round(w), h: Math.round(h) });
  }
  const attrs = Array.from(document.querySelectorAll("[placeholder], [aria-label], [title]"))
    .map((e) => [e.getAttribute("placeholder"), e.getAttribute("aria-label"), e.getAttribute("title")].filter(Boolean).join(" · "))
    .join("\n");
  return { overflow: { scrollWidth: Math.max(root.scrollWidth, window.innerWidth), innerWidth, culprits }, targets, text: `${document.body.innerText}\n${attrs}` };
}

for (const vp of VIEWPORTS) {
  test.describe(`mobile audit @${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const screen of SCREENS) {
      const id = `${screen.role}-${screen.name}`;
      test(`${id}`, async ({ page }, testInfo) => {
        // Listeners first, then navigation. Each load fills its own buffers.
        let consoleErrors: string[] = [];
        let ignoredErrors: string[] = [];
        page.on("console", (m) => {
          if (m.type() !== "error") return;
          const text = m.text();
          (isIgnorableConsoleError(text, m.location().url) ? ignoredErrors : consoleErrors).push(text);
        });
        page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

        await mockBackend(page, screen.role);

        /** One full load: navigate, then wait for the network and for a rendered, font-ready, painted page. */
        const load = async (reload: boolean): Promise<void> => {
          consoleErrors = [];
          ignoredErrors = [];
          if (reload) await page.reload();
          else await page.goto(screen.path);
          await page.waitForLoadState("networkidle");
          await expect(page.locator("main, [role='main'], h1").first(), "the screen must render").toBeVisible();
          await page.evaluate(
            () => document.fonts.ready.then(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))),
          );
        };

        await load(false);
        // A hydration mismatch has appeared twice and never reproduced. One is
        // attached to the report; the same error on two consecutive loads of
        // the same screen is a real defect and fails.
        const firstLoadHydration = consoleErrors.filter((e) => HYDRATION_ERROR.test(e));
        let hydrationNoise: string[] = [];
        if (firstLoadHydration.length > 0) {
          const firstLoadErrors = consoleErrors;
          await load(true);
          const secondLoadHydration = consoleErrors.filter((e) => HYDRATION_ERROR.test(e));
          expect.soft(secondLoadHydration, "(c) hydration error reproduced on 2 consecutive loads").toEqual([]);
          hydrationNoise = firstLoadHydration;
          // The first load's non-hydration errors still count.
          consoleErrors = [...firstLoadErrors.filter((e) => !HYDRATION_ERROR.test(e)), ...consoleErrors.filter((e) => !HYDRATION_ERROR.test(e))];
        }
        expect(new URL(page.url()).pathname, "the audit must land on the screen, not a redirect").toBe(screen.path);

        // Measure BEFORE the full-page screenshot: Chromium resizes the viewport
        // for it, and that resets the touch emulation `(pointer: coarse)` reads.
        const result = await page.evaluate(probe, { min: MIN_TARGET, width: vp.width });
        const shotPath = testInfo.outputPath(`${id}-${vp.label}.png`);
        await page.screenshot({ path: shotPath, fullPage: true });
        const violations = result.targets.filter((t) => {
          if (ALLOWED_KINDS.has(t.kind)) return false;
          return !ALLOW_LIST.some((a) => a.key.test(`${id}|${t.label}`));
        });
        const { voseo, usted } = registerViolations(result.text, !!screen.legal);
        const report = JSON.stringify(
          { overflow: result.overflow, targets: result.targets, consoleErrors, ignoredErrors, hydrationNoise, voseo, usted },
          null,
          2,
        );
        const reportPath = testInfo.outputPath(`${id}-${vp.label}.json`);
        fs.writeFileSync(reportPath, report);
        await testInfo.attach(`${id}-${vp.label}.png`, { path: shotPath, contentType: "image/png" });
        await testInfo.attach(`${id}-${vp.label}.json`, { path: reportPath, contentType: "application/json" });
        if (COPY_SCREENS) {
          fs.mkdirSync(SHOTS_DIR, { recursive: true });
          fs.copyFileSync(shotPath, path.join(SHOTS_DIR, `${id}-${vp.label}.png`));
          fs.copyFileSync(reportPath, path.join(SHOTS_DIR, `${id}-${vp.label}.json`));
        }

        expect.soft(result.overflow.scrollWidth, `(a) overflow: ${result.overflow.culprits.join(", ")}`).toBeLessThanOrEqual(result.overflow.innerWidth + 1);
        expect.soft(violations, `(b) tap targets under ${MIN_TARGET}px`).toEqual([]);
        expect.soft(consoleErrors, "(c) console errors").toEqual([]);
        expect.soft(voseo, "(d) voseo").toEqual([]);
        expect.soft(usted, "(d) usted outside legal pages").toEqual([]);
      });
    }
  });
}
