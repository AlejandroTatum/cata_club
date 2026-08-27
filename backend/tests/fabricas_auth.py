"""
Fábricas compartidas para las suites de login (TRA-4 / issue #733).

`test_auth_freno_login.py`, `test_auth_login_no_bloqueante.py` y
`test_auth_login_dos_no_autenticado.py` necesitan el mismo Usuario mínimo
(con su Persona) para ejercitar `AuthServicio.login`, y las dos primeras ya
necesitaban además un sleeper falso que nunca duerme de verdad (BRIEF.md:
ningún test hace un sleep real de varios segundos). Cada archivo traía su
propia copia -- este módulo es la única, mismo criterio que
`fabricas_pagos.py` (helpers de tests compartidos viven como módulo en
`tests/`, no repetidos por archivo).
"""
from datetime import date

from app.dominio.modelos import Persona, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion


def crear_usuario_auth(
    db_session, correo="ana@cataclub.test", cedula="1710034065", contrasenia="clave12345",
) -> Usuario:
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo=correo,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(contrasenia),
        persona_id=persona.id,
    )
    db_session.add(usuario)
    db_session.commit()
    return usuario


class SleeperEspia:
    """Sleeper falso: registra con qué segundos lo llamaron y nunca duerme de
    verdad."""

    def __init__(self):
        self.llamadas = []

    def __call__(self, segundos):
        self.llamadas.append(segundos)
