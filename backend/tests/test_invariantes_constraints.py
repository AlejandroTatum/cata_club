"""
Invariantes de negocio garantizados EN LA BASE (auditoría hallazgo 7 +
adenda A y B, issue #8).

Los tres invariantes se protegían solo con el patrón leer-luego-escribir de
los servicios: dos peticiones concurrentes podían pasar las dos el chequeo y
violar el invariante. Criterio unificado:

  - Con forma de UNICIDAD -> índice único parcial en Postgres:
      1. Un solo pago PENDIENTE_VALIDACION por membresía
         (`uq_pago_pendiente_por_membresia`).
      2. Una sola membresía ACTIVA por persona
         (`uq_membresia_activa_por_persona`).
  - Con forma de CONTEO -> `SELECT ... FOR UPDATE` que serializa el
    leer-luego-escribir:
      3. Debe quedar al menos un administrador activo (lock sobre la fila
         del catálogo `rol` de ADMINISTRADOR).

Los chequeos de servicio existentes SIGUEN siendo el camino primario de error
(UX); el constraint/lock es la red de seguridad. Cuando la red atrapa lo que
el chequeo no vio (carrera), la API debe responder EL MISMO error de dominio
que respondería el chequeo (ver las pruebas de paridad al final).

Las pruebas de concurrencia usan sesiones independientes sobre `motor_test`,
commits reales y limpieza en el `finally` de la fixture, con una
`threading.Barrier` que hace determinística la carrera. La espera es
tolerante (`BrokenBarrierError` se ignora) a propósito: con el lock puesto,
uno de los dos hilos queda serializado ANTES de llegar a la barrera, así que
el otro debe poder continuar solo.
"""
import threading
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.enums import (
    EstadoMembresia, EstadoPago, TipoRol,
)
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import (
    Membresia, Persona, Rol, Usuario,
)
from app.infraestructura.repositorios import usuario_ficha_repositorio
from app.servicios_negocio.rol_servicio import RolServicio

# Fábricas mínimas compartidas (ORM directo: estas pruebas BURLAN los chequeos
# de los servicios a propósito, para demostrar que la base los respalda). La
# única copia vive en `tests/fabricas_pagos.py`, junto a las variantes API.
from tests.fabricas_pagos import (
    crear_membresia_orm as _crear_membresia,
    crear_pago_orm as _crear_pago,
    crear_persona_orm as _crear_persona,
    crear_tipo_membresia_api,
    crear_tipo_membresia_orm as _crear_tipo_membresia,
)
from tests.fabricas_pagos import crear_persona_api as _crear_persona_api_compartida


# ---------------------------------------------------------------------------
# Invariante 1: un solo pago PENDIENTE_VALIDACION por membresía.
# ---------------------------------------------------------------------------
def test_dos_pagos_pendientes_para_la_misma_membresia_violan_el_indice(db_session):
    """INSERT crudo que salta el chequeo de `registrar_pago`: la base debe
    rechazar el segundo pendiente con el índice único parcial."""
    persona = _crear_persona(db_session, cedula_valida(340))
    tipo = _crear_tipo_membresia(db_session)
    membresia = _crear_membresia(db_session, persona, tipo, EstadoMembresia.INACTIVA)

    _crear_pago(db_session, persona, membresia, EstadoPago.PENDIENTE_VALIDACION)
    db_session.flush()
    _crear_pago(db_session, persona, membresia, EstadoPago.PENDIENTE_VALIDACION)

    with pytest.raises(IntegrityError, match="uq_pago_pendiente_por_membresia"):
        db_session.flush()


def test_un_pendiente_y_un_aprobado_coexisten_para_la_misma_membresia(db_session):
    """El índice es PARCIAL: solo restringe pendientes. El historial de pagos
    aprobados/rechazados de la membresía no queda limitado."""
    persona = _crear_persona(db_session, cedula_valida(341))
    tipo = _crear_tipo_membresia(db_session)
    membresia = _crear_membresia(db_session, persona, tipo, EstadoMembresia.INACTIVA)

    _crear_pago(db_session, persona, membresia, EstadoPago.APROBADO)
    _crear_pago(db_session, persona, membresia, EstadoPago.RECHAZADO)
    _crear_pago(db_session, persona, membresia, EstadoPago.PENDIENTE_VALIDACION)

    db_session.flush()  # no debe lanzar


