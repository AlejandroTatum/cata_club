# Integración de la tanda de auditoría — 17 ramas en `main` local

**Estado: incompleta a propósito.** 16 de 17 ramas quedan integradas y verificadas en verde. La 17ª (`feat/mi-cuenta-carnet`) también está integrada — el merge en sí no tuvo conflictos — pero dejó un candado de diseño en rojo que no me correspondía resolver por mi cuenta. Está documentado al final, con la razón para no tocarlo.

Nada de esto se pusheó. No se abrió ningún PR. `origin` no se tocó. Todo vive en `main` local, sobre el checkout principal.

Punto de retorno si algo necesita deshacerse: `git branch respaldo/pre-integracion` (creada en `e663953`, el HEAD de `main` antes de empezar).

## El orden en que entraron, con su sha de merge

### Tanda 1 — sin conflictos

| # | Rama | Merge sha |
|---|---|---|
| 1 | `docs/auditoria-y-decisiones` | `596bec9` |
| 2 | `fix/pago-sin-comprobante` | `af4e347` |
| 3 | `fix/periodo-de-cobertura` | `2b60330` |
| 4 | `fix/sesion-y-acceso` | `77efb23` |
| 5 | `fix/mensajes-que-no-llegan` | `36df2c0` |
| 6 | `fix/rendimiento` | `b209801` |

Verificación tras la tanda: **verde** (ver más abajo, "Salida de las suites — tanda 1").

### Tanda 2 — dos conflictos

| # | Rama | Merge sha | Conflicto |
|---|---|---|---|
| 7 | `fix/seed-inscripcion-atomica` | `b08d028` | ninguno |
| 8 | `fix/cabos-sueltos` | `5fa9094` | `seed_dev_bulk.py` — resuelto automáticamente por `git merge` (ver abajo) |
| 9 | `fix/reglas-horario-y-cuota` | `41737aa` | ninguno |
| 10 | `fix/vinculacion-representante` | `e814cf5` | Alembic: dos cabezas sobre `c6b3e8f2a5d9` — corregido en `cffda07` |
| 11 | `fix/interfaz-menor` | `a828dac` | ninguno |
| 12 | `fix/panel-entrenador` | `8efdbb5` | 5 archivos backend/frontend además del documentado — ver abajo |

Verificación tras la tanda: **verde** (ver "Salida de las suites — tanda 2").

### Tanda 3 — ficha médica y pantallas

| # | Rama | Merge sha | Conflicto |
|---|---|---|---|
| 13 | `fix/guardados-que-mienten` | `3cfbdf9` | ninguno |
| 14 | `fix/header-ficha-medica` | `e3ea6ca` | `MedicalRecordEditor.test.tsx` — dos `describe` concatenados |
| 15 | `feat/ficha-medica-representante` | `f7862e3` | ninguno |
| 16 | `feat/ficha-medica-propia` | `44e739c` | `page.tsx` (add/add) + `primary-action.test.ts` — ver abajo |
| 17 | `feat/mi-cuenta-carnet` | `b9023a8` | ninguno en el merge — candado de diseño en rojo después (ver "Lo que quedó sin cerrar") |

Verificación tras la tanda: **rojo** — un test, diagnosticado y sin tocar. Ver el cierre de este documento.

Commits auxiliares, fuera de los 17 merges:

- `cffda07` — rechain de Alembic (conflicto 2)
- `64a9f24` — mock de `ASI-4` desalineado con la paginación de `fix/rendimiento`
- `aa0ca40` — entrada obsoleta en la lista de deuda de `color-contrast.test.ts`
- `124a92b` — costura de una línea (`studentName`) entre `fix/header-ficha-medica` y `feat/ficha-medica-representante`, documentada de antemano en `docs/fixes/14-header-ficha-medica.md`

## Los siete conflictos documentados, y cómo se resolvieron

### 1 · `seed_dev_bulk.py` (paso 8)

`git merge` lo resolvió solo (`Auto-fusionando`, sin marcadores). Verificado leyendo el archivo resultante: la inscripción atómica por categoría con reparto round-robin (`fix/seed-inscripcion-atomica`) y el retiro de la escritura de `justificativo`/`estado_justificativo` (`fix/cabos-sueltos`) conviven — los dos cambios tocaban regiones distintas del archivo. El candado `tests/test_seed_dev_bulk.py` (entra en este mismo paso) y el resto de la suite backend confirmaron que no se perdió nada.

