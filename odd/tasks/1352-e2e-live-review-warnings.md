# 1352 — Follow-ups de los 6 WARNING del review nativo de #1352

Issue: ninguno (chore/test de seguimiento a un review, sin bug de negocio; no requiere `Closes #N`).
PR base: `6534517` (#1352, `test(e2e-live): fix the five red specs of the daily QA cron`, ya mergeado en `main`).
Branch: `test/1352-e2e-live-review-warnings` (worktree `cata_club-worktrees/gentleman-1352fu`, cortada de `origin/main` @ 6534517).
Delivery strategy: single PR (forecast bajo el presupuesto de ~400 líneas).
TDD: **on** (strict, config de sesión). Runner frontend: `cd frontend && pnpm exec vitest run <file>`.
RDD: no evaluado por este writer (brief no pidió correr `gentle-ai review`).

## Objetivo

Cerrar los 6 hallazgos WARNING del review nativo de #1352 (R2-001, R2-003, R2-004, R3-cleanup-expect-masks-primary-failure, R3-cloudinary-gate-defaults-to-skip, R4-001), sin tocar el comportamiento ya verificado del PR mergeado.

## Hallazgos y su fix

- **R2-001** — `formatFechaDDMMYYYY` se había insertado entre el docstring de `leerTextoEstable` y la función misma, dejando el docstring huérfano sobre un formateador ajeno. Fix: reordenado — `formatFechaDDMMYYYY` (con su propio doc) va primero, `leerTextoEstable` recupera su docstring inmediatamente encima.
- **R2-003 / R3-cleanup-expect-masks-primary-failure** (mismo hallazgo, dos revisores) — el `finally` del test "un beneficio del 100%..." hacía `expect(relogin.ok()).toBe(true)` directo: si la aserción real del `try` fallaba Y la reautenticación de limpieza también fallaba (mismo backend caído tumba a ambas), la excepción del `finally` reemplazaba la del `try` — se perdía el diff real y nunca se llegaba a `retirarBeneficio`. Fix: nuevo helper puro `runCleanupWithoutMasking` (`tests/e2e/helpers/finally-guard.ts`) — captura el error primario en un `catch`+rethrow, y en el `finally` corre la limpieza (relogin + `retirarBeneficio`) a través del guard: si ya hay un error primario, una falla de limpieza se reporta aparte (`console.error`) en vez de reemplazarlo; si no lo hay, se relanza tal cual.
- **R2-004 / R3-cloudinary-gate-defaults-to-skip** (parte del mensaje, mismo hallazgo en dos revisores) — el motivo de skip decía "corra con credenciales reales en .env para cubrirlo", pero el gate real es `E2E_CLOUDINARY_CONFIGURED === "1"`, que SOLO fija `make qa-live`; un developer con credenciales reales que corre Playwright directo ve los 3 tests salteados con un motivo que apunta al lugar equivocado. Fix: reescrito el motivo de skip y el docstring de `CLOUDINARY_CONFIGURED` para nombrar el switch real (`E2E_CLOUDINARY_CONFIGURED=1` / `make qa-live`) y decir explícitamente que correr Playwright directo saltea igual, tenga o no credenciales el backend. No se tocó el mecanismo del gate en sí (decisión deliberada de T8 en `odd/tasks/1341-e2e-live-red.md`: preguntarle al backend YA LEVANTADO, nunca parsear `.env`) — eso es diseño existente, no un defecto de este PR.
- **R4-001** — la parte del mismo hallazgo del lado del Makefile: el probe `... 2>/dev/null || echo 0` colapsaba CUALQUIER falla del `compose exec` (proyecto mal levantado, `QA_COMPOSE`/`QA_ENV` equivocado, daemon con error, backend reiniciándose) al mismo valor que "Cloudinary no configurado", sin ninguna señal visible. Fix: solo se captura STDOUT del `exec` (nunca `2>&1`, esa variante se probó y se descartó porque un WARN benigno de Compose en stderr rompía la comparación y abortaba la suite entera sin necesidad); el estado de salida del `exec` se chequea aparte, y un `case` solo acepta literalmente `0` o `1` en stdout — cualquier otra cosa hace fallar el target (`exit 1`) con el detalle en stderr, en vez de asumir "no configurado". El valor calculado se imprime una vez (`echo "qa-live: E2E_CLOUDINARY_CONFIGURED=$$cloudinary"`) para que la causa del salteo quede visible en el log. (Corregido en el follow-up de review de #1356, R1: la evidencia de arriba describía la variante `2>&1` abandonada, no la que efectivamente se mergeó.)

## Alcance (autorizado)

- `frontend/tests/e2e/discount-payment-effect.live.spec.ts` (R2-001, R2-003/R3-cleanup)
- `frontend/tests/e2e/transfer-payment-comprobante.live.spec.ts` (R2-004/R3-cloudinary — mensaje)
- `Makefile` (R4-001 — target `qa-live`)
- `frontend/tests/e2e/helpers/finally-guard.ts` (nuevo, helper puro para R2-003/R3-cleanup)
- `frontend/tests/e2e/helpers/__tests__/finally-guard.unit.test.ts` (nuevo, prueba unitaria del helper)
- `frontend/vitest.config.ts` (un glob nuevo en `include` para que Vitest recoja el test unitario de arriba)

## Tareas

- [x] T1 (R2-001) — reordenar el docstring huérfano.
- [x] T2 (R2-003/R3-cleanup) — extraer `runCleanupWithoutMasking`, TDD real (RED con la implementación ingenua pre-fix, GREEN con el guard), cablear en el `finally` del test del 100%.
- [x] T3 (R2-004/R3-cloudinary) — mensaje de skip y docstring honestos sobre el switch real.
- [x] T4 (R4-001) — Makefile: distinguir "exec falló" de "0/no configurado", imprimir el valor calculado.
- [x] T5 — verificación: `pnpm run type-check`, `eslint` en los archivos tocados, `pnpm run test:coverage`, `make qa-up` (antes de commitear, con `HEAD == origin/main`), `make qa-live` (specs afectados), `make qa-down` + `docker compose -p cataclub-qa ps -a` vacío, `cd backend && uv run pytest ../tests/test_e2e_live_workflow.py -q` (Makefile tocado).

## Criterios de aceptación

- Los 6 hallazgos WARNING quedan resueltos según lo que cada uno pide textualmente.
- `discount-payment-effect.live.spec.ts` y `transfer-payment-comprobante.live.spec.ts` siguen en verde contra el stack de QA real.
- `tests/test_e2e_live_workflow.py` sigue en verde (el Makefile se tocó).
- Ningún archivo fuera del alcance autorizado.

## Evidencia

### T2 (R2-003/R3-cleanup) — TDD del helper

- **RED real observado**: se reemplazó temporalmente `runCleanupWithoutMasking` por la implementación ingenua pre-fix (`await cleanup()` directo, ignorando `primaryError`) y se corrió `pnpm exec vitest run tests/e2e/helpers/__tests__/finally-guard.unit.test.ts` → **1 failed** (el test de regresión R2-003/R3-cleanup): `AssertionError: promise rejected "Error: no se pudo reautenticar como admin…" instead of resolving` — prueba que sin el guard, la falla de limpieza sí reemplaza al error primario.
- Restaurada la implementación real → `pnpm exec vitest run tests/e2e/helpers/__tests__/finally-guard.unit.test.ts` → **3 passed** (GREEN).

### T5 (verificación completa)

Ver la sección de verificación del reporte final del writer (tabla de checks) — incluye `type-check`, `eslint`, `test:coverage`, `make qa-live` corrido dos veces (specs afectados) contra el stack real de QA, `make qa-down`, y la suite backend del workflow.
