# Integración de la segunda tanda de auditoría — 6 ramas en `main` local

Segunda tanda: los arreglos que salieron de la segunda auditoría, incluidos los dos bloqueantes de seguridad (`fix/voucher-no-enumerable` privado por default en Cloudinary, y las restantes correcciones de negocio).

Nada de esto se pusheó. No se abrió ningún PR. `origin` no se tocó. Todo vive en `main` local, sobre el checkout principal.

Punto de retorno si algo necesita deshacerse: `git branch respaldo/pre-integracion-2` (creada en `59ace0e`, el HEAD de `main` antes de empezar esta tanda — ya incluía la primera tanda de 17 ramas más dos commits directos).

## El orden en que entraron, con su sha de merge

| # | Rama | Merge sha | Conflicto |
|---|---|---|---|
| 1 | `fix/buscar-nombre-completo` | `d74de4d` | ninguno |
| 2 | `fix/monto-sin-tolerancia` | `311a6d9` | ninguno |
| 3 | `fix/voucher-no-enumerable` | `ed3cbf7` | ninguno |
| 4 | `fix/notificacion-no-revienta` | `1cb2617` | ninguno — trae la migración `8a63e448373f`, encadenada limpia sobre `d5e6f7a8b9c1` |
| 5 | `fix/costuras-vinculacion-y-edad` | `bf9eb4a` | `backend/app/servicios_negocio/persona_servicio.py` — **no estaba previsto en la consigna**, ver abajo |
| 6 | `fix/edad-nan-en-la-raiz` | `7261bea` | `frontend/src/app/admin/crear-cuenta/crear-cuenta-utils.ts` — previsto en la consigna, gana la 6 |

Verificación tras el paso 3 y tras el paso 6: **verde** en ambos puntos (ver "Salida de las suites" más abajo).

## Los dos conflictos previstos, y el tercero que no lo estaba

### 1 · `persona_servicio.py` (paso 5) — no anticipado por la consigna

La consigna solo anticipaba conflicto en Alembic (paso 4, resultó limpio) y en `crear-cuenta-utils.ts` (paso 6). Este apareció en `_notificar_representante_anterior`, en el mismo método que `fix/notificacion-no-revienta` (paso 4, ya integrado) había reescrito.

Las dos ramas tocaban el mismo método por razones distintas:

- `fix/notificacion-no-revienta` (ya en `main`) lo envolvió en `try/except` con `acortar_nombre_para_notificacion`, rollback y `logger.exception` — la vinculación ya está commiteada antes de este aviso, así que un nombre real largo (`DataError` de VARCHAR(255)) no debe tirar la petición entera.
- `fix/costuras-vinculacion-y-edad` corrige el texto del aviso: el hint de "deshacer" apuntaba a una pantalla que no existe (`"Vincular un hijo ya registrado"`) en vez de la real (`"Agregar dependiente"`, confirmado en `frontend/src/app/student/add-dependent/page.tsx:568`).

Diffeando la rama 5 contra su propia base (antes de que existiera la rama 4) confirmé que su único cambio real en este método es el texto — no tocaba la estructura try/except porque en su base esa estructura no existía todavía.

**Resolución:** se combinaron — se conservó el guard completo de la rama 4 (try/except, `acortar_nombre_para_notificacion`, rollback + log) y se aplicó encima el texto corregido de la rama 5 (`"Agregar dependiente"` / `"para deshacerlo"`). Ningún lado se descartó.

### 2 · Alembic (paso 4) — previsto, resultó limpio

`8a63e448373f` (rama 4) encadena desde `d5e6f7a8b9c1`, que ya estaba en `main` como única cabeza antes del merge. El merge fue automático (`Auto-fusionando`, sin marcadores en archivos de migración). Verificado con `uv run alembic heads` después de cada paso relevante:

```
Antes del paso 4: d5e6f7a8b9c1 (head)
Después del paso 4: 8a63e448373f (head)
Después del paso 6 (fin de la tanda): 8a63e448373f (head)
```

Una sola cabeza en todo momento. `tests/test_alembic_cabeza_unica.py` (vive en la raíz del repo, no en `backend/tests/` — corre con `cd backend && uv run pytest ../tests/test_alembic_cabeza_unica.py`) confirma: **PASSED**.

### 3 · `crear-cuenta-utils.ts` (paso 6) — previsto, gana la 6

Mismo bug (validación de edad que no valida porque `calculateAge` devolvía `NaN` fuera de 1900-2200), dos caminos:

- La rama 5 escribió un cálculo local nuevo (`edadDesdeFecha`) en `crear-cuenta-utils.ts`, con sus propias constantes `EDAD_MINIMA_ALUMNO`/`EDAD_MAXIMA_ALUMNO`/`EDAD_MAYORIA_EDAD` duplicadas, porque el helper compartido estaba roto.
- La rama 6 arregló `calculateAge` en su origen (`enroll-utils.ts`) y reescribió `crear-cuenta-utils.ts` para importar el helper compartido en vez de cargar su propia copia — además de agregar el techo que le faltaba a la validación de MENOR (`age > EDAD_MAXIMA_ALUMNO`).