### 2 · Alembic (paso 10)

Confirmado el problema exacto que anticipaba la consigna: `b7e4a9f2c6d1` (reglas-horario-y-cuota) y `d5e6f7a8b9c1` (vinculacion-representante) colgaban las dos de `c6b3e8f2a5d9`. `git merge` no lo marca como conflicto (son archivos nuevos, no hay texto en común) — así que `alembic heads` habría devuelto dos cabezas silenciosamente si no se lo perseguía a mano.

Corregido en `cffda07`: `down_revision` de `d5e6f7a8b9c1` re-apuntado a `b7e4a9f2c6d1`. Nunca se generó una migración de fusión. `alembic heads` devuelve una sola cabeza (`d5e6f7a8b9c1`) en cada verificación posterior, y `tests/test_alembic_cabeza_unica.py` lo confirma en la suite.

### 3 · `trainer/attendance/history/page.tsx` (paso 12)

Este archivo, tal como anticipaba la consigna, **se fusionó solo** — la pluralización de "sesiones" (`fix/interfaz-menor`, ya integrada en el paso 11) y las etiquetas de estado en la celda Resultado (`fix/panel-entrenador`) tocaban líneas distintas.

Lo que la consigna no anticipaba: el mismo merge (paso 12) trajo conflictos reales en **otros cinco archivos**, todos alrededor de asistencias — `fix/rendimiento` (ya integrada) y `fix/panel-entrenador` habían tocado la misma zona del backend y del BFF por razones distintas (paginación vs. panel del entrenador):

- `backend/app/presentacion/routers/asistencias_router.py` — imports de DTO en conflicto (`AsignacionAlumnoHorarioResponseDTO` vs `UltimaListaDTO`); ambos hacían falta, se combinaron.
- `backend/app/servicios_negocio/asistencia_servicio.py` — tres bloques: imports de enums (`EstadoMembresia`/`EstadoPago` vs `EstadoAsistencia`, se combinaron), imports de DTO (idem router) y dos métodos completos y no relacionados (`_info_membresia_vencida` de rendimiento, `listar_ultimas_listas` de panel-entrenador) que git había puesto en conflicto por estar uno justo después del otro. Los dos métodos van.
- `backend/tests/test_asistencias.py` — un conflicto estructural: git dejó una única línea (`assert resp.status_code == 403`) compartida fuera de los marcadores, pero en realidad cerraba DOS funciones de test distintas (una por rama). Se duplicó la línea para cerrar ambas.
- `frontend/src/app/api/attendance/records/route.ts` — conflicto de comentario/documentación (JSDoc describiendo el mismo enriquecimiento con distinto nivel de detalle); se combinaron ambas descripciones.
- `frontend/src/app/api/attendance/records/__tests__/route.test.ts` — un test nuevo (`ASI-4`, de panel-entrenador) insertado antes del test existente cuyo título se restauró al de HEAD (coincide con el cuerpo real, que sí pagina).

**Defecto real encontrado tras resolver:** el nuevo test `ASI-4` (`resolves the real student name for a trainer session...`) mockeaba `GET /asistencias/reportes` como un array plano — el contrato de antes de `fix/rendimiento`. Con `fix/rendimiento` ya integrada, ese endpoint devuelve un sobre paginado (`{items, total, skip, limit}`), y `fetchAllReportes` rompía contra el mock viejo. Corregido en `64a9f24`: el mock, no el traductor ni la aserción — coincide con el patrón ya registrado en memoria de proyecto ("Los mocks de error no llevaban status").

### 4 · `MedicalRecordEditor.tsx` (paso 14)

El componente se fusionó solo. Confirmado leyendo el resultado: `alergias.trim() || null` (el `null` explícito de `fix/guardados-que-mienten`) y el header sticky con `studentName` (`fix/header-ficha-medica`) conviven sin pisarse.

El único conflicto real fue en `MedicalRecordEditor.test.tsx`: dos bloques `describe` completos, cada uno cortado a mitad por los marcadores porque compartían la línea de cierre. Se concatenaron ambos `describe` completos, uno después del otro.

### 5 · `auth-utils.ts` y `student/medical-record/` (paso 16)

Se leyó `docs/fixes/15-ficha-medica-propia.md` antes de resolver, como pedía la consigna. `auth-utils.ts` se fusionó solo y coincide exactamente con la combinación que ese documento describe (representante sin condición, estudiante con `studentIsAdult`).

