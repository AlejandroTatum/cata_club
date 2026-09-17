"""Supresión de datos personales (issue #1062, tareas T2-T5).

Verifica el contrato D9 con la base real (Postgres vía `db-test`): la
persona queda NO identificable mientras el historial contable, los
consentimientos y la auditoría de consultas de emergencia sobreviven
enlazados; las guardias D2/D3/D8; la destrucción Cloudinary (mockeada); y
el router admin (ver `test_supresion_datos_api.py`).
"""
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest

from app.dominio.enums import (
    Categoria, DiaSemana, EstadoAsistencia, EstadoMembresia, EstadoPago,
    TipoModalidad, TipoPago, TipoSangre,
)
from app.dominio.excepciones import OperacionInvalida, ServicioNoDisponible
from app.dominio.modelos import (
    Asistencia, ComprobantePago, ConsentimientoLegal, ConsultaFichaEmergencia,
    Enfermedades, EnrollmentNotificacionOutbox, FichaMedica, HorarioEntrenamiento,
    Membresia, Pago, Persona, RecuperacionOutbox, Rol, Sesion,
    SolicitudSupresionDatos, TipoMembresia, Usuario,
)
from app.servicios_negocio.supresion_datos_servicio import (
    DIAS_GRACIA, SupresionDatosServicio,
)


# --- Fábricas -----------------------------------------------------------------
def _crear_persona(db_session, cedula="1710034065", nombres="Ana", apellidos="Vega",
                   con_foto=False, fecha_nacimiento=date(1990, 1, 1)) -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=fecha_nacimiento, telefono="0990000000",
        telefono_contacto="022000000",
        foto_url="perfil_ana|7" if con_foto else None,
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _crear_admin(db_session) -> Persona:
    """Primer insert de la prueba: con las secuencias reiniciadas por el
    conftest, esta persona queda con id 1 (actor de los endpoints)."""
    return _crear_persona(db_session, cedula="1710010008", nombres="Admin",
                          apellidos="Club")


