"""
Candado: toda migración de Alembic que cite un script de precheck en
`scripts/*.py` (docstring, comentario o mensaje de aborto) tiene que
apuntar a un archivo que YA EXISTE en el árbol.

Nace del issue #1070. El diagnóstico original del issue decía que el
script y la migración habían llegado en el MISMO PR -- es falso: la
migración `d1016emailunico_correo_unico_case_insensitive.py` se mergeó
por el PR #1019 (`91636c8`, 2026-09-04T18:54:08Z) y
`scripts/detectar_correos_duplicados.py` recién existió 26 minutos
después, por el PR #1021 (`3cfaf68`). `gh pr view 1021 --json files` no
toca ningún archivo de `alembic/versions/`: los diffs ya estaban
separados, así que un detector de "mismo diff" no habría atajado nada.

El defecto real es una referencia hacia ADELANTE invertida: la migración
citaba un script que todavía no existía en `main` en el momento de
mergearse. Este candado prueba que muerde corriendo contra el commit
`91636c8` (ver la salida roja en el cuerpo del PR que lo introduce).
"""
import re
from pathlib import Path


# Excluye deliberadamente cualquier prefijo alfanumérico o `/` inmediato
# antes de "scripts/" (ej. "javascripts/"), para no capturar coincidencias
# espurias que no son la carpeta `scripts/` del backend.
_PATRON_REFERENCIA = re.compile(r"(?<![\w/])scripts/([\w./-]+\.py)")

_DIRECTORIO_BACKEND = Path(__file__).resolve().parents[1]
_DIRECTORIO_VERSIONS = _DIRECTORIO_BACKEND / "alembic" / "versions"


def _scripts_referenciados(ruta_migracion: Path) -> set[str]:
    """Toda referencia literal a `scripts/<algo>.py` en el TEXTO completo
    del archivo -- docstring, comentario `#` o string de un mensaje de
    error, da lo mismo: cualquiera de las tres formas es una promesa de
    que ese script existe, y las tres fallaron en `d1016emailunico`
    (líneas 27, 66 y 97)."""
    texto = ruta_migracion.read_text(encoding="utf-8")
    return set(_PATRON_REFERENCIA.findall(texto))


def test_migraciones_no_referencian_scripts_inexistentes():
    """Cada `scripts/<nombre>.py` citado por una migración tiene que
    existir en `backend/scripts/` -- la ruta se resuelve relativa a
    `backend/`, NO al directorio de la migración: `alembic/versions/` no
    tiene ningún `scripts/` propio."""
    faltantes = {
        str(ruta.relative_to(_DIRECTORIO_VERSIONS)): sorted(
            nombre
            for nombre in _scripts_referenciados(ruta)
            if not (_DIRECTORIO_BACKEND / "scripts" / nombre).is_file()
        )
        for ruta in sorted(_DIRECTORIO_VERSIONS.glob("*.py"))
    }
    faltantes = {
        archivo: nombres for archivo, nombres in faltantes.items() if nombres
    }

    assert faltantes == {}, (
        "estas migraciones citan un script de scripts/ que no existe en "
        "el árbol -- el script tiene que existir en `main` ANTES de "
        "mergear la migración que lo cita, nunca después: "
        f"{faltantes}"
    )
