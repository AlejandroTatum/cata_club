# 1349 — Follow-ups advisory del review de #1348 (nombre de test, lectura post-create, `/propia` sin test, async con SQLAlchemy síncrono)

Issue: https://github.com/AlejandroTatum/cata_club/issues/1349
Branch: `chore/1349-coverage-followups-2` (worktree `cata_club-worktrees/gentleman-1349`, cortada de `origin/main` @ cdbd34c)
Delivery strategy: single PR (decisión del orquestador; este writer no pushea ni abre PR)
TDD: **on** (strict, config de sesión). Runners: frontend `cd frontend && pnpm vitest run <file>`; backend `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL uv run pytest <file> -q` (db-test en `localhost:5436`, single-tenant, puerto compartido con otro writer — se esperó a que quedara libre).
RDD: no se corre desde este writer (instrucción explícita del brief: no `gentle-ai review`, no push, no PR — queda a cargo del orquestador).

## Objetivo

Cerrar los 8 hallazgos advisory del review nativo del PR que cerró #1348 (issue #1337, lineage `review-5bbd8947ecebc0af`, aprobado, se cierran aparte).

## Hallazgos (del issue)

1. **R2-001/R3-002** — `StudentPaymentsPage.test.tsx` conservaba un test nombrado "derives coverage from the furthest approved payment..." cuyo setup de dos pagos quedó inerte tras el paso a `cubiertoHasta`.
2. **R4-001** — `crear_membresia`/`crear_membresia_propia` leían `cubierto_hasta` de vuelta tras el alta con `_con_cubierto_hasta`, una consulta demostrablemente vacía (una membresía recién creada no puede tener cobertura todavía) que convertía un error transitorio de BD en un 500 sobre un POST ya completado.
3. **R3-001** — `POST /membresias/propia` era el único endpoint recableado en #1337 sin test del contrato.
4. **R2-002** — "todo endpoint que expone `MembresiaResponseDTO` pasa por `_con_cubierto_hasta`" vivía solo en un comentario, sin test que lo verificara.
5. **R2-003** — dos punteros "ver su docstring" apuntaban a un bloque `#`, no a un docstring real, en `_con_cubierto_hasta`.
6. **R4-002** — un fallo en el enriquecimiento post-mutación de `suspender`/`reactivar`/`cambiar-plan` no dejaba rastro: la acción ya había ocurrido (commit propio de cada servicio) pero el 500 resultante no era diagnosticable.
7. **R4-003** — `listar_membresias`, `crear_membresia`, `crear_membresia_propia`, `obtener_membresia` seguían `async def` pese a correr SQLAlchemy síncrono (bloqueante para el event loop), a diferencia de sus hermanos `suspender`/`reactivar`/`cambiar-plan`, que ya son `def`.
8. **R1-001** — varios `odd/tasks/*.md` pegaban la cadena de conexión placeholder del `db-test` local en vez de referenciar `$TEST_DATABASE_URL`.

## Decisiones de diseño (ya tomadas por el orquestador, verificadas antes de escribir)

- **Item 2**: nuevo helper privado `_recien_creada_sin_cobertura(membresia)` en el router, reusado por los dos endpoints de alta — construye el DTO con `cubierto_hasta=None` directo (`model_validate(...).model_copy(update=...)`, mismo patrón que `_con_cubierto_hasta`), sin ninguna consulta. Los tests de presencia de clave (`test_crear_membresia_incluye_la_clave_cubierto_hasta`, y el nuevo de `/propia`) se conservan sin cambios de comportamiento observable.
- **Item 4**: el test router-wide introspecciona `router.routes` en vivo (nunca una lista de rutas copiada a mano) y compara el conjunto contra un registro de llamadas HTTP reales; si el router agrega o quita una ruta que expone `MembresiaResponseDTO` (directo, `List[...]`, o el `items` de `PaginatedResponse[...]`), el test falla pidiendo actualizar el registro.
- **Item 5**: el bloque `#` sobre `_con_cubierto_hasta` pasa a ser el docstring de la función; el puntero de `crear_membresia` desaparece naturalmente con el rewrite del item 2 (ya no llama a `_con_cubierto_hasta`), y el puntero de `membresia_pago_schemas.py` se reescribe para nombrar los dos helpers.
- **Item 6**: `try/except Exception` alrededor de la llamada a `_con_cubierto_hasta` en los tres endpoints de mutación, con `logger.exception(...)` (logger `cataclub.membresias_pagos`, mismo patrón `logging.getLogger("cataclub.<módulo>")` que el resto del backend) logueando el id de membresía antes de re-lanzar — la respuesta sigue siendo un 500 (no hay DTO parcial honesto que devolver), pero ahora es diagnosticable.
- **Item 7**: conversión mecánica `async def` → `def` en los cuatro handlers; sin cambio de comportamiento (FastAPI corre los `def` síncronos en el threadpool). Se corre la suite backend COMPLETA después, no solo el archivo focal (precedente: un campo nuevo en un DTO compartido rompió una ruta no relacionada por lazy-loading fuera del threadpool).
- **Item 8**: `$TEST_DATABASE_URL` reemplaza la cadena pegada en los 4 `odd/tasks/*.md` que la tenían (7 ocurrencias), incluyendo líneas de evidencia `GREEN` históricas.