def _crear_usuario(db_session, persona: Persona, correo=None) -> Usuario:
    rol = Rol(tipo_rol="ALUMNO", descripcion="Alumno")
    usuario = Usuario(
        correo=correo or f"u{persona.cedula}@cataclub.test",
        contrasenia="hash", persona_id=persona.id, roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _crear_sesion(db_session, usuario: Usuario) -> Sesion:
    sesion = Sesion(
        usuario_id=usuario.id, dispositivo="navegador de prueba",
        version_sesion=usuario.version_sesion,
    )
    db_session.add(sesion)
    db_session.commit()
    db_session.refresh(sesion)
    return sesion


def _crear_historial(db_session, persona: Persona, estado_pago=EstadoPago.APROBADO,
                     con_voucher=False, voucher_formato="application/pdf") -> dict:
    """Siembra exactamente el historial que la supresión debe CONSERVAR (más
    los adjuntos Cloudinary que debe destruir)."""
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
        hora_inicio=time(17, 0), hora_fin=time(18, 0),
    )
    tipo = TipoMembresia(
        categoria="JUVENIL", precio=Decimal("30.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add_all([horario, tipo])
    db_session.flush()
    asistencia = Asistencia(
        fecha_entrenamiento=date(2029, 3, 3), estado=EstadoAsistencia.PRESENTE,
        persona_id=persona.id, horario_id=horario.id,
    )
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        fecha_activacion=datetime(2029, 3, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db_session.add_all([asistencia, membresia])
    db_session.flush()
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=estado_pago, tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(2029, 3, 1), fecha_fin=date(2029, 3, 31),
        persona_id=persona.id, membresia_id=membresia.id,
        voucher_url="voucher_ana_1" if con_voucher else None,
        # El MIME completo es lo que persiste el servicio de pagos; el valor
        # corto ("pdf") hacía pasar el test con una comparación que en
        # producción nunca daba verdadero (ver el caso de la imagen abajo).
        voucher_formato=voucher_formato if con_voucher else None,
    )
    db_session.add(pago)
    db_session.flush()
    return {"horario_id": horario.id, "asistencia_id": asistencia.id,
            "membresia_id": membresia.id, "pago_id": pago.id}


def _crear_ficha(db_session, persona: Persona) -> FichaMedica:
    ficha = FichaMedica(
        tipo_sangre=TipoSangre.O_POSITIVO, persona_id=persona.id,
        alergias="maní", contacto_emergencia="Pedro Vega",
        telefono_emergencia="0981112222",
    )
    db_session.add(ficha)
    db_session.flush()
    db_session.add(Enfermedades(nombre_enfermedad="asma", ficha_medica_id=ficha.id))
    db_session.commit()
    db_session.refresh(ficha)
    return ficha


def _crear_consentimiento(db_session, usuario: Usuario, persona: Persona) -> ConsentimientoLegal:
    consentimiento = ConsentimientoLegal(
        documento="PRIVACIDAD", version_documento="1",
        texto_aceptado="texto de prueba", cuenta_id=usuario.id,
        representado_persona_id=None,
    )
    db_session.add(consentimiento)
    db_session.commit()
    db_session.refresh(consentimiento)
    return consentimiento


def _crear_consulta_emergencia(db_session, persona: Persona, consultante: Persona):
    consulta = ConsultaFichaEmergencia(
        alumno_persona_id=persona.id, consultante_persona_id=consultante.id,
    )
    db_session.add(consulta)
    db_session.commit()
    db_session.refresh(consulta)
    return consulta


def _crear_outboxes(db_session, persona: Persona, usuario: Usuario | None) -> dict:
    admin_persona = db_session.get(Persona, 1) or persona
    # La UNIQUE (admin, alumno) admite una sola fila por par: la fila ENVIADO
    # usa otro admin para poder convivir con la PENDIENTE.
    otro_admin = _crear_persona(db_session, cedula="1710010065",
                                nombres="AdminDos", apellidos="Club")
    enrollment_pendiente = EnrollmentNotificacionOutbox(
        admin_persona_id=admin_persona.id, alumno_persona_id=persona.id,
        mensaje="mensaje pendiente",
    )
    enrollment_enviado = EnrollmentNotificacionOutbox(
        admin_persona_id=otro_admin.id, alumno_persona_id=persona.id,
        mensaje="mensaje ya enviado", status="ENVIADO", sent_at=datetime.now(timezone.utc),
    )
    db_session.add_all([enrollment_pendiente, enrollment_enviado])
    recuperacion_pendiente = None
    if usuario is not None:
        recuperacion_pendiente = RecuperacionOutbox(
            usuario_id=usuario.id,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db_session.add(recuperacion_pendiente)
    db_session.commit()
    for fila in (enrollment_pendiente, enrollment_enviado, recuperacion_pendiente):
        if fila is not None:
            db_session.refresh(fila)
    return {
        "enrollment_pendiente": enrollment_pendiente,
        "enrollment_enviado": enrollment_enviado,
        "recuperacion_pendiente": recuperacion_pendiente,
    }


def _solicitud_aprobada_y_vencida(db_session, servicio, persona, notas=None,
                                  dias_atras=DIAS_GRACIA + 1):
    """Crea, vence el plazo de gracia (D8) y aprueba una solicitud."""
    solicitud = servicio.crear(persona.id, "cierre de cuenta", admin_persona_id=1)
    solicitud.fecha_solicitud = datetime.now(timezone.utc) - timedelta(days=dias_atras)
    db_session.commit()
    servicio.aprobar(solicitud.id, admin_persona_id=1)
    if notas is not None:
        solicitud.notas = notas
        db_session.commit()
    return solicitud


# --- Mock de Cloudinary ---------------------------------------------------------
class _RegistroCloudinary:
    def __init__(self):
        self.llamadas = []
        self.error = None

    def __call__(self, nombre_publico, *, carpeta, resource_type, tipo, descripcion):
        if self.error is not None:
            raise self.error
        self.llamadas.append((nombre_publico, carpeta, resource_type, tipo))


@pytest.fixture()
def cloudinary_falso(monkeypatch):
    registro = _RegistroCloudinary()
    monkeypatch.setattr(
        "app.servicios_negocio.supresion_datos_servicio.eliminar_recurso_privado",
        registro,
    )
    return registro


# --- T5: no identificabilidad + historial sobrevive ------------------------------
def test_supresion_deja_no_identificable_y_el_historial_sobrevive(db_session, cloudinary_falso):
    admin = _crear_admin(db_session)
    persona = _crear_persona(db_session, con_foto=True)
    usuario = _crear_usuario(db_session, persona)
    _crear_sesion(db_session, usuario)
    historial = _crear_historial(db_session, persona, con_voucher=True)
    db_session.add(ComprobantePago(
        archivo_url="comprobante_ana_1", formato_archivo="pdf",
        pago_id=historial["pago_id"],
    ))
    ficha = _crear_ficha(db_session, persona)
    _crear_outboxes(db_session, persona, usuario)
    servicio = SupresionDatosServicio(db_session)

    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona)
    resultado = servicio.ejecutar(solicitud.id, admin_persona_id=admin.id)

    db_session.expire_all()
    persona_tras = db_session.get(Persona, persona.id)
    # Identidad fuera.
    assert persona_tras.nombres == "ANONIMIZADO"
    assert persona_tras.apellidos == "ANONIMIZADO"
    assert persona_tras.cedula not in ("1710034065", None)
    assert persona_tras.fecha_nacimiento == date(1900, 1, 1)
    assert persona_tras.telefono is None and persona_tras.telefono_contacto is None
    assert persona_tras.foto_url is None
    assert persona_tras.representante_id is None
    # Historial contable intacto (D9).
    assert db_session.get(Pago, historial["pago_id"]) is not None
    assert db_session.get(Membresia, historial["membresia_id"]) is not None
    assert db_session.get(Asistencia, historial["asistencia_id"]) is not None
    # Ficha médica vaciada, no borrada.
    ficha_tras = db_session.get(FichaMedica, ficha.id)
    assert ficha_tras is not None
    assert ficha_tras.alergias is None and ficha_tras.contacto_emergencia is None
    assert ficha_tras.telefono_emergencia is None
    assert ficha_tras.tipo_sangre is None
    assert db_session.query(Enfermedades).filter_by(ficha_medica_id=ficha.id).count() == 0
    # Sesiones fuera; cuenta sin consentimientos se elimina.
    assert db_session.query(Sesion).filter_by(usuario_id=usuario.id).count() == 0
    assert db_session.get(Usuario, usuario.id) is None
    # Solicitud EJECUTADA con asiento.
    assert resultado.estado == "EJECUTADA"
    assert resultado.fecha_ejecucion is not None
    assert resultado.detalle_ejecucion
    # Outbox pendiente fuera, enviado conservado.
    outboxes = db_session.query(EnrollmentNotificacionOutbox).all()
    assert {o.status for o in outboxes} == {"ENVIADO"}


def test_la_cedula_sentinela_cumple_la_forma_de_la_base(db_session, cloudinary_falso):
    """El centinela `30` + id a 8 dígitos satisface el CHECK de forma de
    `persona.cedula` y la UNIQUE: dos supresiones conviven."""
    _crear_admin(db_session)
    p1 = _crear_persona(db_session)
    p2 = _crear_persona(db_session, cedula="1710010024")
    servicio = SupresionDatosServicio(db_session)
    for p in (p1, p2):
        servicio.crear(p.id, "motivo", admin_persona_id=1)
        s1 = db_session.query(SolicitudSupresionDatos).filter_by(persona_id=p.id).one()
        s1.fecha_solicitud = datetime.now(timezone.utc) - timedelta(days=DIAS_GRACIA + 1)
        db_session.commit()
        servicio.aprobar(s1.id, admin_persona_id=1)
        servicio.ejecutar(s1.id, admin_persona_id=1)
    db_session.expire_all()
    cedulas = [db_session.get(Persona, p.id).cedula for p in (p1, p2)]
    assert cedulas[0] != cedulas[1]
    assert all(len(c) == 10 and c.startswith("30") for c in cedulas)


# --- Guardia D2: representados vigentes ------------------------------------------
def test_no_ejecuta_si_la_persona_reprsenta_a_un_menor(db_session, cloudinary_falso):
    _crear_admin(db_session)
    representante = _crear_persona(db_session)
    menor = _crear_persona(db_session, cedula="1710010016", nombres="Tomás",
                           apellidos="Vega", fecha_nacimiento=date(2016, 1, 1))
    menor.representante_id = representante.id
    db_session.commit()
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, representante)

    with pytest.raises(OperacionInvalida) as exc:
        servicio.ejecutar(solicitud.id, admin_persona_id=1)
    assert "flujo autorizado" in str(exc.value.mensaje)
    # Nada cambió: ni persona ni solicitud.
    db_session.expire_all()
    assert db_session.get(Persona, representante.id).nombres == "Ana"
    assert db_session.get(SolicitudSupresionDatos, solicitud.id).estado == "APROBADA"
    assert cloudinary_falso.llamadas == []


# --- Guardia D3: pagos pendientes exigen tratamiento documentado -----------------
def test_pagos_pendientes_sin_notas_bloquean_la_ejecucion(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session)
    _crear_historial(db_session, persona, estado_pago=EstadoPago.PENDIENTE_VALIDACION)
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona, notas=None)

    with pytest.raises(OperacionInvalida) as exc:
        servicio.ejecutar(solicitud.id, admin_persona_id=1)
    assert "pagos pendientes" in exc.value.mensaje
    assert cloudinary_falso.llamadas == []