# ---------------------------------------------------------------------------
# Invariante 2: una sola membresía ACTIVA por persona.
# ---------------------------------------------------------------------------
def test_dos_membresias_activas_para_la_misma_persona_violan_el_indice(db_session):
    persona = _crear_persona(db_session, cedula_valida(342))
    tipo = _crear_tipo_membresia(db_session)

    _crear_membresia(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    membresia_2 = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        fecha_activacion=datetime.now(timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db_session.add(membresia_2)

    with pytest.raises(IntegrityError, match="uq_membresia_activa_por_persona"):
        db_session.flush()


def test_membresias_historicas_coexisten_con_la_activa(db_session):
    """La semántica actual permite historial: VENCIDA e INACTIVA conviven con
    la ACTIVA (el índice parcial solo cubre `estado = 'ACTIVA'`, espejo exacto
    del chequeo de `crear_membresia`)."""
    persona = _crear_persona(db_session, cedula_valida(343))
    tipo = _crear_tipo_membresia(db_session)

    _crear_membresia(db_session, persona, tipo, EstadoMembresia.VENCIDA)
    _crear_membresia(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    _crear_membresia(db_session, persona, tipo, EstadoMembresia.ACTIVA)

    db_session.flush()  # no debe lanzar


def _esperar_tolerante(barrera: threading.Barrier) -> None:
    """Con el lock puesto, uno de los dos hilos queda serializado ANTES de
    llegar a la barrera: el que sí llegó debe poder continuar solo cuando la
    barrera expira, y el serializado no debe reventar al encontrarla rota."""
    try:
        barrera.wait()
    except threading.BrokenBarrierError:
        pass


# ---------------------------------------------------------------------------
# Invariante 3: siempre queda al menos un administrador activo.
# ---------------------------------------------------------------------------
@pytest.fixture()
def escenario_ultimo_admin(motor_test):
    """Dos cuentas ADMINISTRADOR activas, commiteadas de verdad. El catálogo
    `rol` puede tener ya la fila ADMINISTRADOR (es get-or-create en el código
    de producción): solo se borra en la limpieza si la creó esta fixture."""
    sesion = Session(bind=motor_test)
    rol = sesion.query(Rol).filter(Rol.tipo_rol == TipoRol.ADMINISTRADOR).first()
    rol_creado_aqui = rol is None
    if rol is None:
        rol = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")
        sesion.add(rol)
        sesion.flush()
    persona_a = Persona(
        nombres="Admin", apellidos="Alfa", cedula=cedula_valida(344),
        fecha_nacimiento=date(1980, 1, 1), telefono="0990000905",
    )
    persona_b = Persona(
        nombres="Admin", apellidos="Beta", cedula=cedula_valida(345),
        fecha_nacimiento=date(1980, 1, 1), telefono="0990000906",
    )
    sesion.add_all([persona_a, persona_b])
    sesion.flush()
    usuario_a = Usuario(
        correo="admin.alfa.invariantes@cataclub.test", contrasenia="hash",
        persona_id=persona_a.id, roles=[rol],
    )
    usuario_b = Usuario(
        correo="admin.beta.invariantes@cataclub.test", contrasenia="hash",
        persona_id=persona_b.id, roles=[rol],
    )
    sesion.add_all([usuario_a, usuario_b])
    sesion.commit()
    ids = (persona_a.id, persona_b.id, usuario_a.id, usuario_b.id, rol.id)
    sesion.close()

    try:
        yield ids
    finally:
        limpieza = Session(bind=motor_test)
        for usuario_id in (ids[2], ids[3]):
            usuario = limpieza.get(Usuario, usuario_id)
            if usuario is not None:
                usuario.roles.clear()
                limpieza.delete(usuario)
        limpieza.flush()
        for persona_id in (ids[0], ids[1]):
            persona = limpieza.get(Persona, persona_id)
            if persona is not None:
                limpieza.delete(persona)
        if rol_creado_aqui:
            fila_rol = limpieza.get(Rol, ids[4])
            if fila_rol is not None:
                limpieza.delete(fila_rol)
        limpieza.commit()
        limpieza.close()


def test_operaciones_concurrentes_sobre_los_dos_ultimos_admins_dejan_al_menos_uno(
    motor_test, escenario_ultimo_admin
):
    """Quedan exactamente dos administradores activos. A la vez: a uno se le
    quita el rol y al otro se le desactiva la cuenta. Cada operación, mirando
    solo su propia lectura, ve que "queda otro" -- sin serialización las dos
    pasan y el club queda sin ningún administrador. Con el lock sobre la fila
    del catálogo ADMINISTRADOR, exactamente una gana y la otra recibe el
    error de "último administrador"."""
    persona_a_id, persona_b_id, _, _, _ = escenario_ultimo_admin

    barrera = threading.Barrier(2, timeout=3)
    contar_original = usuario_ficha_repositorio.UsuarioRepositorio.contar_administradores_activos
    local = threading.local()

    def contar_sincronizado(self, excluir_usuario_id=None):
        if not getattr(local, "ya_espero", False):
            local.ya_espero = True
            _esperar_tolerante(barrera)
        return contar_original(self, excluir_usuario_id=excluir_usuario_id)

    resultados: list = [None, None]

    def quitar_rol_a_alfa():
        sesion = Session(bind=motor_test)
        try:
            resultados[0] = RolServicio(sesion).quitar_rol(
                persona_a_id, TipoRol.ADMINISTRADOR
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[0] = error
            barrera.abort()
        finally:
            sesion.close()

    def desactivar_a_beta():
        sesion = Session(bind=motor_test)
        try:
            resultados[1] = RolServicio(sesion).cambiar_estado_cuenta(
                persona_b_id, activo=False
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[1] = error
            barrera.abort()
        finally:
            sesion.close()

    usuario_ficha_repositorio.UsuarioRepositorio.contar_administradores_activos = (
        contar_sincronizado
    )
    try:
        hilos = [
            threading.Thread(target=quitar_rol_a_alfa),
            threading.Thread(target=desactivar_a_beta),
        ]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=30)
    finally:
        usuario_ficha_repositorio.UsuarioRepositorio.contar_administradores_activos = (
            contar_original
        )

    errores = [r for r in resultados if isinstance(r, BaseException)]
    assert len(errores) == 1, (
        f"exactamente una de las dos operaciones debía fallar: {resultados}"
    )
    assert isinstance(errores[0], OperacionInvalida)
    assert "último administrador" in str(errores[0])

    sesion = Session(bind=motor_test)
    try:
        admins_activos = (
            sesion.query(Usuario)
            .join(Usuario.roles)
            .filter(Rol.tipo_rol == TipoRol.ADMINISTRADOR, Usuario.activo.is_(True))
            .count()
        )
    finally:
        sesion.close()
    assert admins_activos >= 1, "el club quedó sin ningún administrador activo"


# ---------------------------------------------------------------------------
# Paridad de errores: cuando el constraint atrapa la carrera que el chequeo
# del servicio no vio, la API responde EL MISMO error de dominio (mismo
# código, mismo mensaje) que cuando el chequeo la atrapa primero.
# ---------------------------------------------------------------------------
def _crear_persona_api(client, cedula="1710034065"):
    return _crear_persona_api_compartida(client, cedula, fecha_nacimiento="1990-05-14")


_crear_tipo_membresia_api = crear_tipo_membresia_api


def test_pago_pendiente_duplicado_responde_igual_por_chequeo_o_por_constraint(
    client, monkeypatch
):
    """Simula la lectura vencida de una petición concurrente anulando el
    chequeo del servicio: el constraint debe producir el MISMO 400 con el
    MISMO mensaje, no un 409 genérico ni un 500."""
    persona = _crear_persona_api(client)
    tipo = _crear_tipo_membresia_api(client)
    membresia = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00",
            "persona_id": persona["id"], "tipo_membresia_id": tipo["id"],
        },
    ).json()
    payload_pago = {
        "monto": "35.00", "tipo_pago": "EFECTIVO",
        "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
        "persona_id": persona["id"], "membresia_id": membresia["id"],
    }
    assert client.post("/api/v1/membresias/pagos", json=payload_pago).status_code == 201

    # Camino primario: el chequeo del servicio lo atrapa.
    respuesta_chequeo = client.post("/api/v1/membresias/pagos", json=payload_pago)
    assert respuesta_chequeo.status_code == 400

    # Carrera simulada: el chequeo no ve el pendiente; la base lo rechaza.
    from app.infraestructura.repositorios.pago_repositorio import PagoRepositorio
    monkeypatch.setattr(
        PagoRepositorio, "existe_pendiente_para_membresia",
        lambda self, membresia_id: False,
    )
    respuesta_constraint = client.post("/api/v1/membresias/pagos", json=payload_pago)

    assert respuesta_constraint.status_code == 400
    assert respuesta_constraint.json()["detail"] == respuesta_chequeo.json()["detail"]


def test_membresia_activa_duplicada_responde_igual_por_chequeo_o_por_constraint(
    client, db_session
):
    """El escritor real de ACTIVA es `validar_pago` (aprobar activa la
    membresía). Dos membresías INACTIVAS de la misma persona con pagos
    aprobables son la carrera que el chequeo de `crear_membresia` no puede
    ver: al aprobar la segunda, el constraint debe responder el MISMO error
    que el chequeo, no un 409 genérico."""
    persona = _crear_persona(db_session, cedula_valida(346))
    tipo = _crear_tipo_membresia(db_session)
    _crear_membresia(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    db_session.commit()

    # Camino primario: el chequeo de crear_membresia lo atrapa.
    respuesta_chequeo = client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "30.00",
            "persona_id": persona.id, "tipo_membresia_id": tipo.id,
        },
    )
    assert respuesta_chequeo.status_code == 400

    # Carrera real del invariante: una segunda membresía que ya existía como
    # INACTIVA (creada cuando no había ninguna activa) con un pago pendiente;
    # aprobarlo intenta activar la segunda y la base lo rechaza.
    membresia_inactiva = _crear_membresia(
        db_session, persona, tipo, EstadoMembresia.INACTIVA
    )
    pago = _crear_pago(
        db_session, persona, membresia_inactiva, EstadoPago.PENDIENTE_VALIDACION
    )
    db_session.commit()

    respuesta_constraint = client.patch(
        f"/api/v1/membresias/pagos/{pago.id}/validar",
        json={"estado_pago": "APROBADO"},
    )

    assert respuesta_constraint.status_code == 400
    assert respuesta_constraint.json()["detail"] == respuesta_chequeo.json()["detail"]
