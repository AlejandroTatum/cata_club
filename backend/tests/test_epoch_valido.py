"""
`GestorAutenticacion.epoch_valido` (B2): función pura, único lugar del
sistema que puede honrar (o no) el epoch de sesión de un token. Se comparte
entre `decodificar_token` (ruta access) y `AuthServicio.refrescar_sesion`
(ruta refresh) -- ver test_auth_tipo_token.py para la prueba de que AMBAS
rutas la usan.

Un `sver` ausente se trata como INVÁLIDO (no como "1"): aceptarlo dejaría
sobrevivir cualquier token emitido antes de este cambio hasta su expiración
natural (hasta 7 días en el refresh), derrotando la función en silencio.
"""
from app.seguridad.gestor_auth import GestorAutenticacion


class _UsuarioFalso:
    """Doble mínimo: `epoch_valido` solo lee `.version_sesion`, no necesita
    un `Usuario` real de SQLAlchemy para esta prueba de función pura."""

    def __init__(self, version_sesion: int):
        self.version_sesion = version_sesion


def test_epoch_valido_con_sver_ausente_es_invalido():
    usuario = _UsuarioFalso(version_sesion=1)
    assert GestorAutenticacion.epoch_valido(None, usuario) is False


def test_epoch_valido_con_sver_desactualizado_es_invalido():
    usuario = _UsuarioFalso(version_sesion=3)
    assert GestorAutenticacion.epoch_valido(2, usuario) is False


def test_epoch_valido_con_sver_vigente_es_valido():
    usuario = _UsuarioFalso(version_sesion=5)
    assert GestorAutenticacion.epoch_valido(5, usuario) is True


def test_epoch_valido_con_sver_cero_y_version_cero_es_valido():
    """Triangulación: no debe usar el valor `1` ni el `0` como caso especial
    de ningún lado -- es una comparación de igualdad simple."""
    usuario = _UsuarioFalso(version_sesion=0)
    assert GestorAutenticacion.epoch_valido(0, usuario) is True