def test_pagos_pendientes_con_notas_permiten_ejecutar(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session)
    historial = _crear_historial(db_session, persona, estado_pago=EstadoPago.PENDIENTE_VALIDACION)
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(
        db_session, servicio, persona, notas="Pago pendiente acordado en convenio",
    )

    servicio.ejecutar(solicitud.id, admin_persona_id=1)
    db_session.expire_all()
    # D3: la deuda NO se cancela ni se borra; el pago sigue ahí.
    pago = db_session.get(Pago, historial["pago_id"])
    assert pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION
    assert db_session.get(Persona, persona.id).nombres == "ANONIMIZADO"


# --- Guardia D8: plazo de gracia de 30 días --------------------------------------
def test_no_ejecuta_antes_de_que_venza_el_plazo_de_gracia(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session)
    servicio = SupresionDatosServicio(db_session)
    solicitud = servicio.crear(persona.id, "cierre", admin_persona_id=1)
    solicitud.fecha_solicitud = datetime.now(timezone.utc) - timedelta(days=DIAS_GRACIA - 1)
    db_session.commit()
    servicio.aprobar(solicitud.id, admin_persona_id=1)

    with pytest.raises(OperacionInvalida) as exc:
        servicio.ejecutar(solicitud.id, admin_persona_id=1)
    assert "plazo de gracia" in exc.value.mensaje
    db_session.expire_all()
    assert db_session.get(SolicitudSupresionDatos, solicitud.id).estado == "APROBADA"


