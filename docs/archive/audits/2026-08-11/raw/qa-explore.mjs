/*
 * QA exploratorio — Cata Club, 11 de agosto de 2026
 * Recorre los 4 actores, captura cada pantalla en desktop (1440x900) y,
 * para pantallas mobile-critical, en 390x844. Emite findings.jsonl con
 * errores de consola, fallos de red y veredictos de hallazgos puntuales.
 *
 * Correr con:
 *   node --experimental-vm-modules docs/auditoria-qa/raw-2026-08-11/qa-explore.mjs
 *   (resuelve @playwright/test desde frontend/node_modules via NODE_PATH)
 */
import { chromium } from "../../../../../frontend/node_modules/@playwright/test/index.mjs";
import { mkdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = "/home/alejo/devwork/.projects/apps/cata_club";
const BASE = "http://localhost:3000";
const SHOTS = join(ROOT, "docs/auditoria-qa/img-2026-08-11");
const LOG = join(ROOT, "docs/auditoria-qa/raw-2026-08-11");
const FINDINGS = join(LOG, "findings.jsonl");
if (existsSync(FINDINGS)) writeFileSync(FINDINGS, "");

function emit(type, data) {
  appendFileSync(FINDINGS, JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + "\n");
}
const slug = (r) => (r === "/" ? "root" : r.replace(/^\/$/, "root").replace(/^\//, "").replace(/\//g, "_"));

const creds = {
  admin:      { user: "admin@cataclub.com",            pass: "admin12345", pid: 1 },
  entrenador: { user: "entrenador@cataclub.com",       pass: "trainer12345", pid: 2 },
  sebastian:  { user: "sebastiansabando21@cataclub.com", pass: "alumno123", pid: 33 },
  ana:        { user: "ana@cataclub.com",              pass: "alumno123", pid: 8 },
};

const routes = {
  admin: ["/dashboard", "/payments", "/members", "/groups", "/reports", "/discounts", "/attendance", "/profile", "/ayuda", "/admin/crear-cuenta", "/unauthorized"],
  entrenador: ["/trainer", "/trainer/attendance", "/trainer/attendance/history", "/profile", "/ayuda"],
  sebastian: ["/student", "/student/payments", "/student/add-dependent", "/student/attendance", "/student/enroll", "/student/medical-record", "/profile", "/ayuda"],
  ana: ["/student", "/profile", "/ayuda"],
};

// ---------- helpers ----------
async function loginAs(ctx, cred, actor) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(`${e.message}`));
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 20000 });
      // La página de login usa labels; probamos patrones amplios.
      const emailField = page.getByLabel(/correo|email|usuario|user/i).first();
      const passField = page.getByLabel(/contraseña|password/i).first();
      const btn = page.getByRole("button", { name: /iniciar|ingresar|entrar|login|sign in|acceder/i }).first();
      await emailField.fill(cred.user);
      await passField.fill(cred.pass);
      await btn.click();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      if (!page.url().includes("/login")) break;
    } catch (e) {
      lastError = e;
    }
  }
  const authenticated = !page.url().includes("/login");
  emit("login", { actor, finalUrl: page.url(), authenticated, attempts: authenticated ? undefined : 2, errs });
  if (!authenticated) emit("login-error", { actor, error: lastError?.message || "Login remained on /login after retry", errs });
  // Keep this page alive until the context closes. The app can issue its
  // logout cleanup while an authenticated page is unloaded; closing the
  // login page here can revoke the session before the route pages reuse it.
  return authenticated;
}