## Alcance (autorizado)

- Frontend: `frontend/src/app/student/payments/__tests__/StudentPaymentsPage.test.tsx`.
- Backend: `backend/app/presentacion/routers/membresias_pagos_router.py`, `backend/app/servicios_negocio/dtos/membresia_pago_schemas.py`, `backend/tests/test_membresias_pagos.py`, `backend/tests/test_membresia_propia_autoservicio.py`.
- Docs: `odd/tasks/1337-coverage-review-followups.md`, `odd/tasks/1335-comprobantes-review-followups.md`, `odd/tasks/1311-endurecer-metricas-outbox.md`, `odd/tasks/1340-dependent-review-followups.md`, y este documento.

## Tareas

- [x] T1 (item 1 — nombre de test): renombrado + setup inerte eliminado en `StudentPaymentsPage.test.tsx`.
- [x] T2 (item 8 — cadena de conexión): `$TEST_DATABASE_URL` en los 4 documentos `odd/tasks/*.md`.
- [x] T3 (item 2 — lectura post-create): `_recien_creada_sin_cobertura` en el router, usado por `crear_membresia`/`crear_membresia_propia`.
- [x] T4 (item 5 — docstring): bloque `#` de `_con_cubierto_hasta` promovido a docstring; puntero de `membresia_pago_schemas.py` reescrito.
- [x] T5 (item 3 — test `/propia`): nuevo test de contrato en `test_membresia_propia_autoservicio.py`.
- [x] T6 (item 4 — invariante del router): nuevo test router-wide en `test_membresias_pagos.py`.
- [x] T7 (item 6 — log de enriquecimiento fallido): `try/except` + `logger.exception` en los tres endpoints de mutación, con 3 tests (RED→GREEN).
- [x] T8 (item 7 — `async def` → `def`): conversión de los 4 handlers + suite backend completa.
- [x] T9: verificación final — archivo focal, suite backend completa, `make pre-pr LANE=full`.

## Criterios de aceptación

- Ningún test nombra una derivación que no existe.
- Los dos caminos de alta no leen después de escribir.
- `/propia` y la invariante del router tienen test.

## Evidencia

### T1 (item 1 — nombre de test)

- Baseline: `pnpm vitest run src/app/student/payments/__tests__/StudentPaymentsPage.test.tsx` → **80 passed**.
- Rename puro + borrado del setup inerte (sin cambio de comportamiento, sin RED/GREEN de comportamiento nuevo aplicable). Tras el cambio: **80 passed** (mismo total, mismo test, nuevo nombre y sin el mock de dos pagos que no aportaba nada).

### T2 (item 8 — cadena de conexión)

- `rg -l 'usuario:password@localhost:5436' odd/tasks` → sin resultados tras el cambio (7 ocurrencias reemplazadas en 4 archivos).

### T3 (item 2 — lectura post-create)

- Refactor puro (sin cambio de comportamiento observable): nuevo helper `_recien_creada_sin_cobertura` reusado por `crear_membresia`/`crear_membresia_propia`, sin ninguna consulta a `PagoServicio`. Se prueba por la suite (T5/T6/T9), no por un RED/GREEN propio.

### T4 (item 5 — docstring)

