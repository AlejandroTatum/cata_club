# Fix 10 · Tres rodeos que no van a aguantar el crecimiento del club

- **Cierra:** TRA-8, TRA-6, TRA-7
- **Decisión que lo gobierna:** sin decisión de negocio — son mejoras técnicas de escala
- **Rama:** fix/rendimiento
- **Commits:**
  - `2a0cb21` — fix(members): resolve memberships with one bulk call, not N
  - `87d00db` — fix(asistencias): paginate reportes and per-persona history
  - `dfb2687` — fix(groups): fetch every schedule's roster in one call

## El problema

Tres pantallas del panel de administración piden más datos de los que necesitan, o los piden en el orden equivocado. `/members` hacía ~120 llamadas al backend por un rodeo de un bug ya reparado. `/reports` y el historial de asistencia de un alumno traían la tabla entera en una sola respuesta, sin límite. `/groups` hacía 26 consultas chiquitas para armar un conteo. Con 59 alumnos ya se nota; con cientos, cada una de las tres se iba a volver un cuello de botella.

## Qué se hizo

**TRA-8 — `/members` de ~120 llamadas a 4.** El código pedía la membresía de cada socio una por una porque `GET /membresias/` devolvía error 500 hace un tiempo. Ese bug ya está reparado (y de hecho otra pantalla del mismo panel, `/payments`, ya lo usaba sin rodeos). Se sacó el rodeo entero — la resolución individual por persona y por membresía — y se lo reemplazó por una sola llamada a `GET /membresias/?limit=200`, agrupando el resultado en memoria. El comentario que explicaba el bug ya reparado se borró con el código que describía.

**TRA-6 — paginar `asistencias/reportes` y `asistencias/persona/{id}`.** Ambos endpoints devolvían TODAS las filas sin paginar (500 asistencias hoy). Se les agregó el mismo contrato `skip`/`limit` (tope 200) que ya usan `GET /personas/` y `GET /membresias/pagos`, devolviendo el mismo envelope `{items, total, skip, limit}`. Antes de tocar nada se revisaron los dos consumidores del reporte JSON: la pantalla `/reports` arma su CSV y su conteo de vista previa a partir del array completo (documentado explícitamente en `reports-utils.ts`), así que paginar el endpoint sin más rompía esa garantía. En vez de forzar una repaginación de la pantalla (fuera de alcance de este fix), el intermediario (`/api/attendance/records`) ahora recorre las páginas del backend internamente y arma el mismo array completo de siempre — el backend nunca vuelve a aceptar una consulta sin límite, pero ninguna pantalla (`/reports`, `/attendance`, `/dashboard`, `/trainer*`) tuvo que cambiar. El export a PDF de asistencia sigue llamando al mismo servicio sin límite, a propósito: es un documento que se descarga una vez, no un listado que alguien recorra en pantalla.

**TRA-7 — `/groups` de 26 consultas a 1.** No había ningún endpoint que devolviera el roster de todos los horarios de una vez, así que se agregó uno: `GET /asistencias/horarios/alumnos`, una sola consulta SQL con join y el mismo filtro de baja lógica que su hermano por-horario. Es deliberadamente sin paginar — el volumen de filas ya viajaba completo hoy, solo que repartido en 26 respuestas; esto consolida las consultas, no cambia cuántas filas cruzan la red. El endpoint por-horario (`GET /asistencias/horarios/{id}/alumnos`) queda intacto: lo sigue usando el panel "Ver alumnos" de un solo grupo abierto, que genuinamente solo necesita el roster de ese horario.

## El candado

**TRA-8** — `frontend/src/app/api/members/__tests__/route.test.ts`, test `"fetches memberships in one backend call regardless of how many students there are"`:

```
❯ src/app/api/members/__tests__/route.test.ts (9 tests | 3 failed) 325ms
   × GET /api/members > fetches memberships in one backend call regardless of how many students there are 6ms
     → expected "fetch" to be called 4 times, but got 8 times

 Test Files  1 failed (1)
      Tests  3 failed | 6 passed (9)
```

Después del fix:

```
 ✓ src/app/api/members/__tests__/route.test.ts (9 tests) 30ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

**TRA-6** — `backend/tests/test_paginacion_asistencias.py` (8 tests nuevos, uno de ellos, `test_reporte_asistencia_rechaza_limit_por_encima_del_tope`):

```
tests/test_paginacion_asistencias.py::test_historial_persona_responde_el_envelope_paginado FAILED
tests/test_paginacion_asistencias.py::test_reporte_asistencia_rechaza_limit_por_encima_del_tope FAILED
     assert client.get(f"{base}?limit=201").status_code == 422
