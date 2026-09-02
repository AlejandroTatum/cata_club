# Backfill de normalización de nombres

Backfill **REVERSIBLE** de `persona.nombres`/`apellidos` legado (issue #875). Aplica la regla de capitalización conservadora ya usada en el límite de escritura (`app/dominio/nombre_propio.py`) a las filas que quedaron con capitalización previa a esa regla.

## Prerrequisitos

1. Corriste y revisaste el [dry-run del #904](./dry-run-normalizacion-nombres.md) y conocés el número exacto de `cambio_propuesto`.
2. Hay aprobación humana explícita registrada en el issue #875 para escribir.
3. Hay un backup del día (ver `deploy/backup`).

## Comandos (desde `backend/`)

```bash
uv run python scripts/backfill_normalizacion_nombres.py  # en seco (default)
uv run python scripts/backfill_normalizacion_nombres.py --aplicar --confirmar-cambios <N>  # N EXACTO al de arriba
uv run python scripts/backfill_normalizacion_nombres.py --revertir  # sin ruta por argv
TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test \
  uv run pytest tests/test_backfill_normalizacion_nombres.py -v
```

## Cómo leer los conteos

`--confirmar-cambios` se niega (salida 2, nada escrito) si no coincide con el plan revisado -- es el candado contra aplicar sobre datos que cambiaron desde el dry-run. Después de aplicar, `cambio_propuesto` de las filas tocadas debe quedar en `0`; `ambiguo` no se mueve (nunca se corrige solo). `omitidos` cuenta filas que otra vía escribió entre el dry-run y el apply (criterio optimista: `WHERE campo = valor_esperado`).

## Fuera de alcance

`FichaMedica.contacto_emergencia` no entra: el dry-run revisado en #904 solo cubrió `Persona`. Un valor `ambiguo` (apóstrofe, `McArthur`, etc.) necesita revisión manual persona por persona, nunca este backfill.

## Artifact de reversión y rollback

`./artifacts-restringidos/backfill-nombres-<AAAAmmddTHHMMSSZ>.json` (dir `0700`, archivo `0600`, no sobrescribe). Contiene nombres reales -- dato personal: acceso solo bajo #875, nunca pegado en issues/PRs/logs, se borra al cerrar. `--revertir` toma siempre el más reciente bajo el directorio fijo (sin ruta por argumento), restaura `antes` fila por fila salteando cualquiera modificada después del backfill, y no borra el artifact.