async function visit(ctx, actor, route, v) {
  const page = await ctx.newPage();
  const ces = [];
  const nfs = [];
  page.on("console", (m) => { if (m.type() === "error") ces.push(m.text().slice(0, 280)); });
  page.on("pageerror", (e) => ces.push(`PAGEERR: ${e.message.slice(0, 280)}`));
  page.on("requestfailed", (r) => nfs.push(`${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText ?? ""}`));
  page.on("response", (r) => { if (r.status() >= 400) nfs.push(`${r.status()} ${r.method()} ${r.url().slice(0, 120)}`); });
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 25000 });
  } catch (e) {
    emit("nav-error", { actor, route, error: e.message.slice(0, 280) });
  }
  await page.waitForTimeout(800);
  const file = `${SHOTS}/${actor}/${v.slug}-${slug(route)}.png`;
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch (e) {
    emit("shot-error", { actor, route, error: e.message.slice(0, 200) });
  }
  emit("visit", {
    actor, route, viewport: v.slug,
    finalUrl: page.url(),
    title: await page.title().catch(() => ""),
    consoleErrors: ces.slice(0, 6),
    networkFails: nfs.slice(0, 8),
    h1: await page.locator("h1").first().textContent().catch(() => "").then((t) => (t || "").trim().slice(0, 140)),
  });
  return page;
}

