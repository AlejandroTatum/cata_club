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
from unittest.mock import Mock

import pytest
from celery.exceptions import Retry as CeleryRetry
from sqlalchemy.orm import Session

import app.infraestructura.tareas.alertas_tareas as alertas_mod
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago
from app.dominio.excepciones import ServicioNoDisponible
from app.dominio.modelos import Membresia, Notificacion, Pago, Persona, TipoMembresia, Usuario
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.soporte_transversal.resiliencia import CIRCUITO_SMTP_COOLDOWN_SEGUNDOS
from tests.smtp_falso import configurar_smtp_falso


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


def _crear_persona(db, cedula: str, *, representante_id: int | None = None) -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Test", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991112222",
        representante_id=representante_id,
    )
    db.add(persona)
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


def test_fallo_global_de_envio_no_deja_fila_marcada(db_session, sesion_inyectada, monkeypatch):
    """Orden envío-antes-de-commit para el fallo GLOBAL/reintentable: si el
    correo todavía puede salir en un reintento, no se commitea una fila que
    diría "ya avisado" y dejaría a la familia sin aviso para siempre.

    El nombre dice ahora "global" porque desde el issue #837 la regla dejó de
    ser universal: un rechazo DEFINITIVO de la dirección (5xx por
    destinatario) sí commitea la fila -- ahí no hay reintento que pueda
    salvar el correo, y no commitear dejaría a esa familia sin NINGÚN canal.
    Ese caso lo fija `test_lote_de_tres_sigue_cuando_el_del_medio_es_
    rechazado_permanentemente`. Este test conserva sus asserts intactos: sobre
    un `ConnectionError` (transporte) la tarea sigue levantando y sin dejar
    filas."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(111))
    _crear_usuario(db_session, persona, "alumno012@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch, falla=ConnectionError("smtp caído"))

    with pytest.raises(ConnectionError):
        alertas_mod.alertar_vencimientos_hoy_mas_5()

    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 0


def test_no_hay_transaccion_abierta_durante_el_envio(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(112))
    _crear_usuario(db_session, persona, "alumno013@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)

    observado: dict = {}

    def _espiar(self, **kwargs):
        observado["filas_durante_envio"] = (
            db_session.query(Notificacion)
            .filter(Notificacion.persona_id == persona.id)
            .count()
        )

    monkeypatch.setattr(ServicioNotificaciones, "enviar_correo", _espiar)

    alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert observado["filas_durante_envio"] == 0


def test_sin_smtp_configurado_igual_crea_notificacion(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(113))
    _crear_usuario(db_session, persona, "alumno014@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch, falla=RuntimeError("SMTP_HOST no está configurado"))

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1
    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id == persona.id
    ).count()
    assert total == 1


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


# --- Fase 3.3: alineación del countdown de reintento al cooldown del
# circuito SMTP (degradacion-controlada, slice 3, Decisión B del diseño) ----

def test_reintento_del_lote_usa_el_cooldown_del_circuito(
    db_session, sesion_inyectada, monkeypatch
):
    """Un circuito SMTP ABIERTO hace que `enviar_correo` levante
    `ServicioNoDisponible`. Sin este override, el backoff exponencial por
    defecto de Celery (0-1s, 0-2s, 0-4s -- ~7s peor caso) agotaría los 3
    reintentos DENTRO del cooldown del circuito y el lote del día se
    perdería. La tarea debe llamar a `self.retry(countdown=...)` con el
    cooldown del circuito en vez de dejar el backoff por defecto."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(118))
    _crear_usuario(db_session, persona, "alumno019@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch, falla=ServicioNoDisponible("circuito SMTP abierto"))

    mock_retry = Mock(side_effect=CeleryRetry("reintentando", None))
    monkeypatch.setattr(alertas_mod.alertar_vencimientos_hoy_mas_5, "retry", mock_retry)

    with pytest.raises(CeleryRetry):
        alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert mock_retry.call_count == 1
    _, kwargs = mock_retry.call_args
    assert kwargs["countdown"] == CIRCUITO_SMTP_COOLDOWN_SEGUNDOS
    assert isinstance(kwargs["exc"], ServicioNoDisponible)


# --- consultas-sin-n1, slice 2: N+1 al cargar Persona.usuario --------------

def test_alertar_vencimientos_no_incurre_en_n_mas_uno_al_cargar_usuario(
    db_session, sesion_inyectada, contar_selects, monkeypatch
):
    """`persona.usuario` se accedía sin eager load: una consulta extra por
    destinatario (`SELECT usuario WHERE persona_id = ...`), lazy-cacheada por
    instancia así que un solo acceso por persona basta para reproducirla.

    El lote NO queda libre de N+1 después de este fix -- se elimina SOLO el
    de `Persona.usuario`. `_disparar_notificacion_vencimiento` sigue llamando
    a `_ya_notificado` una vez por destinatario (idempotencia, PR #120 de
    `degradacion-controlada`, no removible con un loader option); sin
    representante ese chequeo corre 1 vez por fila, no 2 (el chequeo del
    representante hace cortocircuito cuando `representante_id` es None y no
    emite SELECT). Aritmética con N=3 destinatarios, todos con `Usuario`, sin
    representante:
        HOY  (sin joinedload): 1 (lote) + 3 (usuario lazy) + 3 (_ya_notificado) = 7
        LUEGO (con joinedload): 1 (lote, ya trae usuario)  + 3 (_ya_notificado) = 4
    El total sigue creciendo con N -- 1+N, no una constante -- porque
    `_ya_notificado` es intrínsecamente por-fila. Esta prueba fija ese "1+N",
    no un número mágico, para que no se lea un futuro `1+N` como una
    regresión."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    # `sesion_inyectada` colapsa las DOS sesiones reales de la tarea (lote de
    # lectura + escritura por notificación) en la MISMA `db_session`. En
    # producción son sesiones distintas: el `commit()` de la de escritura
    # nunca expira los objetos ya cargados por la de lectura. Con una sola
    # sesión, el `expire_on_commit` por defecto SÍ los expira -- se
    # refrescarían `pago`/`membresia`/`persona` con SELECTs adicionales que no
    # existen en producción y arruinarían la aritmética "1+N". Se desactiva
    # acá para que el conteo refleje el comportamiento real de dos sesiones,
    # no un artefacto de haberlas colapsado para poder observarlas.
    db_session.expire_on_commit = False
    cantidad = 3
    for i in range(cantidad):
        persona = _crear_persona(db_session, cedula_valida(119 + i))
        _crear_usuario(db_session, persona, f"alumno{70 + i}@cataclub.test")
        _crear_membresia_con_pago(db_session, persona, VENCE)
    _mock_envio(monkeypatch)

    with contar_selects() as sentencias:
        resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == cantidad
    selects = [s for s in sentencias if s.strip().upper().startswith("SELECT")]
    assert len(selects) == 1 + cantidad, (
        f"Se esperaban 1 + {cantidad} = {1 + cantidad} SELECTs (batch con "
        f"joinedload + un `_ya_notificado` por fila), se ejecutaron "
        f"{len(selects)}: {selects}"
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


# --- Issue #837: un destinatario rechazado de forma permanente no mata el
# lote ------------------------------------------------------------------------
# Estos dos tests NO usan `_mock_envio`: doblan `smtplib.SMTP` (ver
# `tests/smtp_falso.py`) para que corra el clasificador real de
# `notificaciones_servicio`. Lo que se declara acá es el CÓDIGO SMTP crudo, no
# la excepción de dominio ya elegida -- si la traducción se rompiera, estos
# tests lo verían.

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


def test_lote_de_tres_sigue_cuando_el_del_medio_es_rechazado_permanentemente(
    db_session, sesion_inyectada, monkeypatch
):
    """Verificación del issue #837, textual: un lote de 3 destinatarios donde
    el segundo devuelve `SMTPRecipientsRefused` con un 5xx.

    Antes: `enviar_correo` traducía ese rechazo a `ServicioNoDisponible`, el
    handler del lote lo leía como "circuito abierto" y abortaba con
    `self.retry` -- se enviaba 1 solo correo, el reintento chocaba contra la
    misma dirección mala y a los 3 intentos el lote del día moría entero.

    Ahora: el 5xx por destinatario es terminal, el lote sigue con el
    siguiente, la notificación in-app del rechazado igual se crea y el fallo
    queda registrado en la fila."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    personas, correos, pagos = _sembrar_lote_de_tres(db_session)
    rechazado_pago_id = pagos[1]
    registro = configurar_smtp_falso(
        monkeypatch, rechazos={correos[1]: (550, "buzón inexistente")},
    )
    mock_retry = Mock(side_effect=CeleryRetry("reintentando", None))
    monkeypatch.setattr(alertas_mod.alertar_vencimientos_hoy_mas_5, "retry", mock_retry)

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    # Los otros dos destinatarios se atendieron; el rechazado no se reintenta.
    assert sorted(registro.enviados) == sorted([correos[0], correos[2]])
    assert mock_retry.call_count == 0, (
        "un rechazo permanente de UNA dirección no puede reprogramar el lote "
        "entero: el reintento choca contra la misma dirección"
    )
    # Los tres avisos se emitieron (el correo es un canal, la alerta es la
    # fila in-app), y el rechazo del tercero queda visible en el resumen de
    # la corrida en vez de perderse en el log.
    assert resultado["total_alertas"] == 3
    assert resultado["total_rechazos_permanentes"] == 1
    assert resultado["rechazos_permanentes"] == [
        {"pago_id": rechazado_pago_id, "persona_id": personas[1].id},
    ]

    # La notificación in-app existe para los TRES, incluido el rechazado: el
    # correo es un canal, no la notificación.
    filas = {
        fila.persona_id: fila
        for fila in db_session.query(Notificacion).filter(
            Notificacion.persona_id.in_([p.id for p in personas])
        )
    }
    assert set(filas) == {p.id for p in personas}

    # Auditoría durable del que falló, y SOLO del que falló.
    rechazada = filas[personas[1].id]
    assert rechazada.last_error_redacted is not None
    assert "550" in rechazada.last_error_redacted
    assert filas[personas[0].id].last_error_redacted is None
    assert filas[personas[2].id].last_error_redacted is None


def test_lote_de_tres_aborta_con_cooldown_si_el_fallo_es_global(
    db_session, sesion_inyectada, monkeypatch
):
    """Contracara del test de arriba: un fallo de TRANSPORTE (el relay no
    contesta) no es de un destinatario, así que la política vieja se conserva
    intacta -- el lote se reprograma con el cooldown del circuito y no queda
    ninguna fila commiteada."""
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    personas, _correos, _pagos = _sembrar_lote_de_tres(db_session)
    configurar_smtp_falso(
        monkeypatch, fallo_de_transporte=OSError("el relay no contesta"),
    )
    mock_retry = Mock(side_effect=CeleryRetry("reintentando", None))
    monkeypatch.setattr(alertas_mod.alertar_vencimientos_hoy_mas_5, "retry", mock_retry)

    with pytest.raises(CeleryRetry):
        alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert mock_retry.call_count == 1
    _, kwargs = mock_retry.call_args
    assert kwargs["countdown"] == CIRCUITO_SMTP_COOLDOWN_SEGUNDOS
    assert isinstance(kwargs["exc"], ServicioNoDisponible)
    total = db_session.query(Notificacion).filter(
        Notificacion.persona_id.in_([p.id for p in personas])
    ).count()
    assert total == 0


def test_representante_recibe_una_sola_notificacion_en_reintento(
    db_session, sesion_inyectada, monkeypatch
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    representante = _crear_persona(db_session, cedula_valida(116))
    alumno = _crear_persona(db_session, cedula_valida(117), representante_id=representante.id)
    _crear_usuario(db_session, alumno, "alumno018@cataclub.test")
    _crear_membresia_con_pago(db_session, alumno, VENCE)
    _mock_envio(monkeypatch)

    alertas_mod.alertar_vencimientos_hoy_mas_5()
    alertas_mod.alertar_vencimientos_hoy_mas_5()

    total_rep = db_session.query(Notificacion).filter(
        Notificacion.persona_id == representante.id
    ).count()
    assert total_rep == 1


def test_retirada_no_recibe_alerta_de_vencimiento(db_session, sesion_inyectada, monkeypatch):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY)
    persona = _crear_persona(db_session, cedula_valida(118))
    persona.activo = False
    _crear_usuario(db_session, persona, "retirada-vencimiento@cataclub.test")
    _crear_membresia_con_pago(db_session, persona, VENCE)

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 0
