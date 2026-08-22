"""Guard de ambiente compartido por los seeds de desarrollo (issue #551).

Los seeds no tenían guard propio: solo los protegía el `if
AMBIENTE=development` de `entrypoint.sh`, que no aplica al ejecutarlos a
mano — contra producción habrían creado `admin@cataclub.com` con la
contraseña publicada `admin12345`. Replica las dos capas de
`reset_dev_db.validar_reset_permitido` en el mismo orden: allow-list de host
PRIMERO e incondicional (reusa su rechazo de overrides del query string),
AMBIENTE después, sin `--forzado`."""
import sys
from pathlib import Path

from sqlalchemy.engine import make_url

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.soporte_transversal.configuracion import settings  # noqa: E402
from scripts.reset_dev_db import (  # noqa: E402
    ResetNoPermitidoError,
    _validar_sin_overrides_de_destino,
)


class SeedNoPermitidoError(RuntimeError):
    """Se lanza cuando el seed de desarrollo no está permitido."""


def validar_seed_permitido(ambiente: str, database_url: str) -> None:
    """Guard de dos capas (ver docstring del módulo); host primero."""
    url = make_url(database_url)
    host = url.host or ""

    try:
        _validar_sin_overrides_de_destino(url)
    except ResetNoPermitidoError as exc:
        raise SeedNoPermitidoError(str(exc)) from exc

    if host not in settings.reset_hosts_permitidos:
        raise SeedNoPermitidoError(
            f"Host '{host}' no está en la allow-list "
            f"({', '.join(settings.reset_hosts_permitidos)}); esta capa es "
            "incondicional e independiente de AMBIENTE (ver RESET_HOSTS_PERMITIDOS)."
        )

    if ambiente != "development":
        raise SeedNoPermitidoError(
            f"AMBIENTE='{ambiente}' no es 'development': los seeds crean cuentas "
            "con contraseñas publicadas en el repositorio. Para el primer "
            "administrador de un ambiente real usá scripts/crear_primer_admin.py."
        )
