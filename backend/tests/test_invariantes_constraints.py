"""
Invariantes de negocio garantizados EN LA BASE (auditoría hallazgo 7 +
adenda A y B, issue #8).

Los cuatro invariantes se protegían solo con el patrón leer-luego-escribir de
los servicios: dos peticiones concurrentes podían pasar las dos el chequeo y
violar el invariante. Criterio unificado:

  - Con forma de UNICIDAD -> índice único parcial en Postgres:
      1. Un solo pago PENDIENTE_VALIDACION por membresía
         (`uq_pago_pendiente_por_membresia`).
      2. Una sola membresía ACTIVA por persona
         (`uq_membresia_activa_por_persona`).
  - Con forma de CONTEO -> `SELECT ... FOR UPDATE` que serializa el
    leer-luego-escribir:
      3. Capacidad máxima de un nivel de ranking (lock sobre la fila del
         nivel).
      4. Debe quedar al menos un administrador activo (lock sobre la fila
         del catálogo `rol` de ADMINISTRADOR).

Los chequeos de servicio existentes SIGUEN siendo el camino primario de error
(UX); el constraint/lock es la red de seguridad. Cuando la red atrapa lo que
el chequeo no vio (carrera), la API debe responder EL MISMO error de dominio
que respondería el chequeo (ver las pruebas de paridad al final).

Las pruebas de concurrencia siguen el patrón de `test_ranking_concurrencia.py`:
sesiones independientes sobre `motor_test`, commits reales y limpieza en el
`finally` de la fixture, con una `threading.Barrier` que hace determinística
la carrera. La espera es tolerante (`BrokenBarrierError` se ignora) a
propósito: con el lock puesto, uno de los dos hilos queda serializado ANTES
de llegar a la barrera, así que el otro debe poder continuar solo.
"""
import threading
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.enums import (
    EstadoMembresia, EstadoPago, TipoModalidad, TipoPago, TipoRol,
)
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import (
    Membresia, NivelRanking, Pago, Persona, Ranking, Rol, TipoMembresia, Usuario,
)
from app.infraestructura.repositorios import (
    ranking_repositorio, usuario_ficha_repositorio,
)
from app.servicios_negocio.ranking_servicio import RankingServicio
from app.servicios_negocio.rol_servicio import RolServicio


# ---------------------------------------------------------------------------
# Fábricas mínimas (ORM directo: estas pruebas BURLAN los chequeos de los
# servicios a propósito, para demostrar que la base los respalda).
# ---------------------------------------------------------------------------
def _crear_persona(sesion, cedula: str) -> Persona:
    persona = Persona(
        nombres="Invariante", apellidos="Constraint", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0990001111",
    )
    sesion.add(persona)
    sesion.flush()
    return persona


def _crear_tipo_membresia(sesion) -> TipoMembresia:
    tipo = TipoMembresia(
        categoria="Adultos", franja_horaria="18:00-19:00",
        precio=Decimal("30.00"), modalidad=TipoModalidad.MENSUAL,
    )
    sesion.add(tipo)
    sesion.flush()
    return tipo


