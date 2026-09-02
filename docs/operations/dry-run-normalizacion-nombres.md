# Dry-run de normalización de nombres

Procedimiento de **solo lectura** para saber qué pasaría si se aplicara una regla de capitalización conservadora sobre `persona.nombres`/`apellidos` (issue #904, relacionada con #875). **No repara nada**.

## Prerrequisitos y comandos

Acceso de lectura (réplica o rol sin escritura); `DATABASE_URL` sale del entorno, nunca de argv. Desde `backend/` (código de salida siempre 0):
```bash
uv run python scripts/dry_run_normalizacion_nombres.py [--json]
uv run python scripts/dry_run_normalizacion_nombres.py --artifact  # solo así escribe, ruta fija bajo cwd
TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_normalizacion_nombres.py tests/test_dry_run_normalizacion_nombres.py -v
```

## Cómo interpretar la salida

Nunca contiene nombres ni cédulas -- solo `conteos_por_clase`, `conteos_por_motivo` e `ids_por_clase`. Motivos de ambigüedad:

| Motivo | Causa |
| --- | --- |
| `apostrofe` | El token trae apóstrofe (`d'angelo`, `o'brien`). |
| `mayuscula_interior` | Mayúscula tras minúscula en el original (`McArthur`). |
| `caracter_no_valido` | Dígitos u otro carácter fuera de letras/marcas/guion/apóstrofe. |
| `inicial` | Token de una sola letra. |
| `vacio` | El valor queda vacío tras limpiar espacios. |
| `demasiado_largo` | El valor normalizado supera los 100 caracteres. |

## Artifact restringido (pares antes/después)

Solo con `--artifact` (booleano; sin flag no escribe nada). Ruta fija, nunca de argv/env: `./artifacts-restringidos/dry-run-nombres-<AAAAmmddTHHMMSSZ>.json` (dir `0700`, archivo `0600`, **rechaza sobrescribir**; la salida imprime la ruta exacta). Nombres reales; acceso solo bajo #875, nunca en issues/PRs/logs; se borra al cerrar.

## Lo que NO puede hacer, y escalamiento

No escribe (garantía server-side de Postgres, igual que #902), no normaliza cédula/teléfono/correo, ni resuelve ambigüedades automáticamente. Cualquier escritura futura requiere aprobación humana explícita tras revisar este dry-run (se rastrea en #875). Ante duda, no la ejecutes.
