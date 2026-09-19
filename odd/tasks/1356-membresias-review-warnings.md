# 1356 — WARNING follow-ups del review nativo de #1356

Sin issue vinculado (chore, no bug fix con causa raíz separada).
Branch: `chore/1356-membresias-review-warnings` (worktree `cata_club-worktrees/gentleman-1356fu`, cortada de `origin/main` @ bd14b6c).
Delivery strategy: PR único (instrucción explícita del brief; este writer no pushea ni abre PR).
TDD: **on** (strict, config de sesión). Runner backend: `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest <file> -q` (db-test en `localhost:5436`, single-tenant; levantado con `env JWT_SECRET_KEY=x docker compose --profile test up -d --wait db-test`, la variable solo en ese comando puntual). El sandbox bloquea `127.0.0.1:5436`: pytest y `make pre-pr` corren con el sandbox deshabilitado, en foreground.
RDD: no se corre desde este writer (instrucción explícita del brief).

## Objetivo

Cerrar los 4 hallazgos WARNING del review nativo de la PR que cerró #1356 (`bd14b6c`, merge de "apply the review follow-ups of #1348").

## Hallazgos

1. **R2-001** — `_recien_creada_sin_cobertura` (router) está documentada por un bloque `#` sobre el `def`, no por un docstring, pero dos punteros nuevos dicen "ver su docstring" sobre ella (`membresias_pagos_router.py:204`, `membresia_pago_schemas.py:127`) — reintroduce la clase de defecto R2-003 (puntero colgante), y la evidencia de T4 en `odd/tasks/1349-coverage-followups-2.md` afirmaba, en falso, que ambos punteros ya resolvían a docstrings reales.
2. **R3-001** — el helper de test `_llamar_propia` solo restauraba el override anterior de `decodificar_token` `if anterior is not None`; sin override previo, la identidad REPRESENTANTE del portal quedaba pegada en la app de FastAPI compartida y se filtraba a la llamada admin-only siguiente.
3. **R3-002** — los tres tests de R4-002 (`suspender`/`reactivar`/`cambiar-plan` loguean el id si falla el enriquecimiento) probaban el log con `str(membresia.id) in caplog.text`, que con ids chicos no fija logger, nivel ni `exc_info` — cualquier línea capturada que contenga ese dígito satisface la comparación.
4. **R3-003** — `_recien_creada_sin_cobertura` hardcodea `cubierto_hasta=None` bajo la premisa de que ningún camino de alta adjunta `Pago`/`CoberturaBonificada` todavía; esa invariante vivía solo en un comentario, sin ningún test que la fijara contra la base.

## Decisiones de diseño

- **Item 1**: el bloque `#` sobre `_recien_creada_sin_cobertura` (router) pasa a ser su docstring real, mismo patrón que `_con_cubierto_hasta`. Los dos punteros "ver su docstring" no cambian de texto -- ahora son ciertos. Se corrige además la línea de evidencia falsa de T4 en `odd/tasks/1349-coverage-followups-2.md`.
- **Item 2**: `_llamar_propia` se saca del closure anidado de `test_todo_endpoint_que_expone_membresia_response_dto_incluye_cubierto_hasta` a una función de módulo (`client`, `persona_id`, `tipo_membresia_id` como parámetros), para que un test de regresión dedicado pueda ejercer exactamente el mismo helper que usa la producción de tests. El restore pasa a ser incondicional: si había override previo se restaura, si no lo había se hace `pop`.
- **Item 3**: helper `_unico_registro_de_error(caplog, logger_name)` reusado por los tres tests -- filtra `caplog.records` por `logger_name` y `levelno == logging.ERROR`, exige exactamente un registro con `exc_info` adjunto, y el assert final compara `str(membresia.id) in registro.getMessage()` (mensaje YA formateado) en vez de `caplog.text`.
- **Item 4**: en los dos tests de "incluye la clave cubiertoHasta" de las altas (`test_crear_membresia_incluye_la_clave_cubierto_hasta`, `test_endpoint_propia_incluye_la_clave_cubierto_hasta`), se agrega la verificación contra la base: cero filas de `Pago`/`CoberturaBonificada` referencian la membresía recién creada, y `PagoServicio.fecha_fin_maxima_combinada_bulk` (la misma lectura que usa `_con_cubierto_hasta`) da `None` para esa membresía.

## Alcance (autorizado)