El conflicto real fue **add/add** en `frontend/src/app/student/medical-record/page.tsx`: las dos ramas montaban pantallas completas e independientes en la misma ruta. Se escribió un archivo nuevo que:

- Comparte una sola carga de `fetchStudentPortal` y un solo `AppShell`.
- Rama por `session.user.role` dentro del `ready`: `representante` ve `RepresentanteMedicalRecordView` (el picker sobre `data.representados`, sin cambios de lógica); `estudiante` ve `MedicalRecordEditor` directo sobre `data.self`, con el guard de minoría de edad (`isMinor` + `router.replace("/student")`) preservado tal cual estaba en `feat/ficha-medica-propia`.
- `allowedRoles={["representante", "estudiante"]}` en el `ProtectedRoute`.

Conflictos secundarios, ambos resueltos combinando (no eligiendo un lado):

- `frontend/src/components/shell/__tests__/primary-action.test.ts` — la misma entrada `NO_HEADER_ACTION["app/student/medical-record/page.tsx"]` con dos textos distintos; se quedó una sola entrada, redactada para cubrir ambas ramas del componente.
- Los dos archivos de test (`StudentMedicalRecordPage.test.tsx`, `StudentOwnMedicalRecordPage.test.tsx`) no tuvieron conflicto de merge, pero sus aserciones sobre `allowedRoles` seguían anclando el valor viejo de una sola rama (`["representante"]` / `["estudiante"]`). Actualizadas a `["representante", "estudiante"]` en ambas — es el contrato real y nuevo, no un ajuste para forzar verde.

**Defecto real encontrado, ajeno a este conflicto puntual:** `src/lib/__tests__/auth-utils.test.ts::"ignores the adult flag for representante"` esperaba 4 links para `representante` — un número que ya estaba desactualizado desde el paso 15 (`feat/ficha-medica-representante`, sin conflicto, agregó el link de ficha médica sin condición, subiendo el conteo a 5). Corregido en el mismo commit del merge 16: la aserción ahora compara `getNavLinksForRole("representante", true)` contra `getNavLinksForRole("representante", false)` y confirma que son iguales — que es lo que "ignora la bandera" realmente significa — en vez de contar un número que había cambiado por una razón no relacionada con este conflicto.

**Defecto real adicional, encontrado corriendo la suite completa después del merge 16 (no en el diff del conflicto):** `src/lib/__tests__/color-contrast.test.ts` reportó que `app/members/MedicalRecordEditor.tsx` ya no usa ningún color crudo de Tailwind — la lista de deuda (`RAW_PALETTE_DEBT`) es de un solo sentido, "solo encoge", y ese archivo ya no tenía uso que justificara seguir en ella (confirmado con `rg` sobre el archivo resultante: cero coincidencias). Retirada la entrada en `aa0ca40`.

### 6 · El `studentName` que faltaba

Aplicado como consigna indicaba: después de resolver el paso 16, un commit propio (`124a92b`) que pasa `studentName={studentName}` a la llamada de `MedicalRecordEditor` dentro de `RepresentanteMedicalRecordView` — la variable ya existía ahí (`firstNameOf(selectedProfile.nombres)`), documentado al pie de `docs/fixes/14-header-ficha-medica.md`.

### 7 · `student/page.tsx` (paso 17)

El merge no tuvo ningún conflicto — `feat/mi-cuenta-carnet` reescribió el archivo entero y `git` lo aplicó limpio, sin necesidad de que "el rediseño gane" a mano. Ver "Lo que quedó sin cerrar" para lo que sí salió rojo después de integrarlo.

## Salida de las suites — tanda 1 (tras el paso 6)

```
Frontend — Test Files  164 passed (164)
           Tests       2470 passed (2470)
Frontend — tsc --noEmit: sin salida (limpio)
Backend  — 890 passed, 2 skipped, 12 warnings
```

## Salida de las suites — tanda 2 (tras el paso 12, incluye la corrección `64a9f24`)

```
alembic heads: d5e6f7a8b9c1 (head) — una sola cabeza
Frontend — Test Files  167 passed (167)
           Tests       2509 passed (2509)
Frontend — tsc --noEmit: sin salida (limpio)
Backend  — 933 passed, 2 skipped, 12 warnings
```

