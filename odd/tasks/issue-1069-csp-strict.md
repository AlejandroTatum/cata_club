# Issue #1069 — Content-Security-Policy estricta (fase 3)

Repo: AlejandroTatum/cata_club · Worktree: `~/devwork/apps/cata_club-worktrees/pi-1069` · Branch: `security/csp-strict-1069` (base `origin/main` @ 0390b6d)

## Context

- Fase 1 (PR #1095, mergeada 2026-09-06): `Content-Security-Policy-Report-Only` en `Caddyfile` + endpoint propio `/api/csp-report` (`frontend/src/app/api/csp-report/route.ts`, loguea violaciones).
- **Decisión del owner (2026-09-15)**: la fase Report-Only corrió ≥1 semana en el servidor **sin violaciones**; aprobaron pasar a CSP estricta con **nonce por request generado en middleware** (`script-src 'self' 'nonce-X' 'strict-dynamic' 'unsafe-inline'`), no CSP estática con `unsafe-inline`.
- Consecuencia arquitectónica: la CSP con nonce no puede ser estática en Caddy → **el middleware de Next es el dueño de la CSP**; Caddy deja de emitir cualquier CSP (dos CSP enforcing se intersectan y la estática rompería la nonceada).
- Inventario de orígenes verificado en fase 1 (ver comentarios del `Caddyfile`): img Cloudinary + tiles OSM, frame Cloudinary, connect/font self, styles inline (`style={{}}` en 13 archivos), scripts inline de hidratación RSC de Next.

## Tasks

- [x] T1 — Middleware emite CSP estricta con nonce por request (`frontend/src/middleware.ts`): nonce Web Crypto (edge-safe), CSP en headers de request (Next 15 la auto-aplica a sus scripts) y de response, conservando intacta la lógica de redirects de auth; matcher extendido a todas las rutas de documento (excluir `_next/static` y estáticos). **Complemento: `export const dynamic = "force-dynamic"` en `frontend/src/app/layout.tsx` (ver Evidence log).**
- [x] T2 — `Caddyfile`: quitar `Content-Security-Policy-Report-Only` y reemplazar el bloque de comentarios por la historia de ownership (CSP dinámica en middleware; Caddy no debe emitir CSP).
- [x] T3 — Tests del borde: reemplazado por `test_el_caddyfile_no_declara_ninguna_csp_y_el_middleware_la_emite_estricta` (`tests/test_docker_compose_config.py`): Caddyfile sin CSP de ningún tipo + middleware con `Content-Security-Policy`, nonce, `strict-dynamic` y `report-uri /api/csp-report`.
- [x] T4 — Tests frontend: unit del middleware agregados a `middleware-utils.test.ts` (nonce distinto por request, CSP en response y redirects, paths no protegidos) + spec e2e local `tests/e2e/csp-strict.spec.ts`. **Verde tras force-dynamic.**
- [x] T5 — Ajustes menores: doc comment de `api/csp-report/route.ts` actualizado (enforcing) y auditoría limpia: cero `dangerouslySetInnerHTML`, `<object>`, `<embed>`, `<applet>`; los `on*` hallados son handlers sintéticos de React (no CSP-relevantes); `next.config.js` sin `headers()` con CSP.
- [ ] T6 — Validación: tests enfocados → build + e2e local → `make test-root` → `make pre-pr LANE=full` (cambio cross-cutting: frontend + Caddyfile + tests raíz). **Focos ejecutados y verdes: vitest 18/18; build (0 rutas prerenderizadas, todas ƒ Dynamic); e2e `csp-strict.spec.ts` verde; pytest `-k csp` verde; `make test-root` 625 passed / 1 skipped. Pendiente: `make pre-pr LANE=full` (queda para T7/delivery).**
- [ ] T7 — Entrega: PR a `main` con auto-merge squash, monitoreo de CI, post-merge `main` verde, cleanup de worktree. Follow-up aparte: actualizar `security/privacy-retention.md` en `cata_club-docs` (hoy dice "CSP del sitio: falta a propósito").

## Evidence log

- 2026-09-15: fase 1 verificada en main; sin violaciones reportadas por el owner; decisión nonce+strict-dynamic aprobada.
- 2026-09-15 (fase 3, T1–T5): implementación completa. **BLOQUEANTE arquitectónico detectado por el e2e:** TODAS las rutas de documento estaban prerenderizadas como estáticas (`.next/prerender-manifest.json`: `/`, `/login`, `/dashboard`, …), y Next.js solo auto-estampa el nonce del middleware en páginas renderizadas DINÁMICAMENTE — el HTML estático sale del cache de build sin nonce y sin `strict-dynamic` se bloquean los chunks propios (`webpack-*.js`, `main-app-*.js`, scripts inline), matando la hidratación. Evidencia observada: `scripts with nonce: 0` de 25 en `/`; reportes CSP enforce por chunk.
- 2026-09-15 (fase 3, resolución): el owner aprobó la arquitectura nonce+strict-dynamic tal cual; se agregó `export const dynamic = "force-dynamic"` en `frontend/src/app/layout.tsx` con comentario. Razonal: las páginas son shells livianos que ya traen su dato por fetch client-side (`/api/schedules`, sesiones, etc.), así que el costo de rendering dinámico es mínimo; la ganancia es que el nonce llega a TODOS los documentos. Verificado post-fix: `prerender-manifest.json` con 0 rutas, build lista todas las rutas como ƒ (Dynamic), e2e de hidratación+CSP verde.