def _crear_membresia(sesion, persona, tipo, estado: EstadoMembresia) -> Membresia:
    membresia = Membresia(
        estado=estado, monto_aplicado=Decimal("30.00"),
        fecha_activacion=datetime.now(timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    sesion.add(membresia)
    sesion.flush()
    return membresia


def _crear_pago(sesion, persona, membresia, estado: EstadoPago) -> Pago:
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=estado, tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(2026, 7, 1), fecha_fin=date(2026, 7, 31),
        persona_id=persona.id, membresia_id=membresia.id,
    )
    sesion.add(pago)
    return pago


# ---------------------------------------------------------------------------
# Invariante 1: un solo pago PENDIENTE_VALIDACION por membresía.
# ---------------------------------------------------------------------------
def test_dos_pagos_pendientes_para_la_misma_membresia_violan_el_indice(db_session):
    """INSERT crudo que salta el chequeo de `registrar_pago`: la base debe
    rechazar el segundo pendiente con el índice único parcial."""
    persona = _crear_persona(db_session, "1799000801")
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
    persona = _crear_persona(db_session, "1799000802")
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
    persona = _crear_persona(db_session, "1799000803")
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
    persona = _crear_persona(db_session, "1799000804")
    tipo = _crear_tipo_membresia(db_session)

    _crear_membresia(db_session, persona, tipo, EstadoMembresia.VENCIDA)
    _crear_membresia(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    _crear_membresia(db_session, persona, tipo, EstadoMembresia.ACTIVA)

    db_session.flush()  # no debe lanzar


# ---------------------------------------------------------------------------
# Invariante 3: capacidad máxima del nivel bajo concurrencia real.
# ---------------------------------------------------------------------------
@pytest.fixture()
def escenario_capacidad(motor_test):
    """Nivel con UN solo cupo + dos personas, commiteados de verdad (dos
    conexiones distintas deben poder verlos a la vez)."""
    sesion = Session(bind=motor_test)
    nivel = NivelRanking(
        numero_nivel=903, nombre="Capacidad concurrente", capacidad_maxima=1,
    )
    persona_1 = Persona(
        nombres="Cupo", apellidos="Uno", cedula="1799000903",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000903",
    )
    persona_2 = Persona(
        nombres="Cupo", apellidos="Dos", cedula="1799000904",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000904",
    )
    sesion.add_all([nivel, persona_1, persona_2])
    sesion.commit()
    ids = (nivel.id, persona_1.id, persona_2.id)
    sesion.close()

    try:
        yield ids
    finally:
        limpieza = Session(bind=motor_test)
        limpieza.query(Ranking).filter(
            Ranking.persona_id.in_([ids[1], ids[2]])
        ).delete(synchronize_session=False)
        limpieza.query(Persona).filter(
            Persona.id.in_([ids[1], ids[2]])
        ).delete(synchronize_session=False)
        limpieza.query(NivelRanking).filter(NivelRanking.id == ids[0]).delete()
        limpieza.commit()
        limpieza.close()


def _esperar_tolerante(barrera: threading.Barrier) -> None:
    """Con el lock puesto, uno de los dos hilos queda serializado ANTES de
    llegar a la barrera: el que sí llegó debe poder continuar solo cuando la
    barrera expira, y el serializado no debe reventar al encontrarla rota."""
    try:
        barrera.wait()
    except threading.BrokenBarrierError:
        pass


def test_dos_asignaciones_concurrentes_no_exceden_la_capacidad_del_nivel(
    motor_test, escenario_capacidad
):
    """Dos personas compiten por el ÚNICO cupo del nivel. Sin serialización,
    las dos cuentan la misma ocupación (0), las dos pasan el chequeo y el
    nivel queda con 2/1. Con el `FOR UPDATE` sobre la fila del nivel,
    exactamente una gana y la otra recibe el error de capacidad."""
    nivel_id, persona_1_id, persona_2_id = escenario_capacidad

    barrera = threading.Barrier(2, timeout=3)
    contar_original = ranking_repositorio.NivelRankingRepositorio.contar_personas_en_nivel
    local = threading.local()

    def contar_sincronizado(self, nivel_id_arg):
        # Solo la PRIMERA cuenta de cada hilo espera: es la que decide si hay
        # cupo. Que ambos hilos cuenten a la vez es lo que hace la carrera
        # determinística (sin el lock); con el lock, el hilo serializado ni
        # siquiera llega aquí hasta que el otro commitea.
        if not getattr(local, "ya_espero", False):
            local.ya_espero = True
            _esperar_tolerante(barrera)
        return contar_original(self, nivel_id_arg)

    resultados: list = [None, None]

    def trabajo(indice: int, persona_id: int):
        sesion = Session(bind=motor_test)
        try:
            resultados[indice] = RankingServicio(sesion).asignar_nivel(persona_id, nivel_id)
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[indice] = error
            barrera.abort()
        finally:
            sesion.close()

    ranking_repositorio.NivelRankingRepositorio.contar_personas_en_nivel = contar_sincronizado
    try:
        hilos = [
            threading.Thread(target=trabajo, args=(0, persona_1_id)),
            threading.Thread(target=trabajo, args=(1, persona_2_id)),
        ]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=30)
    finally:
        ranking_repositorio.NivelRankingRepositorio.contar_personas_en_nivel = contar_original

    errores = [r for r in resultados if isinstance(r, BaseException)]
    exitos = [r for r in resultados if isinstance(r, Ranking)]
    assert len(exitos) == 1 and len(errores) == 1, (
        f"exactamente una de las dos debía ganar el cupo: {resultados}"
    )
    assert isinstance(errores[0], OperacionInvalida)
    assert "capacidad máxima" in str(errores[0])

    sesion = Session(bind=motor_test)
    try:
        ocupacion = (
            sesion.query(Ranking).filter(Ranking.nivel_ranking_id == nivel_id).count()
        )
    finally:
        sesion.close()
    assert ocupacion == 1


# ---------------------------------------------------------------------------
# Invariante 4: siempre queda al menos un administrador activo.
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
        nombres="Admin", apellidos="Alfa", cedula="1799000905",
        fecha_nacimiento=date(1980, 1, 1), telefono="0990000905",
    )
    persona_b = Persona(
        nombres="Admin", apellidos="Beta", cedula="1799000906",
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
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "1990-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_tipo_membresia_api(client):
    return client.post(
        "/api/v1/membresias/tipos",
        json={
            "categoria": "Adultos", "franja_horaria": "18:00-19:00",
            "precio": "35.00", "modalidad": "MENSUAL",
        },
    ).json()


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
    persona = _crear_persona(db_session, "1799000807")
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
