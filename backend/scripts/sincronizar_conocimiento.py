"""
Regenera los dos artefactos derivados del conocimiento del club (issue #768).

    uv run python scripts/sincronizar_conocimiento.py      # regenerar
    uv run python scripts/sincronizar_conocimiento.py --verificar

`conocimiento_club.json` es la única definición del conocimiento del club, pero
no puede ser leída directamente por los dos consumidores: los contextos de build
de Docker son `./backend` y `./frontend` por separado, y cada imagen solo
contiene su propio árbol. De ahí los dos derivados:

  1. `frontend/src/data/club-knowledge.json` — copia BYTE A BYTE, para que
     `/ayuda` renderice la misma definición sin depender de la API en runtime.
  2. `frontend/src/data/club-quick-replies.json` — SOLO los atajos del chat. El
     widget se monta en el layout raíz, y el bundler no descarta las claves no
     usadas de un JSON importado: con el documento entero, los 7,9 KB del
     conocimiento del club viajaban en el chunk compartido de TODAS las
     páginas (medido: 7,9 KB de 25 KB del chunk `app/layout-*.js`) para
     mostrar dos preguntas. Sigue siendo una proyección, no una copia: nadie
     puede editarla sin que el candado la vuelva a escribir.
  3. `app/servicios_negocio/prompt_sistema.txt` — el prompt exacto que se le
     manda al modelo, para que el guardián de divergencia del frontend compare
     su DOM renderizado contra lo que el modelo realmente recibe.

Ninguno de los dos puede quedarse viejo en silencio: la suite del backend
compara ambos contra la fuente y falla apuntando a este script. `--verificar`
hace esa misma comprobación sin escribir, para usarlo desde un hook o CI.

No importa `settings` ni toca la base de datos: se puede correr en un checkout
recién clonado, sin `.env`.
"""
import json
import sys
from pathlib import Path

RAIZ_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ_BACKEND))

from app.servicios_negocio import conocimiento_club  # noqa: E402

_DATOS_FRONTEND = RAIZ_BACKEND.parent / "frontend" / "src" / "data"
ESPEJO_FRONTEND = _DATOS_FRONTEND / "club-knowledge.json"
ATAJOS_FRONTEND = _DATOS_FRONTEND / "club-quick-replies.json"


def _serializar(datos) -> str:
    return json.dumps(datos, ensure_ascii=False, indent=2) + "\n"


def _json_de_atajos() -> str:
    return _serializar(conocimiento_club.CONOCIMIENTO["atajos"])


def _json_canonico() -> str:
    """El archivo canónico reformateado siempre igual.

    Se normaliza la fuente además de copiarla: si el formato dependiera de cómo
    la guardó el editor de turno, el espejo dejaría de ser comparable byte a
    byte y el candado más simple que existe —una igualdad— se volvería un
    diff de estilos."""
    datos = json.loads(
        conocimiento_club.RUTA_CONOCIMIENTO.read_text(encoding="utf-8")
    )
    return _serializar(datos)


def _esperado() -> dict[Path, str]:
    """Cada artefacto y el contenido que le corresponde hoy."""
    return {
        conocimiento_club.RUTA_CONOCIMIENTO: _json_canonico(),
        ESPEJO_FRONTEND: _json_canonico(),
        ATAJOS_FRONTEND: _json_de_atajos(),
        conocimiento_club.RUTA_INSTANTANEA_PROMPT: conocimiento_club.SYSTEM_PROMPT,
    }


def _pendientes() -> list[str]:
    return [
        str(ruta)
        for ruta, contenido in _esperado().items()
        if not ruta.exists() or ruta.read_text(encoding="utf-8") != contenido
    ]


def sincronizar() -> None:
    for ruta, contenido in _esperado().items():
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(contenido, encoding="utf-8")


def main() -> int:
    if "--verificar" in sys.argv[1:]:
        pendientes = _pendientes()
        if pendientes:
            print("Artefactos derivados desactualizados:")
            for ruta in pendientes:
                print(f"  - {ruta}")
            print("Corré `make sync-knowledge`.")
            return 1
        print("El conocimiento del club y sus derivados están sincronizados.")
        return 0

    sincronizar()
    for ruta in _esperado():
        print(f"escrito: {ruta}")
    caracteres = len(conocimiento_club.SYSTEM_PROMPT)
    print(f"Prompt de sistema: {caracteres} caracteres ≈ {caracteres // 4} tokens")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
