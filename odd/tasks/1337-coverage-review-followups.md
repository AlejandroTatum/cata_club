# 1337 — Follow-ups advisory del review de #1328 (fallback inalcanzable, `None` ambiguo, caso null)

Issue: https://github.com/AlejandroTatum/cata_club/issues/1337
Branch: `chore/1337-coverage-review-followups` (worktree `cata_club-worktrees/gentleman-1337`, cortada de `origin/main` @ a0f9b8a; `origin/main` avanzó a ec0cb33 mientras corría este trabajo)
Delivery strategy: single PR, squash auto-merge (forecast/real ~292+71 líneas, bajo el presupuesto de ~400)
TDD: **on** (strict, config de sesión). Runners: frontend `cd frontend && pnpm vitest run <file>`; backend `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest <file> -q` (db-test en `localhost:5436`, single-tenant). El puerto 5436 quedó bloqueado por el sandbox de red del agente — cada corrida de pytest necesitó `dangerouslyDisableSandbox: true`; sin eso el conteo de RED/GREEN de abajo no se pudo tomar.
RDD: `on` (global, leído con `gentle-ai review mode status`). Candidato de review = el/los commit(s) de esta rama; el review nativo, el push y el PR quedan a cargo del orquestador (instrucción explícita del brief: este writer no corre `gentle-ai review`, no pushea, no abre PR).

## Objetivo

Cerrar los 3 hallazgos advisory del review nativo del PR que cerró #1328 (lineage `review-f2e832f1cad0aa0e`, aprobado, se cierran aparte). Criterio de cierre del issue: no queda código inalcanzable justificado por un comentario que lo promete; el DTO no tiene un `None` con dos significados.

## Hallazgos (del issue)

- **R4-001/R2-001/R3-001/R3-002** — `resolveCoverageEnd(pagos)` se conservaba en `frontend/src/app/student/page.tsx` y `frontend/src/app/student/payments/page.tsx` "para un backend viejo que omite el campo", pero `buildMembershipView` (`student-adapter.ts:149`) normaliza el campo ausente a `null` — la rama `=== undefined` era inalcanzable con cualquier payload real.
- **R2-002** — `cubierto_hasta = None` en `MembresiaResponseDTO` (`membresia_pago_schemas.py:~120-129`) solo lo poblaban `/mias` y `/persona/{id}`; en el resto de los endpoints que devuelven el mismo DTO, `None` significaba "no calculado", no "sin cobertura" — un `None` con dos lecturas distintas.
- **R3-003** — faltaba un test de página para `cubiertoHasta === null` con un pago aprobado existente: la forma que produce el adapter cuando no hay cobertura, sin cubrir en `StudentPage.test.tsx`.

## Decisiones de diseño (parent, verificadas antes de escribir)

- **Finding 1: se borra el fallback, no se preserva `undefined` en el adapter.** `coverageEnd` pasa de `cubiertoHasta !== undefined ? cubiertoHasta : resolveCoverageEnd(pagos)` a `selectedProfile?.membership?.cubiertoHasta ?? null` en ambos archivos — sin `useMemo` (lectura trivial, sin cálculo que memoizar). `resolveCoverageEnd` NO se borra de `student-utils.ts`: `frontend/src/app/profile/page.tsx:1631` lo sigue usando (contexto distinto, sin `MembershipSummary.cubiertoHasta` disponible ahí) y sus propios tests en `student-utils.test.ts` siguen vigentes.
- **Finding 2: mismo helper (`_con_cubierto_hasta`), aplicado a TODO endpoint que devuelve `MembresiaResponseDTO`.** En vez de un helper nuevo, `_con_cubierto_hasta(db, membresias)` (ya existía para `/mias` y `/persona/{id}`) se reusa también para el caso de UNA sola membresía (`_con_cubierto_hasta(db, [membresia])[0]`) — sigue siendo una consulta agrupada (bulk con una lista de 1 elemento), nunca N+1. Se aplicó a los 7 endpoints que faltaban: `POST /` (crear_membresia), `POST /propia` (crear_membresia_propia), `GET /` (listar_membresias, la cola paginada del dashboard admin), `GET /{id}` (obtener_membresia), `POST /{id}/suspender`, `POST /{id}/reactivar`, `POST /{id}/cambiar-plan`. Ningún endpoint quedó documentado como excepción: los 7 pueden resolver la ancla sin N+1, así que no hubo necesidad de la salida "documentar la garantía en el docstring en vez de calcularlo" que el issue habilitaba como alternativa.
- **`crear_membresia`/`crear_membresia_propia` son un caso especial pero NO una excepción de código.** Una membresía recién creada no puede tener todavía ningún `Pago` ni `CoberturaBonificada` propios (ambas tablas referencian `membresia_id`, que no existe hasta que `crear_membresia` retorna) — `cubiertoHasta: null` ahí es correcto por construcción, no por omisión. Se decidió pasar estos dos endpoints por el mismo helper de todos modos (uniformidad del contrato, protección ante un cambio de negocio futuro que sí traspase cobertura al crear), y el test que los cubre solo pina que la CLAVE está presente (`"cubiertoHasta" in resp.json()`), no un valor de `CoberturaBonificada` (imposible de fabricar en ese momento del flujo).
- **Docstring del DTO reescrito**, no solo el comentario del router: `membresia_pago_schemas.py` ahora dice explícitamente que el significado único de `None` aplica a los 7+2 endpoints, no solo a `/mias`/`/persona/{id}`.