def test_al_cumplir_los_30_dias_si_ejecuta(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session)
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona,
                                              dias_atras=DIAS_GRACIA)
    servicio.ejecutar(solicitud.id, admin_persona_id=1)
    db_session.expire_all()
    assert db_session.get(SolicitudSupresionDatos, solicitud.id).estado == "EJECUTADA"


# --- T3(g): Cloudinary destruido; falla => aborto sin mutación -------------------
def test_destruye_foto_voucher_y_comprobante_en_cloudinary(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session, con_foto=True)
    historial = _crear_historial(db_session, persona, con_voucher=True)
    db_session.add(ComprobantePago(
        archivo_url="comprobante_ana_1", formato_archivo="pdf",
        pago_id=historial["pago_id"],
    ))
    db_session.commit()
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona)

    servicio.ejecutar(solicitud.id, admin_persona_id=1)

    objetivos = {c[0]: c for c in cloudinary_falso.llamadas}
    # Issue #1072: la foto de perfil también es un recurso `raw` (con la
    # extensión dentro del `public_id`), no un `image`.
    assert objetivos["perfil_ana"][1:3] == ("cataclub/fotos_perfil", "raw")
    assert objetivos["voucher_ana_1"][1:3] == ("cataclub/vouchers", "raw")
    assert objetivos["comprobante_ana_1"][1:3] == ("cataclub/comprobantes", "raw")
    # Todos los recursos privados del club son type="authenticated".
    assert all(c[3] == "authenticated" for c in cloudinary_falso.llamadas)
    assert len(cloudinary_falso.llamadas) == 3


def test_voucher_en_imagen_tambien_se_destruye_como_raw(db_session, cloudinary_falso):
    """Issue #1072: el voucher JPEG/PNG se sube como `raw` igual que el PDF,
    así que se destruye con ese `resource_type`. Antes se elegía por formato
    comparando contra `"pdf"` cuando la columna guarda el MIME completo
    (`"application/pdf"`): el PDF caía en la rama `image` y el destroy era un
    no-op silencioso que dejaba el recurso huérfano."""
    _crear_admin(db_session)
    persona = _crear_persona(db_session, con_foto=False)
    _crear_historial(db_session, persona, con_voucher=True, voucher_formato="image/jpeg")
    db_session.commit()
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona)

    servicio.ejecutar(solicitud.id, admin_persona_id=1)

    objetivos = {c[0]: c for c in cloudinary_falso.llamadas}
    assert objetivos["voucher_ana_1"][1:3] == ("cataclub/vouchers", "raw")
    assert objetivos["voucher_ana_1"][3] == "authenticated"