- Documentación pura, sin comportamiento. `rg -n "ver su docstring"` tras el cambio: ambos punteros apuntan a docstrings reales (`_con_cubierto_hasta` y `_recien_creada_sin_cobertura`).

### T5 (item 3 — test `/propia`)

- `TEST_DATABASE_URL=$TEST_DATABASE_URL uv run pytest tests/test_membresia_propia_autoservicio.py -q` → **8 passed** (7 preexistentes + 1 nuevo, `test_endpoint_propia_incluye_la_clave_cubierto_hasta`).

### T6 (item 4 — invariante del router)

- `TEST_DATABASE_URL=$TEST_DATABASE_URL uv run pytest tests/test_membresias_pagos.py -q` → **53 passed** (49 preexistentes + 4 nuevos: el router-wide de T6 + los 3 de T7).
- El test introspecciona `router.routes` en vivo; confirma en el mismo `assert` que las 9 rutas reales (`POST /`, `POST /propia`, `GET /`, `GET /mias`, `GET /persona/{persona_id}`, `GET /{membresia_id}`, `POST /{membresia_id}/suspender`, `POST /{membresia_id}/reactivar`, `POST /{membresia_id}/cambiar-plan`) coinciden con el registro de llamadas HTTP, y que las 9 respuestas traen `cubiertoHasta`.

### T7 (item 6 — log de enriquecimiento fallido)

- **RED real observado**: se revirtieron temporalmente los tres `try/except` a un `return` simple y se corrió `pytest tests/test_membresias_pagos.py -q -k "loguea_el_id_si_falla"` → **3 failed** (`AssertionError: assert '1' in ''` en los tres, `caplog.text` vacío porque nada logueaba todavía).
- Se restauró el `try/except Exception: logger.exception(...); raise` en `suspender_membresia`/`reactivar_membresia`/`cambiar_plan_membresia`.
- **GREEN** — `TEST_DATABASE_URL=$TEST_DATABASE_URL uv run pytest tests/test_membresias_pagos.py -q -k "loguea_el_id_si_falla"` → **3 passed**.

### T8 (item 7 — `async def` → `def`)

- Conversión mecánica de `crear_membresia`, `crear_membresia_propia`, `listar_membresias`, `obtener_membresia`. Sin `await` residual (verificado). Se prueba por la suite backend completa (T9), regla de "un DTO/threadpool compartido una vez rompió una ruta no relacionada por lazy-loading".

### T9 — Verificación final

- `TEST_DATABASE_URL=$TEST_DATABASE_URL uv run pytest tests/ -q` (suite backend completa) → **2880 passed, 3 skipped** en 586.64s.
- Segunda corrida completa, ya con el item 7 reaplicado → **1 failed** (`test_auth_perfil_propio.py::test_reemplazar_foto_perfil_produce_una_url_distinta_a_la_anterior`), archivo sin relación con este trabajo (foto de perfil, `auth`). Clasificado **transitorio/orden-dependiente, no causado por este cambio**: `pytest tests/test_auth_perfil_propio.py -q` en aislamiento → **20 passed** (el mismo test, solo). Tercera corrida completa → **2880 passed, 3 skipped**, sin el fallo. No se tocó ningún archivo de `auth`/`perfil`/`foto` en esta rama.
- `env -u JWT_SECRET_KEY make pre-pr LANE=full` → **exit code 0**. Backend: `ruff check` + `lint-imports` + `pip-audit` + `test-backend-preflight` (db-test) + `test-root`, todos verdes (el lane se detiene en el primer fallo; llegó limpio hasta el final). Frontend: `pnpm audit --audit-level=high`, `pnpm type-check`, `pnpm lint`, `pnpm run test:coverage`, `pnpm build`, `pnpm exec playwright test` → **218 passed** (Chromium + mobile-chromium, 2.8m), todos verdes.
- `db-test` (`gentleman-1349-db-test-1`) confirmado removido al cierre (`docker compose --profile test rm -sf db-test`, `docker ps` sin el contenedor).
- Puerto 5436 compartido con otro writer (`gentleman-1345-db-test-1`) al inicio de la sesión: se esperó con un poller de 60s (liberado dentro de la ventana de 40 minutos) en vez de forzar el arranque.