## Alcance (autorizado)

- Frontend: `frontend/src/app/student/page.tsx`, `frontend/src/app/student/payments/page.tsx`, `frontend/src/app/student/__tests__/StudentPage.test.tsx`, `frontend/src/app/student/payments/__tests__/StudentPaymentsPage.test.tsx`.
- Backend: `backend/app/presentacion/routers/membresias_pagos_router.py`, `backend/app/servicios_negocio/dtos/membresia_pago_schemas.py`, `backend/tests/test_membresias_pagos.py`.
- No se tocó `student-utils.ts` (la función se queda, otro caller la sigue usando), ni `student-adapter.ts` (ya normalizaba correctamente desde #1328), ni ningún archivo fuera de esta lista.

## Tareas

- [x] T1 (Finding 1 — page.tsx): borrar la rama `undefined`/fallback, actualizar los tres comentarios que la prometían (prop doc de `Carnet`, comentario sobre por qué se hace fetch de `pagosState`, comentario sobre la fuente de `coverageEnd`), quitar el import ahora sin uso de `resolveCoverageEnd`.
- [x] T2 (Finding 1 — payments/page.tsx): mismo cambio, mismos tres puntos (doc del módulo, comentario de `coverageEnd`, import).
- [x] T3 (Finding 1 — tests rotos por el borrado): 7 tests en `StudentPage.test.tsx` y 11 en `StudentPaymentsPage.test.tsx` ejercitaban el fallback sin saberlo (mocks con `cubiertoHasta` ausente en vez de un payload real) — reescritos a la forma real (`cubiertoHasta` explícito por escenario, nunca omitido).
- [x] T4 (Finding 3): nuevo test `"omits the coverage end when MembershipSummary.cubiertoHasta is null, even with an approved payment"` en `StudentPage.test.tsx`, junto a los otros tests de vigencia del carnet/Cuota card.
- [x] T5 (Finding 2): `_con_cubierto_hasta` aplicado a los 7 endpoints que faltaban + docstring del DTO reescrito.
- [x] T6: verificación — archivos focales, suite frontend completa, suite backend completa (regla de DTO compartido), `make pre-pr LANE=full`.

## Criterios de aceptación

- Ningún comentario en `page.tsx`/`payments/page.tsx` promete un fallback que no existe en el código.
- `cubierto_hasta` llega poblado (con su único significado: sin cobertura = `null`) en los 9 endpoints que devuelven `MembresiaResponseDTO`.
- Test de página cubre `cubiertoHasta === null` con un pago aprobado existente.
- Suite frontend completa y suite backend completa en verde; `make pre-pr LANE=full` corrido una vez.

## Evidencia

### T1+T2 (Finding 1 — borrado del fallback)

- Es un borrado puro: la comprobación es lectura de vuelta + la suite en verde, no un RED/GREEN de comportamiento nuevo (documentado así en el brief). La única pieza que sí necesitaba un RED real es el test nuevo de Finding 3 (T4, abajo).
- Al correr `pnpm vitest run src/app/student/__tests__/StudentPage.test.tsx` inmediatamente después del borrado (antes de tocar los tests), **RED real observado**: 7 tests fallaron — `keeps the payment verdict off the carnet…`, `states the real coverage end on the carnet…`, `reads the register as label-left…`, `reports coverage from the furthest approved payment…`, y los 3 de "Cuota card earns its space" (overdue/muted-ink/al día) — todos porque sus mocks omitían `cubiertoHasta` a propósito para ejercitar el viejo fallback. Confirma que el fallback SÍ estaba en uso por la suite, no solo alcanzable en teoría.
- Reescritos con `cubiertoHasta` explícito por escenario (ver diff). `pnpm vitest run src/app/student/__tests__/StudentPage.test.tsx` → **112 passed** (111 antes + el nuevo de T4).
- Mismo patrón en `StudentPaymentsPage.test.tsx`: 11 tests fallaron por la misma razón (mocks con `membership` sin `cubiertoHasta` combinados con distintos `pagos`). Se fijó un default realista en `SELF.membership.cubiertoHasta = COVERAGE_END` (espeja el `makePago()` por defecto) y overrides explícitos por test donde el escenario difiere (coverage vencida, sin pagos aprobados, cobertura futura). `pnpm vitest run src/app/student/payments/__tests__/StudentPaymentsPage.test.tsx` → **80 passed**.

### T4 (Finding 3 — `cubiertoHasta === null` con un pago aprobado)

- **RED** — mutación temporal: se restauró el fallback viejo en `page.tsx` (`cubiertoHasta ?? (pagosState.status === "ready" ? resolveCoverageEnd(pagosState.pagos) : null)`, con el import de `resolveCoverageEnd` restaurado también). Corriendo solo el test nuevo (`pnpm vitest run ... -t "omits the coverage end when MembershipSummary.cubiertoHasta is null"`) → **1 failed**: `expect(element).not.toBeInTheDocument()` — encontró `<span>Válido hasta</span>`, prueba de que el pago aprobado (2026-07-31) se colaba pese al `cubiertoHasta: null` explícito. Revertida la mutación.
- **GREEN** — `pnpm vitest run src/app/student/__tests__/StudentPage.test.tsx` → **112 passed**.

### T5 (Finding 2 — `cubierto_hasta` en todos los endpoints)

- **RED** — 5 tests nuevos corridos ANTES de tocar el router (`pytest tests/test_membresias_pagos.py -q -k "incluye_cubierto_hasta"`, con `dangerouslyDisableSandbox` porque el sandbox de red del agente bloqueaba `localhost:5436`): `test_listar_membresias_admin_incluye_cubierto_hasta`, `test_obtener_membresia_incluye_cubierto_hasta`, `test_suspender_membresia_incluye_cubierto_hasta`, `test_reactivar_membresia_incluye_cubierto_hasta`, `test_cambiar_plan_membresia_incluye_cubierto_hasta` → **5 failed** (`AssertionError: assert None == '2026-11-30'` en los cinco). El sexto test (`test_crear_membresia_incluye_la_clave_cubierto_hasta`) ya pasaba (la clave siempre estuvo presente con default `None`; lo que faltaba era la garantía semántica, no la clave).
- **GREEN** — `pytest tests/test_membresias_pagos.py -q` → **49 passed** (43 preexistentes + 6 nuevos).
- **Full backend suite** (regla de DTO compartido — un campo nuevo en un DTO compartido una vez causó un lazy-load fuera del threadpool en una ruta no relacionada): `pytest tests/ -q` → **2872 passed, 3 skipped** en 552s. Sin regresiones.

### T6 — Verificación del parent

- `cd frontend && pnpm vitest run` (suite completa) → **303 test files, 5167 tests, todos passed** (260.95s).
- `cd backend && pytest tests/ -q` (suite completa, ya reportada en T5) → **2872 passed, 3 skipped**.
- `make pre-pr LANE=full` → **verde, exit code 0** (segunda corrida; la primera falló por un error propio del writer, ver "Gotcha" abajo). Desglose: `ruff check` + `lint-imports` + `pip-audit` en verde; `pytest tests/` → 2872 passed, 3 skipped; `pytest ../tests/` (`test-root`) → 633 passed, 1 skipped; `pnpm audit --audit-level=high` sin hallazgos altos; `pnpm type-check` y `pnpm lint` en verde; `pnpm run test:coverage` → 303 test files / 5167 tests passed; `pnpm build` verde; `pnpm exec playwright test` → **218 passed** (3.0m, Chromium + mobile-chromium). `db-test` (`gentleman-1337-db-test-1`) confirmado removido al cierre (`docker compose --profile test rm -sf db-test`).
- **Gotcha del writer** (no es un defecto del código bajo prueba): la primera corrida de `JWT_SECRET_KEY=x make pre-pr LANE=full` falló en `test-backend-preflight` con `pydantic_core.ValidationError: JWT_SECRET_KEY no es seguro`. Causa: el Makefile solo scopea la clave de descarte a la línea de `docker compose` (`JWT_SECRET_KEY="${JWT_SECRET_KEY:-clave-de-descarte-solo-para-compose}"`), pero exportarla para TODO el comando `make` (como pide el brief para el `docker compose --profile test up -d db-test` standalone) también llega al subproceso `pytest` — que exige una clave larga. Reclasificado como determinista-por-invocación-propia (no transitorio, no heredado de la base); corregido corriendo `env -u JWT_SECRET_KEY make pre-pr LANE=full` para no propagar la clave corta.