- Backend: `backend/app/presentacion/routers/membresias_pagos_router.py`, `backend/tests/test_membresias_pagos.py`, `backend/tests/test_membresia_propia_autoservicio.py`.
- Docs: `odd/tasks/1349-coverage-followups-2.md`, este documento.

## Tareas

- [x] T1 (R2-001 — docstring): bloque `#` de `_recien_creada_sin_cobertura` promovido a docstring; evidencia falsa de T4 en `odd/tasks/1349-coverage-followups-2.md` corregida.
- [x] T2 (R3-001 — fuga de identidad del portal): `_llamar_propia` a nivel de módulo con restore incondicional; nuevo test de regresión con `client_sin_token` (RED→GREEN observado).
- [x] T3 (R3-002 — aserción débil del log): `_unico_registro_de_error` + los tres tests reescritos contra `caplog.records` (RED por mutación→GREEN observado).
- [x] T4 (R3-003 — invariante sin pin): assert de cero filas `Pago`/`CoberturaBonificada` + comparación contra `PagoServicio.fecha_fin_maxima_combinada_bulk` en los dos tests de alta (RED por fila de cobertura adjunta→GREEN observado).
- [x] T5: verificación final — suite backend completa, `make pre-pr LANE=backend`.

## Evidencia

### T1 (R2-001 — docstring)

- Documentación pura, sin comportamiento observable. `rg -n "def _recien_creada_sin_cobertura" -A1 backend/app/presentacion/routers/membresias_pagos_router.py` confirma que la línea siguiente al `def` es `"""`, no `#`.

### T2 (R3-001 — fuga de identidad del portal)

- **RED real observado**: con el `finally` revertido a `if anterior is not None: ...` (sin el `else: pop(...)`), `pytest tests/test_membresias_pagos.py -q -k test_llamar_propia_no_filtra` → **1 failed** (la llamada admin-only posterior en `client_sin_token` heredaba la identidad REPRESENTANTE en vez de responder 401).
- Restaurado el `finally` incondicional (`if tenia_override: restaura / else: pop`).
- **GREEN** → `pytest tests/test_membresias_pagos.py -q -k test_llamar_propia_no_filtra` → **1 passed**.

### T3 (R3-002 — aserción débil del log)

- **RED real observado**: mutado temporalmente `logger.exception(...)` de `suspender_membresia` a `logger.warning(..., exc_info=None)` → `pytest tests/test_membresias_pagos.py -q -k test_suspender_membresia_loguea` → **1 failed** (el filtro por nivel ERROR + `exc_info` ya no encuentra el registro).
- Revertida la mutación.
- **GREEN** → `pytest tests/test_membresias_pagos.py -q -k "loguea_el_id_si_falla"` → **3 passed** (los tres endpoints).

### T4 (R3-003 — invariante sin pin)

- **RED real observado** (`test_crear_membresia_incluye_la_clave_cubierto_hasta`): agregada temporalmente una fila `Pago` APROBADA apuntando a la membresía recién creada, antes del assert → **1 failed**. Revertido.
- **RED real observado** (`test_endpoint_propia_incluye_la_clave_cubierto_hasta`): mismo patrón → **1 failed**. Revertido.
- **GREEN** → `pytest tests/test_membresias_pagos.py tests/test_membresia_propia_autoservicio.py -q` → **62 passed**.

### T5 — Verificación final

- `TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/ -q` (suite backend completa) → **2881 passed, 3 skipped** en 533.16s (era 2880 passed antes de este follow-up; +1 por el nuevo test de regresión de T2).
- `make pre-pr LANE=backend` (sin `JWT_SECRET_KEY` en el entorno invocador) → verde: `ruff check` + `lint-imports` + `pip-audit` + `test-backend-preflight` (db-test) + `test-root` (**633 passed, 1 skipped**), todos limpios. No reproducido localmente (declarado por el propio lane): el job de CI `migraciones-desde-cero` contra su PostgreSQL aislado.
- `db-test` levantado dos veces: una manual (`gentleman-1356fu-db-test-1`... en realidad `cata_club-db-test-1`, proyecto del repo principal) para el archivo focal, removida antes de correr el lane; y otra por el propio `test-backend-preflight` (`gentleman-1356fu-db-test-1`, proyecto del worktree) para la suite completa y el lane. Ambas confirmadas removidas al cierre (`docker compose --profile test rm -sf db-test`, `docker ps` sin ningún contenedor `db-test`).
