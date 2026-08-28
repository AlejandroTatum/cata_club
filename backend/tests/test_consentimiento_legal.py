from datetime import datetime, timezone

import pytest
from app.dominio.modelos import ConsentimientoLegal, Persona, Usuario
from app.servicios_negocio.consentimiento_legal_servicio import ConsentimientoLegalServicio


DOCUMENTOS = (
    ("TERMINOS", "Términos de uso"),
    ("PRIVACIDAD", "Aviso de privacidad"),
    ("DATOS_MEDICOS", "Consentimiento de datos médicos"),
    ("FETM", "Permiso de imagen FETM"),
)


def crear_cuenta(db_session):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula="1710034065",
        fecha_nacimiento=datetime(1990, 1, 1).date(), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    cuenta = Usuario(correo="ana@example.com", contrasenia="hash", persona_id=persona.id)
    db_session.add(cuenta)
    db_session.commit()
    return cuenta


def test_registro_grupal_persiste_un_auditoria_por_documento_y_timestamp_del_servidor(db_session):
    cuenta = crear_cuenta(db_session)
    servicio = ConsentimientoLegalServicio(db_session)

    registros = servicio.registrar_aceptacion_grupal(
        cuenta_id=cuenta.id,
        documentos=[codigo for codigo, _ in DOCUMENTOS],
        version="1.0",
        texto_por_documento={codigo: texto for codigo, texto in DOCUMENTOS},
    )

    assert len(registros) == 4
    assert {registro.documento for registro in registros} == {codigo for codigo, _ in DOCUMENTOS}
    assert all(registro.aceptado_en.tzinfo is not None for registro in registros)
    assert all(registro.aceptado_en <= datetime.now(timezone.utc) for registro in registros)
    assert all(registro.version_documento == "1.0" for registro in registros)


def test_registro_grupal_es_idempotente_y_no_duplica(db_session):
    cuenta = crear_cuenta(db_session)
    servicio = ConsentimientoLegalServicio(db_session)
    kwargs = dict(
        cuenta_id=cuenta.id,
        documentos=[codigo for codigo, _ in DOCUMENTOS],
        version="1.0",
        texto_por_documento={codigo: texto for codigo, texto in DOCUMENTOS},
    )

    primero = servicio.registrar_aceptacion_grupal(**kwargs)
    segundo = servicio.registrar_aceptacion_grupal(**kwargs)

    assert [r.id for r in segundo] == [r.id for r in primero]
    assert db_session.query(ConsentimientoLegal).count() == 4


def test_aceptacion_es_inmutable_y_revocacion_conserva_historia(db_session):
    cuenta = crear_cuenta(db_session)
    servicio = ConsentimientoLegalServicio(db_session)
    registro = servicio.registrar_aceptacion_grupal(
        cuenta_id=cuenta.id, documentos=["FETM"], version="1.0",
        texto_por_documento={"FETM": "texto aprobado"},
    )[0]

    registro.texto_aceptado = "alterado"
    with pytest.raises(ValueError, match="inmutable"):
        db_session.flush()
    db_session.rollback()
    revocacion = servicio.revocar(registro.id, cuenta_id=cuenta.id, motivo="solicitud del titular")

    assert revocacion.consentimiento_id == registro.id
    assert db_session.query(ConsentimientoLegal).count() == 1
    assert servicio.esta_vigente(registro.id) is False


def test_documento_y_version_son_requeridos_y_unicos(db_session):
    cuenta = crear_cuenta(db_session)
    servicio = ConsentimientoLegalServicio(db_session)
    servicio.registrar_aceptacion_grupal(
        cuenta_id=cuenta.id, documentos=["FETM"], version="1.0", texto_por_documento={"FETM": "x"}
    )
    segundo = servicio.registrar_aceptacion_grupal(
        cuenta_id=cuenta.id, documentos=["FETM"], version="1.0", texto_por_documento={"FETM": "y"}
    )
    assert segundo[0].id == servicio.repo.obtener_por_clave(cuenta.id, "FETM", "1.0", None).id
    assert db_session.query(ConsentimientoLegal).count() == 1
