"""
Prueba de aislamiento del harness Postgres (REQ-TEST-1, escenario "FK
enforcement now exercisable"): confirma que las claves foráneas se aplican
de verdad contra Postgres real (`conftest.py` ya lo exige de forma
incondicional para toda la suite, ver `TEST_DATABASE_URL`).
"""
import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.enums import TipoNotificacion
from app.dominio.modelos import Notificacion


def test_notificacion_con_persona_id_colgante_viola_fk(db_session):
    notificacion = Notificacion(
        persona_id=999_999,
        tipo=TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
        mensaje="persona inexistente",
    )
    db_session.add(notificacion)

    with pytest.raises(IntegrityError):
        db_session.commit()