// ---------- targeted finding checks (UI) ----------
// DSH-2/A3: trainer dashboard deja ~47% en blanco.
async function check_trainer_density(ctx) {
  const page = await visit(ctx, "entrenador", "/trainer", { slug: "desktop" });
  try {
    const vh = await page.evaluate(() => window.innerHeight);
    const lastContentY = await page.evaluate(() => {
      // último elemento con significancia jugosa: el contenedor principal
      const main = document.querySelector("main") || document.body;
      const r = main.getBoundingClientRect();
      return Math.max(r.bottom, ...Array.from(main.querySelectorAll("*")).map((el) => el.getBoundingClientRect().bottom));
    });
    const blank = vh - lastContentY;
    const pct = Math.round((blank / vh) * 100);
    emit("dsh2-trainer-density", { vh, lastContentY, blankBelowPx: blank, blankPct: pct, verdict: blank > 150 ? "STILL_OPEN" : "RESOLVED" });
  } catch (e) {
    emit("dsh2-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// N1: el entrenador ve "Persona 15" en vez del nombre.
async function check_trainer_persona_fallback(ctx) {
  const page = await visit(ctx, "entrenador", "/trainer", { slug: "desktop" });
  try {
    const hasPersona = await page.getByText(/Persona\s+\d+/).first().isVisible().catch(() => false);
    emit("n1-trainer-persona", { hasPersonaFallback: hasPersona, verdict: hasPersona ? "STILL_OPEN" : "RESOLVED" });
  } catch (e) {
    emit("n1-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// A1: pasar lista todavía tiene paso "3 Confirmar".
async function check_trainer_attendance_steps(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/trainer/attendance`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1200);
    const steps = await page.locator('[aria-current], ol li, [data-step]').count().catch(() => 0);
    const txt = (await page.locator("main").first().textContent().catch(() => "") || "").slice(0, 800);
    const hasConfirmar = /3\s*confirmar|paso\s*3|confirmar/i.test(txt);
    emit("a1-trainer-attendance-steps", { stepsCount: steps, hasConfirmarStep: hasConfirmar, sample: txt.slice(0, 400), verdict: hasConfirmar ? "STILL_OPEN" : "RESOLVED" });
    await page.screenshot({ path: `${SHOTS}/entrenador/desktop-trainer_attendance.png`, fullPage: true });
  } catch (e) {
    emit("a1-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// ASI-6: footer dice "sesións".
async function check_history_footer(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/trainer/attendance/history`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1200);
    const footer = (await page.locator("body").textContent().catch(() => "") || "").toLowerCase();
    const hasSesions = footer.includes("sesións") || footer.includes("sesions");
    const hasSesiones = footer.includes("sesiones");
    emit("asi6-history-footer", { hasSesions, hasSesiones, verdict: hasSesions ? "STILL_OPEN" : "RESOLVED" });
  } catch (e) {
    emit("asi6-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// DSH-3/A4: /ayuda con doble "Volver al inicio".
async function check_ayuda_doble_volver(ctx, actor) {
  const page = await visit(ctx, actor, "/ayuda", { slug: "desktop" });
  try {
    const volver = await page.getByRole("link", { name: /volver al inicio|volver/i }).count();
    const preguntas = await page.locator('details, [role="accordion"], button[aria-expanded]').count().catch(() => 0);
    emit("dsh3-ayuda-volver", { actor, linksVolverCount: volver, accordionCount: preguntas, verdict: volver > 1 ? "STILL_OPEN" : "RESOLVED" });
  } catch (e) {
    emit("dsh3-error", { actor, error: e.message.slice(0, 200) });
  }
  await page.close();
}

// ASI-7: /reports sin filtro por alumno.
async function check_reports_sin_alumno(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/reports`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1200);
    const labels = (await page.locator("label").allInnerTexts()).join("|").toLowerCase();
    const hasAlumnoFilter = /alumno|persona|estudiante|socio/.test(labels);
    emit("asi7-reports-alumno-filter", { labels: labels.slice(0, 280), hasAlumnoFilter, verdict: !hasAlumnoFilter ? "STILL_OPEN" : "RESOLVED" });
  } catch (e) {
    emit("asi7-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// ASI-8/DSH-5: en 390x844, botón Generar PDF superpone al título.
async function check_reports_mobile_overlap(ctx) {
  const page = await ctx.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/reports`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1200);
    const overlap = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const pdfBtn = Array.from(document.querySelectorAll("button, a")).find((e) => /pdf/i.test(e.textContent || ""));
      if (!h1 || !pdfBtn) return { hasBoth: false };
      const a = h1.getBoundingClientRect();
      const b = pdfBtn.getBoundingClientRect();
      const overlapX = a.left < b.right && b.left < a.right;
      const overlapY = a.top < b.bottom && b.top < a.bottom;
      return { hasBoth: true, h1: { top: Math.round(a.top), right: Math.round(a.right), text: (h1.textContent || "").trim().slice(0, 40) }, btn: { top: Math.round(b.top), left: Math.round(b.left), text: (pdfBtn.textContent || "").trim().slice(0, 40) }, overlap: overlapX && overlapY };
    });
    emit("asi8-reports-mobile-overlap", { ...overlap, verdict: overlap.overlap ? "STILL_OPEN" : "RESOLVED" });
  } catch (e) {
    emit("asi8-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// PAG-5: monto inválido deshabilita el botón sin mostrar el motivo.
async function check_pago_monto_invalido(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/student/payments?alumno=37`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1500);
    // Buscar botón "Registrar un pago" o similar doorway.
    const opener = page.getByRole("button", { name: /registrar un pago|registrar pago|renovar|nuevo pago/i }).first();
    await opener.waitFor({ state: "visible", timeout: 8000 });
    await opener.click();
    await page.waitForTimeout(800);
    const montoLabel = page.getByLabel(/monto/i).first();
    await montoLabel.waitFor({ state: "visible", timeout: 8000 });
    await montoLabel.fill("40");
    await page.waitForTimeout(400);
    const registrarDisabled = await page.getByRole("button", { name: /confirmar y registrar|registrar pago|registrar/i }).first().isDisabled().catch(() => null);
    const helperText = await montoLabel.evaluate((el) => el.parentElement?.innerText || "").catch(() => "");
    const alerts = (await page.locator("[role=alert], [aria-live]").allInnerTexts().catch(() => [])).join(" ");
    const evidenceText = `${helperText} ${alerts}`.trim();
    const showsError = /monto|máximo|inválido|cuota|invalid|incorrecto|debe ser|debe cubrir/i.test(evidenceText);
    await page.screenshot({ path: `${SHOTS}/sebastian/desktop-student_payments-invalid.png`, fullPage: true }).catch(() => {});
    emit("pag5-monto-invalido", { registrarDisabled, helperVisible: showsError, helperText: evidenceText.slice(0, 280), verdict: registrarDisabled && !showsError ? "STILL_OPEN" : "RESOLVED" });
  } catch (e) {
    emit("pag5-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// A5: el instructivo de pagos conserva sus tres pasos explicativos.
async function check_payment_instructions(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/student/payments?alumno=37`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1000);
    const heading = page.getByText("Cómo se registra un pago", { exact: true });
    const visible = await heading.isVisible().catch(() => false);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const start = bodyText.indexOf("Cómo se registra un pago");
    const text = start >= 0 ? bodyText.slice(start, start + 1200) : "";
    const steps = [1, 2, 3].filter((step) => new RegExp(`(^|\\n)\\s*${step}\\s+`).test(text)).length;
    const paragraphs = steps;
    emit("a5-payment-instructions", { visible, steps, paragraphs, verdict: visible && steps === 3 && paragraphs >= 3 ? "RESOLVED" : "CANNOT_TELL" });
  } catch (e) {
    emit("a5-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// INS-8: fecha de nacimiento 1800-01-01 deja avanzar el wizard.
async function check_add_dependent_fecha(ctx) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/student/add-dependent`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1500);
    const fecha = page.getByLabel(/fecha de nacimiento|nacimiento|birthdate/i).first();
    if (await fecha.isVisible().catch(() => false)) {
      await fecha.fill("1800-01-01");
      await page.waitForTimeout(400);
    } else {
      // puede ser input type=date separado en selects
    }
    const siguiente = page.getByRole("button", { name: /siguiente|continuar|next/i }).first();
    const disabled = await siguiente.isDisabled().catch(() => null);
    emit("ins8-add-dependent-fecha", { siguienteDisabled: disabled, verdict: disabled === false ? "STILL_OPEN" : disabled === true ? "RESOLVED" : "CANNOT_TELL" });
  } catch (e) {
    emit("ins8-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// DSH-6: abortar /api/* expulsa a /login.
async function check_dashboard_outage(ctx) {
  const page = await ctx.newPage();
  try {
    // Pre-login ya está en la storageState —REUTILIZA el ctx ya autenticado
    await page.route("**/api/**", (r) => r.abort("failed"));
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2500);
    const url = page.url();
    emit("dsh6-outage-redirect", { finalUrl: url, verdict: url.includes("/login") ? "STILL_OPEN" : "RESOLVED" });
    await page.screenshot({ path: `${SHOTS}/admin/desktop-dsh6_outage.png`, fullPage: true });
  } catch (e) {
    emit("dsh6-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// DSH-5: un control enfocado no debe quedar debajo de la barra mobile fija.
async function check_dashboard_mobile_focus(ctx) {
  const page = await ctx.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(1000);
    let evidence = { hasBoth: false };
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const current = await page.evaluate(() => {
        const active = document.activeElement?.getBoundingClientRect();
        const fixed = [...document.querySelectorAll("body *")].map((el) => ({ el, rect: el.getBoundingClientRect(), style: getComputedStyle(el) }))
          .find(({ rect, style }) => style.position === "fixed" && rect.top >= window.innerHeight - 120 && rect.bottom <= window.innerHeight + 1 && rect.height >= 50 && rect.height <= 120);
        if (!active || !fixed) return { hasBoth: false };
        const overlap = active.top < fixed.rect.bottom && fixed.rect.top < active.bottom && active.left < fixed.rect.right && fixed.rect.left < active.right;
        return { hasBoth: true, focused: { top: Math.round(active.top), bottom: Math.round(active.bottom) }, bar: { top: Math.round(fixed.rect.top), bottom: Math.round(fixed.rect.bottom) }, overlap };
      });
      if (current.hasBoth) evidence = current;
      if (current.overlap) break;
    }
    emit("dsh5-dashboard-mobile-focus", { ...evidence, verdict: evidence.overlap ? "STILL_OPEN" : evidence.hasBoth ? "RESOLVED" : "CANNOT_TELL" });
  } catch (e) {
    emit("dsh5-error", { error: e.message.slice(0, 200) });
  }
  await page.close();
}

// ---------- main ----------
async function actorPass(browser, desktop, mobile) {
  // Recorrido limpio: por actor, login ÚNICO y reusar contexto para todas sus rutas.
  for (const actor of Object.keys(creds)) {
    const ctx = await browser.newContext({ viewport: { width: desktop.width, height: desktop.height }, reducedMotion: "reduce" });
    await loginAs(ctx, creds[actor], actor);
    for (const r of routes[actor]) {
      const page = await ctx.newPage();
      const ces = [];
      const nfs = [];
      page.on("console", (m) => { if (m.type() === "error") ces.push(m.text().slice(0, 280)); });
      page.on("pageerror", (e) => ces.push(`PAGEERR: ${e.message.slice(0, 280)}`));
      page.on("requestfailed", (rq) => nfs.push(`${rq.method()} ${rq.url().slice(0, 120)} ${rq.failure()?.errorText ?? ""}`));
      page.on("response", (rsp) => { if (rsp.status() >= 400) nfs.push(`${rsp.status()} ${rsp.request().method()} ${rsp.url().slice(0, 120)}`); });
      try {
        await page.goto(`${BASE}${r}`, { waitUntil: "networkidle", timeout: 25000 });
      } catch (e) {
        emit("nav-error", { actor, route: r, error: e.message.slice(0, 280) });
      }
      await page.waitForTimeout(800);
      const file = `${SHOTS}/${actor}/desktop-${slug(r)}.png`;
      try { await page.screenshot({ path: file, fullPage: true }); } catch (e) { emit("shot-error", { actor, route: r, error: e.message.slice(0, 200) }); }
      emit("visit", {
        actor, route: r, viewport: "desktop",
        finalUrl: page.url(),
        title: await page.title().catch(() => ""),
        h1: (await page.locator("h1").first().textContent().catch(() => "") || "").trim().slice(0, 140),
        consoleErrors: ces.slice(0, 6),
        networkFails: nfs.slice(0, 8),
      });
      await page.close().catch(() => {});
    }
    // mobile-critical routes: dashboard, reports, members
    const mobileRoutes = { admin: ["/dashboard", "/reports", "/members"], entrenador: ["/trainer"], sebastian: ["/student", "/student/payments"], ana: [] };
    for (const r of mobileRoutes[actor] || []) {
      const page = await ctx.newPage();
      await page.setViewportSize({ width: mobile.width, height: mobile.height });
      try {
        await page.goto(`${BASE}${r}`, { waitUntil: "networkidle", timeout: 25000 });
      } catch (e) {}
      await page.waitForTimeout(800);
      try { await page.screenshot({ path: `${SHOTS}/${actor}/mobile-${slug(r)}.png`, fullPage: true }); } catch (e) {}
      emit("visit-mobile", { actor, route: r });
      await page.close().catch(() => {});
    }
    await ctx.close().catch(() => {});
    emit("actor-done", { actor });
  }
}

async function focusedPass(browser) {
  // Pass 2: hallazgos puntuales (un contexto por actor para autenticar).
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await loginAs(ctx, creds.entrenador, "entrenador");
    await check_trainer_density(ctx);
    await check_trainer_persona_fallback(ctx);
    await check_trainer_attendance_steps(ctx);
    await check_history_footer(ctx);
    await ctx.close().catch(() => {});
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await loginAs(ctx, creds.admin, "admin");
    await check_ayuda_doble_volver(ctx, "admin");
    await check_reports_sin_alumno(ctx);
    await check_reports_mobile_overlap(ctx);
    await check_dashboard_mobile_focus(ctx);
    await check_dashboard_outage(ctx);
    await ctx.close().catch(() => {});
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await loginAs(ctx, creds.sebastian, "sebastian");
    await check_ayuda_doble_volver(ctx, "sebastian");
    await check_pago_monto_invalido(ctx);
    await check_payment_instructions(ctx);
    await check_add_dependent_fecha(ctx);
    await ctx.close().catch(() => {});
  }
}

(async () => {
  for (const a of Object.keys(creds)) mkdirSync(`${SHOTS}/${a}`, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const desktop = { width: 1440, height: 900, slug: "desktop" };
  const mobile = { width: 390, height: 844, slug: "mobile" };

  await actorPass(browser, desktop, mobile);
  await focusedPass(browser);

  await browser.close();
  emit("done", {});
})();