def test_fallo_de_cloudinary_aborta_sin_tocar_la_base(db_session):
    _crear_admin(db_session)
    persona = _crear_persona(db_session, con_foto=True)
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona)

    registro = _RegistroCloudinary()
    registro.error = ServicioNoDisponible(
        "No se pudo eliminar un archivo del almacenamiento externo.",
        detalle_tecnico="timeout simulado",
    )
    import app.servicios_negocio.supresion_datos_servicio as modulo
    original = modulo.eliminar_recurso_privado
    modulo.eliminar_recurso_privado = registro
    try:
        with pytest.raises(ServicioNoDisponible):
            servicio.ejecutar(solicitud.id, admin_persona_id=1)
    finally:
        modulo.eliminar_recurso_privado = original

    db_session.expire_all()
    assert db_session.get(Persona, persona.id).nombres == "Ana"
    assert db_session.get(SolicitudSupresionDatos, solicitud.id).estado == "APROBADA"


# --- T5: consentimientos y consultas de emergencia se conservan ------------------
def test_consentimientos_y_consultas_emergencia_sobreviven(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session)
    usuario = _crear_usuario(db_session, persona)
    _crear_sesion(db_session, usuario)
    consentimiento = _crear_consentimiento(db_session, usuario, persona)
    _crear_consulta_emergencia(db_session, persona, _crear_admin_consultante(db_session))
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona)

    servicio.ejecutar(solicitud.id, admin_persona_id=1)

    db_session.expire_all()
    consentimiento_tras = db_session.get(ConsentimientoLegal, consentimiento.id)
    assert consentimiento_tras is not None
    assert consentimiento_tras.cuenta_id == usuario.id
    # La cuenta NO se puede borrar con consentimientos RESTRICT: se neutraliza.
    usuario_tras = db_session.get(Usuario, usuario.id)
    assert usuario_tras is not None
    assert usuario_tras.correo == f"suprimido.{persona.id}@sin-datos.invalid"
    assert usuario_tras.activo is False
    assert db_session.query(Sesion).filter_by(usuario_id=usuario.id).count() == 0
    assert db_session.query(ConsultaFichaEmergencia).filter_by(
        alumno_persona_id=persona.id).count() == 1


def _crear_admin_consultante(db_session):
    return db_session.get(Persona, 1)


def test_sin_consentimientos_la_cuenta_se_elimina(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session)
    usuario = _crear_usuario(db_session, persona)
    _crear_sesion(db_session, usuario)
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona)

    servicio.ejecutar(solicitud.id, admin_persona_id=1)

    db_session.expire_all()
    assert db_session.get(Usuario, usuario.id) is None


# --- T5: outboxes pendientes ------------------------------------------------------
def test_outbox_pendiente_de_recuperacion_se_elimina(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session)
    usuario = _crear_usuario(db_session, persona)
    _crear_sesion(db_session, usuario)
    outboxes = _crear_outboxes(db_session, persona, usuario)
    # Capturar ids antes: tras la ejecución las instancias borradas ya no se
    # pueden refrescar (ObjectDeletedError).
    ids = {k: (v.id if v is not None else None) for k, v in outboxes.items()}
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona)

    servicio.ejecutar(solicitud.id, admin_persona_id=1)

    db_session.expire_all()
    assert db_session.query(RecuperacionOutbox).filter_by(
        id=ids["recuperacion_pendiente"]).first() is None
    assert db_session.query(EnrollmentNotificacionOutbox).filter_by(
        id=ids["enrollment_pendiente"]).first() is None
    assert db_session.query(EnrollmentNotificacionOutbox).filter_by(
        id=ids["enrollment_enviado"]).first() is not None


# --- Idempotencia de ejecución (nivel servicio) ------------------------------------
def test_doble_ejecucion_es_rechazada(db_session, cloudinary_falso):
    _crear_admin(db_session)
    persona = _crear_persona(db_session, cedula="1710034222")
    servicio = SupresionDatosServicio(db_session)
    solicitud = _solicitud_aprobada_y_vencida(db_session, servicio, persona)
    servicio.ejecutar(solicitud.id, admin_persona_id=1)

    with pytest.raises(OperacionInvalida):
        servicio.ejecutar(solicitud.id, admin_persona_id=1)