## Salida de las suites — tanda 3 (tras el paso 17, incluye `64a9f24`, `aa0ca40`, `124a92b`)

```
alembic heads: d5e6f7a8b9c1 (head) — una sola cabeza
Frontend — Test Files  168 passed | 1 failed (169)
           Tests       2541 passed | 1 failed (2542)
Frontend — tsc --noEmit: sin salida (limpio)
Backend  — 937 passed, 2 skipped, 12 warnings
```

El único rojo es `src/lib/__tests__/page-rail-usage.test.ts > a page splits into a main column and a rail one way > is never written by hand`. Diagnóstico completo abajo.

## Lo que quedó sin cerrar

**`page-rail-usage.test.ts` sobre `app/student/page.tsx`, introducido por `feat/mi-cuenta-carnet` (paso 17).**

No es un defecto de integración entre dos ramas — confirmado comparando contra `respaldo/pre-integracion`: ahí `student/page.tsx` usa `PAGE_RAIL` sin modificar y el test pasa. El merge del paso 17 no tuvo conflicto: `feat/mi-cuenta-carnet` reemplazó el archivo entero tal cual venía de su propia rama, y ese archivo ya traía esta tensión antes de tocar `main`. El propio `docs/fixes/12-mi-cuenta-carnet.md` solo reporta la salida de los dos archivos de test nuevos/tocados (`StudentPage.test.tsx`, `student-utils.test.ts`), nunca la suite completa — así que nadie en esa rama corrió este candado contra su propio cambio.

Lo que pasa exactamente: `student/page.tsx:799` importa y usa `PAGE_RAIL` (satisface la regla en espíritu — no "escribe su propia medida a mano"), pero le pisa el `grid-cols` con `lg:!grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` — un split 1fr/1fr **proporcional**, no un riel de medida fija. El comentario en las líneas 772-798 documenta por qué (Fix 12c: el maquette elegido pide columnas parejas; el riel fijo de 340px dejaba el carnet en las tres cuartas partes del ancho). El propio test declara en su comentario ("What this deliberately does NOT check") que un split proporcional está fuera de su alcance — pero su regex (`grid-cols-\[minmax\(0,\s*1fr\)_/`) no distingue "tipeó un riel nuevo de la nada" de "pisó el de `PAGE_RAIL` a propósito, documentado, para un split proporcional" — y dispara igual.

No lo resolví porque las dos salidas que veo son ambas decisiones de diseño, no correcciones mecánicas:

- Reescribir la regex del guard para que no dispare sobre un override explícito y documentado de `PAGE_RAIL` — cambia la aserción de un test que existe para evitar exactamente ese tipo de cambio hecho a la ligera.
- Reescribir la clase de `student/page.tsx` para lograr el mismo layout sin tocar el patrón textual que el regex vigila — arriesga cambiar el comportamiento de overflow que `minmax(0, ...)` existe para garantizar, por evitar un lint.

Cualquiera de las dos es una llamada de diseño del dueño del sistema de diseño, no algo que se resuelve leyendo el diff. Rerun aislado (`npx vitest run src/lib/__tests__/page-rail-usage.test.ts`) confirma que no es flakiness — es determinístico, análisis estático sobre el archivo tal como quedó.

## Lo que me sorprendió

- El conflicto documentado como "un archivo" en el paso 12 (`trainer/attendance/history/page.tsx`) en realidad se fusionó solo, y el conflicto real cayó en otros cinco archivos no mencionados en la consigna — todos alrededor de asistencias, entre `fix/rendimiento` (ya integrada) y `fix/panel-entrenador`. Ninguno era de lógica de negocio contradictoria; todos eran regiones adyacentes o imports compartidos.
- Dos de los conflictos "documentados" (`seed_dev_bulk.py` en el paso 8, `MedicalRecordEditor.tsx` en el paso 14) los resolvió `git merge` solo, sin marcadores — el trabajo real fue verificar que el resultado automático era correcto, no editarlo.
- Cada conflicto real trajo al menos un defecto silencioso al lado — algo que compilaba y no rompía el merge, pero que un test ya existente (no parte del conflicto) capturaba: el mock de paginación desalineado (paso 12), la aserción de conteo de links desactualizada y la entrada de deuda de color obsoleta (paso 16). Ninguno apareció en los marcadores de conflicto — todos aparecieron corriendo la suite completa después.
