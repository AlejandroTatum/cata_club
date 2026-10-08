"""
Tests de la tarea Celery `alertar_vencimientos_hoy_mas_5` — alertas de
vencimiento de membresía a 5 días (auditoría degradacion-controlada, slice 1).

Bug corregido: `db.refresh(persona, ["usuario"])` se llamaba sobre una sesión
distinta a la que había cargado `persona` (dos `with SessionLocal() as db:`
anidados; `SessionLocal` es un `sessionmaker` plano -- no un
`scoped_session` -- así que son objetos `Session` genuinamente distintos).
El primer test de este archivo reproduce el bug con sesiones REALES, sin usar
el fixture `sesion_inyectada` de `test_dia_del_club_en_call_sites.py` (que
monkeypatchea `SessionLocal` para devolver siempre la MISMA sesión y por eso
colapsa ambas sesiones en una sola, enmascarando el bug -- ver diseño,
sección "Correction to the proposal").

El resto de las pruebas de este archivo SÍ usa sesión inyectada (mismo
patrón que `test_vencimientos_tareas.py`): verifican reglas de negocio
(dedup, orden envío-antes-de-commit) que son ortogonales al bug de sesión
cruzada, ya corregido para cuando estas pruebas corren.
"""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

import app.infraestructura.tareas.alertas_tareas as alertas_mod
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago
from app.dominio.modelos import Membresia, Notificacion, Pago, Persona, TipoMembresia, Usuario
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones


HOY = date(2029, 6, 15)
VENCE = HOY + timedelta(days=5)


# --- Fase 1.1: reproducción con sesiones REALES, sin `sesion_inyectada` ----

@pytest.fixture()
def escenario_vencimiento_real(motor_test):
    """Persona + Usuario + Membresía ACTIVA + Pago APROBADO, COMMITEADOS de
    verdad en su propia sesión/conexión -- necesario para que la tarea (que
    abre su propia `SessionLocal()`, real, SIN mockear) los lea desde una
    sesión GENUINAMENTE distinta de la que sembró los datos (mismo patrón que
    `test_pago_comprobante_atomico.py::escenario_pago_concurrente`)."""
    sesion = Session(bind=motor_test)
    persona = Persona(
        nombres="Marta", apellidos="Vence", cedula=cedula_valida(122),
        fecha_nacimiento=date(1990, 1, 1), telefono="0990009991",
    )
    sesion.add(persona)
    sesion.flush()
    correo = "marta.vence991@cataclub.test"
    usuario = Usuario(correo=correo, contrasenia="hash", persona_id=persona.id)
    sesion.add(usuario)
    tipo = TipoMembresia(
        categoria="Vencimiento Real",
        precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
    )
    sesion.add(tipo)
    sesion.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    sesion.add(membresia)
    sesion.flush()
    pago = Pago(
        monto=Decimal("35.00"), estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=datetime(2026, 1, 1, tzinfo=timezone.utc),
        fecha_inicio=date(2026, 1, 1), fecha_fin=VENCE,
        persona_id=persona.id, membresia_id=membresia.id,
    )
    sesion.add(pago)
    sesion.commit()
    ids = (persona.id, usuario.id, membresia.id, tipo.id, pago.id)
    sesion.close()

    try:
        yield {
            "persona_id": ids[0], "usuario_id": ids[1],
            "membresia_id": ids[2], "tipo_id": ids[3], "pago_id": ids[4],
            "correo": correo,
        }
    finally:
        limpieza = Session(bind=motor_test)
        limpieza.query(Notificacion).filter(
            Notificacion.persona_id == ids[0]
        ).delete()
        limpieza.query(Pago).filter(Pago.id == ids[4]).delete()
        limpieza.query(Membresia).filter(Membresia.id == ids[2]).delete()
        limpieza.query(TipoMembresia).filter(TipoMembresia.id == ids[3]).delete()
        limpieza.query(Usuario).filter(Usuario.id == ids[1]).delete()
        limpieza.query(Persona).filter(Persona.id == ids[0]).delete()
        limpieza.commit()
        limpieza.close()