AssertionError: assert 200 == 422
...
=========================== short test summary info ============================
8 failed, 1 warning in 1.10s
```

Después del fix:

```
tests/test_paginacion_asistencias.py::test_historial_persona_responde_el_envelope_paginado PASSED
tests/test_paginacion_asistencias.py::test_reporte_asistencia_rechaza_limit_por_encima_del_tope PASSED
...
========================= 8 passed, 1 warning in 0.95s =========================
```

Y `frontend/src/app/api/attendance/records/__tests__/route.test.ts`, test `"loops through backend pages to assemble the full, unpaginated result the rest of the app expects"` (RED antes de la implementación, contra `asistencias.map is not a function` porque el endpoint ya devolvía el envelope pero la ruta todavía esperaba un array crudo; verde después, 11/11).

**TRA-7** — `backend/tests/test_asistencias.py`, `test_roster_de_todos_los_horarios_junta_varios_horarios_en_una_consulta` (antes de crear la ruta, `GET /asistencias/horarios/alumnos` colisionaba con `/horarios/{horario_id}` y devolvía 405):

```
>       assert resp.status_code == 200
E       assert 405 == 200
```

Después del fix: `3 passed, 8 deselected, 1 warning in 0.74s`.

Y `frontend/src/app/groups/__tests__/GroupsPage.test.tsx`, test nuevo `"fetches the roster in one call regardless of how many schedules there are (TRA-7)"` — verde desde el principio porque valida el resultado final, pero las tres pruebas de conteo existentes (`"counts each student once..."`, `"never shows a partial-enrollment footnote..."`, `"omits the headcount..."`) se pusieron rojas al conectar el mock del nuevo servicio sin haber reescrito su contenido:

```
 Test Files  1 failed (1)
      Tests  3 failed | 54 passed (57)
```

Después de reescribirlas contra el mock del roster masivo: `58 tests | 58 passed`.

## La prueba

**TRA-8.** Medido con el dataset de QA (59 personas, 66 membresías), contra el mismo backend, sin reconstruir nada más que mi propio frontend en `:3008`:

- Antes: **89 llamadas al backend** por carga de `/members` (62 `GET /membresias/{id}` + 24 `GET /membresias/persona/{id}` + personas/pagos/tipos), **318–379ms**.
- Después: **4 llamadas al backend** (personas, pagos, tipos, membresías en bloque), **44–202ms** (44ms en caliente).
- Mismo resultado exacto: 44 cuentas, `membresiasDegraded: false` en ambos casos.

```
qa(old) time=0.369700s status=200
local(fixed) time=0.044184s status=200
```

**TRA-6.** Backend reconstruido con el fix (`docker compose ... up -d --build --wait backend`), medido contra el dataset de QA (500 asistencias):

- Antes: `GET /asistencias/reportes` sin parámetros devolvía **las 500 filas en un array crudo, 95209 bytes**; `?limit=5` se ignoraba (seguían siendo 500); `?limit=300` no tenía techo (200 OK).
- Después: el mismo pedido devuelve `{items: [50], total: 500, skip: 0, limit: 50}`; `?limit=5` respeta el límite; `?limit=300` responde 422.
- El BFF `/api/attendance/records` (usado por `/reports`, `/attendance`, `/dashboard`, `/trainer*`) sigue devolviendo las 500 filas completas al cliente — ahora ensambladas desde 3 llamadas paginadas al backend (`skip=0/200/400`) en vez de una sola consulta sin límite:

```
GET /api/v1/asistencias/reportes?skip=0&limit=200 HTTP/1.1" 200 OK
GET /api/v1/asistencias/reportes?skip=200&limit=200 HTTP/1.1" 200 OK
GET /api/v1/asistencias/reportes?skip=400&limit=200 HTTP/1.1" 200 OK
records returned: 500
```

- El export a PDF de asistencia se probó sin cambios: 200 OK, `application/pdf`, 16 páginas, 158947 bytes — cubre las 500 filas en un solo documento, como siempre.

**TRA-7.** Medido con los 26 horarios reales de QA (932 filas de `alumno_horario` activas), simulando las 26 llamadas paralelas que hacía la pantalla vieja contra el mismo backend:

- Antes (26 llamadas en paralelo, como el `Promise.all` de la pantalla): **26 peticiones al backend, 564ms**.
- Después (1 llamada al endpoint nuevo): **1 petición al backend, 124ms**, mismas 932 filas.

```
--- BEFORE (simulated): 26 PARALLEL old-style per-horario calls ---
wall_ms=564 for 26 parallel calls
backend_log_lines_delta=27

--- AFTER (fixed): ONE bulk call ---
wall_ms=124 for 1 bulk call
backend_log_lines_delta=1
rows: 932
```

## Lo que NO cambió

- El endpoint por-horario `GET /asistencias/horarios/{id}/alumnos` sigue exactamente igual — lo sigue usando el panel "Ver alumnos" de un grupo individual, la asignación/desasignación de alumnos y el wizard de asistencia del entrenador.
- `GET /asistencias/reportes/pdf` sigue sin paginar, a propósito: descarga un documento completo de una vez, no alimenta un listado en pantalla.
- Las pantallas `/reports`, `/attendance`, `/dashboard` y las del entrenador siguen recibiendo el conjunto completo de asistencias del rango filtrado — no se les agregó paginación de interfaz; ese sería un cambio de UX más grande, fuera de alcance de este fix.
- `GET /membresias/{id}` y `GET /membresias/persona/{id}` (los endpoints individuales que `/members` dejó de usar) siguen existiendo — los usa el resto del sistema (portal del alumno, validación de pagos) sin cambios.
