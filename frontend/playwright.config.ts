/**
 * Playwright Configuration — Cata Club Admin Frontend
 *
 * Single smoke-test config for the admin flow:
 *   login → dashboard → members page.
 *
 * Uses the production Next.js server via the webServer option.
 * In CI, the workflow builds once before Playwright and this config only starts it.
 * Locally, Playwright builds then starts it.
 *
 * WHICH server the suite talks to is decided in `tests/e2e/e2e-target.ts` and
 * verified by `tests/e2e/global-setup.ts` — read the first for why this no
 * longer defaults to port 3000, and the second for what happens when the
 * target is absent or is not this app. The short version: the suite starts the
 * build it is meant to test, on a port nothing else claims, or it fails.
 */
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT, E2E_SERVER_IS_MANAGED } from "./tests/e2e/e2e-target";

/**
 * Habilita el proyecto `e2e-live`, que recoge los `*.live.spec.ts`: los specs
 * que atraviesan un backend real, sin `page.route`, contra el entorno de QA
 * (`make qa-up`).
 *
 * Es opt-in, y no una detección automática, a propósito. Un proyecto que se
 * activa solo fallaría en todo checkout sin Docker, y una suite que a veces
 * corre esos specs y a veces no es peor que una que nunca los corre: nadie
 * sabría si la corrida verde probó la mutación real o simplemente la saltó.
 * `make qa-live` lo enciende explícitamente.
 */
const LIVE_ENABLED = process.env.E2E_LIVE === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  /* Los runners de ubuntu-latest tienen 4 vCPU. Con workers: 1 la suite creció
     a 156 tests y el paso E2E tardaba ~22 min corriendo de a un test. Con
     `fullyParallel: false` el paralelismo es POR ARCHIVO — los tests dentro de
     un spec siguen secuenciales, así que no hay estado compartido que romper.
     Local se mantiene 1 worker: los desarrolladores suelen tener otras cosas
     corriendo, y la suite local arranca el build ella misma. */
  workers: process.env.CI ? 4 : 1,
  reporter: [["html", { outputFolder: "playwright-report" }]],

  /* Runs before any browser is launched: a wrong or absent target stops the
     run here, with one message that names the address it probed. */
  globalSetup: "./tests/e2e/global-setup.ts",

  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },

  /* Omitted entirely when PLAYWRIGHT_BASE_URL names an external target, so the
     suite never starts a server it was not asked for and then tests a
     different one. */
  webServer: E2E_SERVER_IS_MANAGED
    ? {
        /* `next build` writes neither `public/` nor `.next/static` into the
           standalone output — that copy is the caller's job. CI already does it
           in its own "Prepare standalone" step; without the same copy here the
           local run served a build with no static assets at all, so every
           `next/image` request answered "isn't a valid image ... received null"
           and specs failed for reasons that had nothing to do with the code.
           Written to be safe to re-run: copying the CONTENTS of each directory
           never nests a second copy inside the previous one. */
        command: process.env.CI
          ? "node .next/standalone/server.js"
          : "pnpm build"
            + " && mkdir -p .next/standalone/public .next/standalone/.next/static"
            + " && cp -r public/. .next/standalone/public/"
            + " && cp -r .next/static/. .next/standalone/.next/static/"
            + " && node .next/standalone/server.js",
        url: E2E_BASE_URL,
        env: { PORT: String(E2E_PORT), HOSTNAME: "127.0.0.1" },
        /* Never adopt a process this run did not start. Reuse is exactly how
           the suite came to run, green, against a build that predated the
           branch under test. If the port is busy, Playwright says so. */
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      /* Los `*.live.spec.ts` necesitan el backend real del entorno de QA
         (`make qa-up`). Excluirlos acá mantiene la suite por defecto
         ejecutable en cualquier checkout, sin Docker y sin base sembrada.
         Los `*.mobile.spec.ts` se excluyen por lo contrario: corren en el
         proyecto de abajo, y correrlos acá los volvería a lo que ya eran. */
      testIgnore: /\.(live|mobile)\.spec\.ts$/,
    },
    /*
     * Un teléfono de verdad — issue #767.
     *
     * Hasta acá el único e2e de `/members` corría a 390×844 pero bajo
     * `devices["Desktop Chrome"]`: `isMobile: false`, `hasTouch: false` y, lo
     * que importaba, `pointer: fine`. Una ventana de escritorio angosta no es
     * un teléfono, y el auto-zoom que motivó el issue solo existe donde el
     * puntero es grueso — así que la suite no podía ver el defecto ni con el
     * viewport correcto.
     *
     * `Pixel 7` trae `isMobile: true`, `hasTouch: true` y `deviceScaleFactor`
     * reales. Un solo proyecto y un solo spec: el presupuesto de e2e en un
     * runner de 4 vCPU es el límite, y lo que este proyecto prueba —que la
     * media query dispara y que el CSS le gana a la clase del call site— se
     * prueba una vez o no se prueba.
     */
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testMatch: /\.mobile\.spec\.ts$/,
    },
    ...(LIVE_ENABLED
      ? [
          {
            name: "e2e-live",
            use: { ...devices["Desktop Chrome"] },
            testMatch: /\.live\.spec\.ts$/,
          },
        ]
      : []),
  ],
});