def test_disparar_notificacion_no_cruza_sesiones(escenario_vencimiento_real, monkeypatch):
    """Reproduce el bug con sesiones REALES: hoy, `alertar_vencimientos_hoy_
    mas_5` abre una sesión para leer el lote y `_disparar_notificacion_
    vencimiento` abre OTRA para escribir -- `SessionLocal` es un
    `sessionmaker` plano, así que son instancias `Session` distintas.
    `db.refresh(persona, ["usuario"])` sobre la sesión equivocada lanza
    `InvalidRequestError` antes de intentar ningún envío. Sin este test (que
    evita `sesion_inyectada`, que colapsa ambas sesiones en una sola y
    enmascara el bug), la corrida real queda invisible a la suite."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    llamadas = []
    monkeypatch.setattr(
        ServicioNotificaciones, "enviar_correo",
        lambda self, **kwargs: llamadas.append(kwargs),
    )

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1
    assert len(llamadas) == 1
    assert llamadas[0]["destinatario"] == escenario_vencimiento_real["correo"]


# --- Fases 1.2-1.4: reglas de negocio, con sesión inyectada -----------------
# Ortogonales al bug de sesión cruzada (ya corregido cuando estas pruebas
# corren); usar `db_session` inyectado es más simple y rápido (aislamiento
# por transacción, sin limpieza manual), mismo criterio que
# `test_vencimientos_tareas.py`.

@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    """Inyecta `db_session` en el `SessionLocal` del módulo de la tarea."""
    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(alertas_mod, "SessionLocal", _factory)
    return db_session


def _crear_persona(
    db, cedula: str, *, representante_id: int | None = None,
    fecha_nacimiento: date = date(1990, 1, 1),
) -> Persona:
    # Ver `test_alertas_mora.py::_crear_persona`: el representado legado se
    # siembra como menor y envejece en el sitio.
    vinculado = representante_id is not None
    persona = Persona(
        nombres="Ana", apellidos="Test", cedula=cedula,
        fecha_nacimiento=date(2015, 1, 1) if vinculado else fecha_nacimiento,
        telefono="0991112222", representante_id=representante_id,
    )
    db.add(persona)
    db.flush()
    if vinculado:
        persona.fecha_nacimiento = fecha_nacimiento  # envejece en el sitio
        db.flush()
    return persona


def _crear_usuario(db, persona: Persona, correo: str) -> Usuario:
    usuario = Usuario(correo=correo, contrasenia="hash", persona_id=persona.id)
    db.add(usuario)
    db.flush()
    return usuario


def _crear_membresia_con_pago(db, persona: Persona, fecha_fin: date) -> tuple[Membresia, Pago]:
    tipo = TipoMembresia(
        categoria="Mensual Adultos",
        precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    pago = Pago(
        monto=Decimal("35.00"), estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=datetime(2026, 1, 1, tzinfo=timezone.utc),
        fecha_inicio=date(2026, 1, 1), fecha_fin=fecha_fin,
        persona_id=persona.id, membresia_id=membresia.id,
    )
    db.add(pago)
    db.commit()
    return membresia, pago


def _mock_envio(monkeypatch, *, falla: Exception | None = None) -> list[dict]:
    """Reemplaza `ServicioNotificaciones.enviar_correo`; si `falla` se pasa,
    la simula lanzando esa excepción en vez de registrar el envío."""
    llamadas: list[dict] = []

    def _fake(self, **kwargs):
        if falla is not None:
            raise falla
        llamadas.append(kwargs)

    monkeypatch.setattr(ServicioNotificaciones, "enviar_correo", _fake)
    return llamadas


def test_notificacion_guarda_entidad_relacionada_id_del_pago(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(110))
    _crear_usuario(db_session, persona, "alumno011@cataclub.test")
    _, pago = _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_vencimientos_hoy_mas_5()

    fila = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).one()
    assert fila.entidad_relacionada_id == pago.id


def test_un_fallo_al_encolar_no_commitea_nada(db_session, sesion_inyectada, monkeypatch):
    """Notificaciones y correos van en UNA transacción (issue #1710): si
    encolar falla, no queda commiteada una fila que diría "ya avisado" y
    dejaría a la familia sin correo para siempre. El `rollback` descarta lo
    pendiente; lo que hubiera llegado a commitearse sobreviviría."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(111))
    _crear_usuario(db_session, persona, "alumno012@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch, falla=ConnectionError("no se pudo encolar"))

    with pytest.raises(ConnectionError):
        alertas_mod.alertar_vencimientos_hoy_mas_5()
    db_session.rollback()

    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 0


def test_persona_sin_usuario_crea_notificacion_sin_correo(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(114))
    _crear_membresia_con_pago(db_session, persona, VENCE)
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1
    assert llamadas == []
    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 1


def test_reintento_no_duplica_notificacion_ni_correo(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(115))
    _crear_usuario(db_session, persona, "alumno016@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_vencimientos_hoy_mas_5()
    alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert len(llamadas) == 1
    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 1


# --- consultas-sin-n1, slice 2: N+1 al cargar Persona.usuario --------------
# --- y issue #833: dedup de idempotencia en lote, no por destinatario ------

@pytest.mark.parametrize("cantidad", [3, 6])
def test_alertar_vencimientos_no_incurre_en_n_mas_uno_al_cargar_usuario(
    db_session, sesion_inyectada, contar_selects, monkeypatch, cantidad
):
    """`persona.usuario` se accedía sin eager load: una consulta extra por
    destinatario, corregida con `joinedload(Persona.usuario)` en el lote.

    Issue #833: la dedup (antes `_ya_notificado`, un `SELECT` por
    destinatario) ahora corre en UNA sola consulta de lote
    (`_notificaciones_existentes`), así que el total deja de crecer con
    `cantidad`: 1 (lote, con joinedload) + 1 (dedup en lote) = 2, constante
    -- se corre con 3 Y con 6 destinatarios para fijarlo."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    # `sesion_inyectada` colapsa las DOS sesiones reales de la tarea (lote de
    # lectura + escritura del lote) en la MISMA `db_session`. En producción
    # son sesiones distintas: el `commit()` de la de escritura nunca expira
    # los objetos ya cargados por la de lectura. Con una sola sesión, el
    # `expire_on_commit` por defecto SÍ los expira -- se refrescarían
    # `pago`/`membresia`/`persona` con SELECTs adicionales que no existen en
    # producción. Se desactiva acá para que el conteo refleje el
    # comportamiento real de dos sesiones, no un artefacto de haberlas
    # colapsado para poder observarlas.
    db_session.expire_on_commit = False
    for i in range(cantidad):
        persona = _crear_persona(db_session, cedula_valida(119 + i))
        _crear_usuario(db_session, persona, f"alumno{70 + i}@cataclub.test")
        _crear_membresia_con_pago(db_session, persona, VENCE)

    # Issue #905: algunas familias con representante (que también carga
    # `Persona.usuario` DEL representante, no solo el propio) -- el
    # joinedload encadenado no debe sumar un SELECT extra.
    extra = min(2, cantidad)
    for i in range(extra):
        representante = _crear_persona(db_session, cedula_valida(150 + i))
        _crear_usuario(db_session, representante, f"representante{150 + i}@cataclub.test")
        alumno_con_rep = _crear_persona(
            db_session, cedula_valida(160 + i), representante_id=representante.id,
        )
        _crear_membresia_con_pago(db_session, alumno_con_rep, VENCE)
    _mock_envio(monkeypatch)

    with contar_selects() as sentencias:
        resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == cantidad + extra
    selects = [s for s in sentencias if s.strip().upper().startswith("SELECT")]
    assert len(selects) == 2, (
        f"Se esperaban 2 SELECTs (batch con joinedload + dedup en lote), "
        f"constantes sin importar `cantidad`; se ejecutaron {len(selects)} "
        f"con cantidad={cantidad}: {selects}"
    )


# --- Recuperación de corrida perdida (issue #791, punto 2) -----------------
# El match original era `Pago.fecha_fin == fecha_objetivo` (exactamente HOY +
# 5 días): si Beat no corre ese día (OOM, colgado), el aviso de esa membresía
# se pierde para siempre -- el día siguiente ya no matchea "hoy + 5". La
# ventana `hoy <= fecha_fin <= hoy + 5` cubre esa corrida perdida sin duplicar
# gracias a `_ya_notificado` (dedup por `(tipo, persona_id, pago_id)`, no por
# fecha).

def test_vencimiento_a_3_dias_se_notifica_por_ventana_de_recuperacion(
    db_session, sesion_inyectada, monkeypatch
):
    """Simula una corrida de Beat perdida: la membresía vence en 3 días (no en
    5), así que con el match exacto original la fila no aparece nunca en
    ningún lote. Con la ventana `hoy <= fecha_fin <= hoy + 5` sí se notifica."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(120))
    _crear_usuario(db_session, persona, "alumno021@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, HOY + timedelta(days=3))
    llamadas = _mock_envio(monkeypatch)

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1
    assert len(llamadas) == 1
    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 1
    # La ventana amplió QUÉ pagos matchean, pero el aviso debe seguir
    # nombrando la fecha REAL de vencimiento de ESE pago (HOY + 3), no el
    # borde de la ventana escaneada (HOY + 5) -- ver
    # `test_el_aviso_nombra_la_fecha_real_de_vencimiento_no_el_borde_de_la_ventana`
    # más abajo, que es la que realmente fija esta regla.
    fecha_real = (HOY + timedelta(days=3)).strftime("%d/%m/%Y")
    fila = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).one()
    assert fecha_real in fila.mensaje


def test_el_aviso_nombra_la_fecha_real_de_vencimiento_no_el_borde_de_la_ventana(
    db_session, sesion_inyectada, monkeypatch
):
    """Pin de contenido, no solo de conteo: una membresía que vence en 3 días
    (dentro de la ventana de recuperación `hoy..hoy+5`) debe recibir un aviso
    que diga "vence el <HOY+3>" -- la fecha REAL de ESE pago -- y NUNCA
    "vence el <HOY+5>" (`fecha_objetivo`, el borde de la ventana escaneada por
    el lote). Cubre tanto la notificación in-app como el cuerpo del correo
    realmente enviado."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(121))
    _crear_usuario(db_session, persona, "alumno022@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, HOY + timedelta(days=3))
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_vencimientos_hoy_mas_5()

    fecha_real = (HOY + timedelta(days=3)).strftime("%d/%m/%Y")
    fecha_borde_ventana = (HOY + timedelta(days=5)).strftime("%d/%m/%Y")
    assert fecha_real != fecha_borde_ventana  # la prueba no sería honesta si coincidieran

    fila = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).one()
    assert fecha_real in fila.mensaje
    assert fecha_borde_ventana not in fila.mensaje

    assert len(llamadas) == 1
    cuerpo = llamadas[0]["cuerpo_texto"]
    assert fecha_real in cuerpo
    assert fecha_borde_ventana not in cuerpo


def _sembrar_lote_de_tres(db) -> tuple[list[Persona], list[str], list[int]]:
    personas: list[Persona] = []
    correos: list[str] = []
    pagos: list[int] = []
    for indice in range(3):
        persona = _crear_persona(db, cedula_valida(130 + indice))
        correo = f"lote{indice}@cataclub.test"
        _crear_usuario(db, persona, correo)
        _, pago = _crear_membresia_con_pago(db, persona, VENCE)
        personas.append(persona)
        correos.append(correo)
        pagos.append(pago.id)
    return personas, correos, pagos


def test_representante_recibe_una_sola_notificacion_en_reintento(
    db_session, sesion_inyectada, monkeypatch
):
    # Issue #905: el representante es el ÚNICO responsable de pago -- recibe
    # ambos canales y el alumno representado no recibe ninguno.
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    representante = _crear_persona(db_session, cedula_valida(116))
    correo_representante = "representante116@cataclub.test"
    _crear_usuario(db_session, representante, correo_representante)
    alumno = _crear_persona(db_session, cedula_valida(117), representante_id=representante.id)
    _crear_usuario(db_session, alumno, "alumno018@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, VENCE)
    llamadas = _mock_envio(monkeypatch)

    alertas_mod.alertar_vencimientos_hoy_mas_5()
    alertas_mod.alertar_vencimientos_hoy_mas_5()

    total_rep = db_session.query(Notificacion).filter(
        Notificacion.persona_id == representante.id
    ).count()
    assert total_rep == 1
    total_alumno = db_session.query(Notificacion).filter(
        Notificacion.persona_id == alumno.id
    ).count()
    assert total_alumno == 0
    assert [envio["destinatario"] for envio in llamadas] == [correo_representante]


def test_retirada_no_recibe_alerta_de_vencimiento(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(118))
    persona.activo = False
    _crear_usuario(db_session, persona, "retirada-vencimiento@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 0