`git merge` dejó marcadores de conflicto entrelazados con una copia muerta de `edadDesdeFecha` sobreviviendo fuera de los marcadores (por hunks no contiguos). En vez de resolver marcador por marcador, se comparó el archivo completo de la rama 6 contra el resultado del merge automático: la única diferencia real eran justamente los marcadores y el duplicado muerto. Se tomó el archivo de la rama 6 completo.

**Verificado después de resolver, que sobrevivieron los límites de la rama 5 (18-74 para jugador/representante/entrenador, validados también en el servidor):**

- Frontend (`crear-cuenta-utils.ts`, versión de la rama 6): `EDAD_MAYORIA_EDAD = 18`, `EDAD_MAXIMA_ALUMNO = 74`, aplicados vía `calculateAge` importado — mismo rango, sin el duplicado local.
- Backend, sitio 1 — `admin_cuenta_servicio.py` (aportado por la rama 5, ya en `main` desde el paso 5, sin tocar por el paso 6): `if edad < EDAD_MAYORIA_EDAD or edad > EDAD_MAXIMA_ALUMNO`.
- Backend, sitio 2 — `enrollment_servicio.py` (aportado por la rama 6, para el representante en el flujo de inscripción, no en el flujo de "crear cuenta" de admin): `edad_rep < EDAD_MAYORIA_EDAD` y `edad_rep > EDAD_MAXIMA_ALUMNO` en checks separados.

Los dos sitios de backend son flujos distintos (crear-cuenta admin vs. inscripción) y ninguno pisó al otro — ambos sobrevivieron intactos.

## Salida de las suites — tras el paso 3

No se corrió la suite completa en este punto por instrucción explícita de la consigna (verificación solo tras los pasos 3 y 6); se usó como punto de control intermedio antes de encarar el paso con migración y los dos conflictos.

## Salida de las suites — tras el paso 6 (fin de la tanda)

```
Frontend — Test Files  170 passed (170)
           Tests       2566 passed (2566)
           Duration    134.03s
Frontend — tsc --noEmit: sin salida (limpio)
Backend  — 965 passed, 2 skipped, 12 warnings, 107.58s (corrida única, sin contención observada en el puerto 5436)
alembic heads: 8a63e448373f (head) — una sola cabeza
tests/test_alembic_cabeza_unica.py::test_alembic_tiene_una_sola_cabeza — PASSED
```

Ningún rojo. No hizo falta correr nada aislado ni comparar contra `respaldo/pre-integracion-2` — la corrida completa del backend pasó en el primer intento.

## Reconstrucción del entorno

```
make qa-up      # build + base sembrada + frontend, desde cero
make qa-reset   # vuelta al estado recién sembrado, sin rebuild
```

Migración aplicada en el reset: cadena completa hasta `8a63e448373f` sin bifurcaciones. Seed base y bulk completados sin errores.

**Paso cero — las imágenes tienen que ser posteriores al último commit de `main`:**

```
Imagen backend  creada:  2026-08-11T17:17:21.802290026-05:00
Imagen frontend creada:  2026-08-11T17:17:57.400024608-05:00
main HEAD (7261bea):     2026-08-11 17:11:59 -0500
```

Ambas imágenes son posteriores al commit. Confirmado que responden:

```
http://localhost:3000       → 200
http://localhost:8000/docs  → 200
```

## Lo que me sorprendió

- El conflicto real de esta tanda no fue el que traía dos caminos distintos para el mismo bug (paso 6, previsto y documentado de antemano en la consigna) sino uno que no estaba anticipado: `persona_servicio.py` en el paso 5, generado por dos ramas tocando el mismo método (`_notificar_representante_anterior`) por razones ortogonales — una lo blindaba contra un crash, la otra le corregía el texto. Ninguna consigna lo mencionó; apareció recién al mergear.
- El conflicto sí previsto en `crear-cuenta-utils.ts` (paso 6) vino con ruido adicional: `git merge` dejó una copia muerta de `edadDesdeFecha` viva fuera de los marcadores de conflicto, producto de hunks no contiguos. Resolver marcador por marcador ahí habría dejado basura; comparar el archivo completo contra la versión "que gana" fue más seguro.
- La migración de Alembic (paso 4), el único punto donde la consigna pedía verificación explícita con `alembic heads`, resultó ser el único de los tres puntos de fricción que entró completamente limpio.
- La advertencia sobre contención en el puerto 5436 no se materializó: la suite backend completa pasó en su primera corrida, sin necesidad de aislar ni comparar contra el respaldo.
