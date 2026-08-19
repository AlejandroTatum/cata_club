"""Cobertura bonificada (issue #400, slice 4d): cuando el beneficio 100%
personal vigente de una persona (`AsignacionDescuento`, issue #398) cubre el
monto base COMPLETO de un período, la persona recibe cobertura SIN que se
cree ningún `Pago` -- nunca un método/comprobante/PDF fabricados. Ver el
docstring de `CoberturaBonificada` en `app/dominio/modelos.py` y de
`PagoServicio.aplicar_beneficio_bonificado` para el razonamiento completo.

Reglas de producto bajo prueba:
- "100%" es una propiedad del PAR (asignación, meses): un descuento
  porcentual del 100% siempre alcanza; uno de monto fijo solo si iguala
  exactamente `tarifa * meses`. Cualquier otro resultado se rechaza -- ese
  pago sigue el camino normal de `registrar_pago`.
- Autoservicio: dueño o representante, NUNCA un admin "por" ellos (a
  diferencia de `registrar_pago`).
- Gratuidad familiar y este beneficio son mutuamente excluyentes.
- Activa la membresía, igual que un pago aprobado.
- Sin `Pago`, sin PDF, invisible para `reconciliar_comprobantes_faltantes`
  (consulta solo `Pago`, ver su propio código).
- Solapamiento: pre-check contra `Pago` Y `cobertura_bonificada`, respaldado
  por la restricción de exclusión de la base (issue #8, mismo criterio que
  el resto del módulo) -- probada de verdad en
  `test_migracion_cobertura_bonificada.py` (archivo separado, mismo criterio
  que `test_migracion_asignacion_descuento.py` vs. `test_beneficio_
  asignacion.py`: la migración tiene su propio arnés).

TDD: este archivo se escribió ANTES de `PagoServicio.aplicar_beneficio_
bonificado`/el router/el modelo -- la corrida RED fueron errores de
colección (imports inexistentes). La migración y el modelo se ejercitaron
primero por separado (riesgo estructural: la restricción de exclusión), y
este archivo confirmó GREEN una vez armados el servicio y el router.
"""
from decimal import Decimal

import pytest
import threading
from sqlalchemy.orm import Session

import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import (
    AsignacionDescuento, CoberturaBonificada, Descuento, Membresia, Notificacion, Pago, Persona,
    TipoMembresia,
)
from app.infraestructura.repositorios.pago_repositorio import CoberturaBonificadaRepositorio
from app.presentacion.schemas.cobertura_bonificada_schemas import CoberturaBonificadaCreateDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm,
    asignar_beneficio_api, crear_membresia_api, crear_persona_api,
    crear_tipo_membresia_api, registrar_pago_api,
)

RUTA_APLICAR = "/api/v1/membresias/{membresia_id}/aplicar-beneficio"


# --- Helpers locales ----------------------------------------------------------

def _crear_descuento_api(client, *, porcentaje=None, monto=None, nombre="Becado"):
    payload = {"nombre": nombre, "activo": True}
    if porcentaje is not None:
        payload["porcentaje"] = str(porcentaje)
    else:
        payload["monto"] = str(monto)
    resp = client.post("/api/v1/descuentos/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _aplicar(client, membresia_id: int, meses: int = 1):
    return client.post(RUTA_APLICAR.format(membresia_id=membresia_id), json={"meses": meses})


def _autenticar_como(persona_id, roles):
    """Sobrescribe el token del cliente de test (mismo truco que
    `test_ownership_pagos.py`)."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _autenticar_como_admin():
    _autenticar_como(1, ["ADMINISTRADOR", "ENTRENADOR"])


def _limpiar_grafo_orm(motor_test, *, persona_ids, membresia_id, tipo_id, descuento_id):
    """Borra, en orden de FK, el grafo que las pruebas de concurrencia crean
    con `motor_test` directo (commits REALES, no transaccionales -- a
    diferencia de `db_session`, nada se revierte solo). Sin esto, las filas
    quedan pisando ids bajos que la siguiente prueba `db_session` vuelve a
    pedir tras `ALTER SEQUENCE ... RESTART WITH 1` (ver docstring de
    `_reiniciar_secuencias` en `conftest.py`), y colisionan con `persona_pkey`.
    Mismo criterio que `test_pago_comprobante_atomico.py::escenario_pago_
    concurrente`."""
    limpieza = Session(bind=motor_test)
    try:
        limpieza.query(Notificacion).filter(
            Notificacion.persona_id.in_(persona_ids)
        ).delete(synchronize_session=False)
        limpieza.query(CoberturaBonificada).filter(
            CoberturaBonificada.membresia_id == membresia_id
        ).delete()
        limpieza.query(AsignacionDescuento).filter(
            AsignacionDescuento.persona_id.in_(persona_ids)
        ).delete(synchronize_session=False)
        limpieza.query(Descuento).filter(Descuento.id == descuento_id).delete()
        limpieza.query(Membresia).filter(Membresia.id == membresia_id).delete()
        limpieza.query(Persona).filter(Persona.id.in_(persona_ids)).delete(
            synchronize_session=False
        )
        limpieza.query(TipoMembresia).filter(TipoMembresia.id == tipo_id).delete()
        limpieza.commit()
    finally:
        limpieza.close()


def _escenario_con_beneficio_total(client, *, porcentaje=None, monto=None):
    """Persona (dueña) + tipo (35.00/mes) + membresía + beneficio 100%
    vigente, todo vía API con el `client` admin por defecto. Devuelve
    (persona, membresia, descuento). El caller decide con qué rol
    autenticarse antes de aplicar el beneficio."""
    persona = crear_persona_api(client)  # id=1 (admin default también es 1 en conftest)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    descuento = _crear_descuento_api(client, porcentaje=porcentaje, monto=monto)
    asignar_beneficio_api(client, persona["id"], descuento["id"])
    return persona, membresia, descuento


# --- 1. Regresión: pagos normales siguen funcionando -------------------------

def test_pago_transferencia_no_se_ve_afectado(client):
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    resp = registrar_pago_api(client, persona["id"], membresia["id"], tipo_pago="TRANSFERENCIA")
    assert resp.status_code == 201, resp.text
    assert resp.json()["estadoPago"] == "PENDIENTE_VALIDACION"


def test_pago_efectivo_no_se_ve_afectado(client):
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = registrar_pago_api(client, persona["id"], membresia["id"], tipo_pago="EFECTIVO")
    assert resp.status_code == 201, resp.text
    assert resp.json()["tipoPago"] == "EFECTIVO"


# --- 2. Beneficio 100%: crea cobertura, nunca un Pago -------------------------

def test_beneficio_100_porcentual_crea_cobertura_activa_membresia_y_no_crea_pago(
    client, db_session,
):
    persona, membresia, descuento = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = _aplicar(client, membresia["id"], meses=2)
    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["membresiaId"] == membresia["id"]
    assert cuerpo["personaId"] == persona["id"]
    assert cuerpo["mesesComprados"] == 2
    assert cuerpo["tarifaMensualAplicada"] == "35.00"
    assert cuerpo["asignacionDescuento"]["descuento"]["id"] == descuento["id"]
    assert cuerpo["otorgadaPorPersonaId"] == persona["id"]

    # No se creó ningún Pago (issue #400: nada fabricado).
    assert db_session.query(Pago).count() == 0
    assert db_session.query(CoberturaBonificada).count() == 1

    _autenticar_como_admin()
    estado = client.get(f"/api/v1/membresias/{membresia['id']}").json()["estado"]
    assert estado == "ACTIVA"


def test_beneficio_100_monto_fijo_igual_a_la_base_tambien_funciona(client, db_session):
    # tarifa 35.00 * 1 mes = base 35.00: el monto fijo debe ser EXACTAMENTE eso.
    persona, membresia, _ = _escenario_con_beneficio_total(client, monto=Decimal("35.00"))

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = _aplicar(client, membresia["id"], meses=1)
    assert resp.status_code == 201, resp.text
    assert db_session.query(CoberturaBonificada).count() == 1


def test_beneficio_parcial_es_rechazado_con_mensaje_claro(client):
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("50.00"))

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = _aplicar(client, membresia["id"], meses=1)
    assert resp.status_code == 400, resp.text
    assert "100%" in resp.json()["detail"]
    assert "pago normal" in resp.json()["detail"].lower()


def test_beneficio_monto_fijo_que_no_iguala_la_base_es_rechazado(client):
    # base = 35.00, monto fijo = 20.00: NO es 100% de este período concreto.
    persona, membresia, _ = _escenario_con_beneficio_total(client, monto=Decimal("20.00"))

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = _aplicar(client, membresia["id"], meses=1)
    assert resp.status_code == 400, resp.text
    assert "100%" in resp.json()["detail"]


# --- 3. Estructuralmente invisible para PDF y reconciliación ------------------

def test_beneficio_100_no_dispara_generacion_de_pdf(client, monkeypatch):
    llamadas: list[int] = []
    monkeypatch.setattr(
        mps.PagoServicio, "_disparar_generacion_comprobante_pdf",
        lambda self, pago_id: llamadas.append(pago_id),
    )
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = _aplicar(client, membresia["id"], meses=1)
    assert resp.status_code == 201, resp.text
    assert llamadas == []


# --- 4. Período: ancla sobre AMBAS tablas -------------------------------------

def test_segunda_aplicacion_ancla_sobre_la_cobertura_bonificada_previa(client):
    """Renovación: la SEGUNDA aplicación debe empezar exactamente donde
    terminó la primera -- sin esto, `hoy_club()` por defecto pisaría el
    período ya otorgado (que `Pago.fecha_fin_maxima_aprobada` no ve, porque
    no hay ningún Pago)."""
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))
    _autenticar_como(persona["id"], ["ALUMNO"])

    r1 = _aplicar(client, membresia["id"], meses=1)
    r2 = _aplicar(client, membresia["id"], meses=1)
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 201, r2.text
    primera, segunda = r1.json(), r2.json()

    assert segunda["fechaInicio"] == primera["fechaFin"]


def test_aplicacion_ancla_sobre_el_ultimo_pago_aprobado(client, db_session):
    """La otra dirección del mismo ancla: si el titular YA tiene un pago
    normal aprobado, el beneficio no debe pisar esa cobertura -- debe
    arrancar donde terminó el pago, no en `hoy_club()`."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    pago = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="TRANSFERENCIA",
    ).json()
    _autenticar_como_admin()
    aprobado = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"},
    ).json()

    descuento = _crear_descuento_api(client, porcentaje=Decimal("100.00"))
    asignar_beneficio_api(client, persona["id"], descuento["id"])

    _autenticar_como(persona["id"], ["ALUMNO"])
    cobertura = _aplicar(client, membresia["id"], meses=1).json()
    assert cobertura["fechaInicio"] == aprobado["fechaFin"]
    assert db_session.query(Pago).count() == 1  # el único Pago sigue siendo el normal


# --- 5. Idempotencia (pre-check ciego) y concurrencia real --------------------

def test_reintento_con_pre_check_ciego_no_crea_dos_coberturas_solapadas(motor_test, monkeypatch):
    """"Back to back": simula que el pre-check de una segunda petición
    idéntica corrió ANTES de que la primera terminara de commitear (network
    retry / doble click) -- exactamente la misma técnica que
    `test_beneficio_asignacion.py::test_dos_asignaciones_concurrentes_no_
    dejan_dos_activas`. La restricción de exclusión es quien de verdad lo
    evita cuando el pre-check queda ciego."""
    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(sesion_setup, cedula_valida(760), telefono="0990000760")
    beneficiario = crear_persona_orm(sesion_setup, cedula_valida(761), telefono="0990000761")
    tipo = crear_tipo_membresia_orm(sesion_setup, precio=Decimal("35.00"))
    membresia = crear_membresia_orm(
        sesion_setup, beneficiario, tipo, EstadoMembresia.INACTIVA, monto_aplicado=Decimal("35.00"),
    )
    descuento = Descuento(nombre="Becado Retry", porcentaje=Decimal("100.00"), activo=True)
    sesion_setup.add(descuento)
    sesion_setup.flush()
    asignacion = AsignacionDescuento(
        persona_id=beneficiario.id, descuento_id=descuento.id, asignado_por_persona_id=admin.id,
    )
    sesion_setup.add(asignacion)
    sesion_setup.commit()
    membresia_id, beneficiario_id, asignacion_id = membresia.id, beneficiario.id, asignacion.id
    admin_id, tipo_id, descuento_id = admin.id, tipo.id, descuento.id
    sesion_setup.close()

    def _pre_check_que_no_ve_la_carrera(self, membresia_id_arg, fecha_inicio, fecha_fin):
        intrusa = Session(bind=motor_test)
        try:
            intrusa.add(CoberturaBonificada(
                membresia_id=membresia_id_arg, persona_id=beneficiario_id,
                asignacion_descuento_id=asignacion_id,
                tarifa_mensual_aplicada=Decimal("35.00"), meses_comprados=1,
                descuento_valor_aplicado=Decimal("35.00"),
                descuento_porcentaje_aplicado=Decimal("100.00"),
                fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
                otorgada_por_persona_id=beneficiario_id,
            ))
            intrusa.commit()
        finally:
            intrusa.close()
        return False  # simula: el pre-check corrió ANTES de que exista la fila

    monkeypatch.setattr(
        CoberturaBonificadaRepositorio, "existe_en_rango", _pre_check_que_no_ve_la_carrera,
    )

    sesion_servicio = Session(bind=motor_test)
    try:
        servicio = PagoServicio(sesion_servicio)
        with pytest.raises(OperacionInvalida, match="cobertura"):
            servicio.aplicar_beneficio_bonificado(
                membresia_id, CoberturaBonificadaCreateDTO(meses=1),
                persona_id_solicitante=beneficiario_id, roles_solicitante=["ALUMNO"],
            )
    finally:
        sesion_servicio.rollback()
        sesion_servicio.close()

    limpieza = Session(bind=motor_test)
    try:
        assert limpieza.query(CoberturaBonificada).filter(
            CoberturaBonificada.membresia_id == membresia_id
        ).count() == 1  # solo la de la "intrusa"
    finally:
        limpieza.close()
    _limpiar_grafo_orm(
        motor_test, persona_ids=[admin_id, beneficiario_id],
        membresia_id=membresia_id, tipo_id=tipo_id, descuento_id=descuento_id,
    )


def test_dos_aplicaciones_concurrentes_para_periodos_solapados_solo_una_gana(motor_test):
    """Concurrencia REAL (no simulada): dos hilos aplican el MISMO beneficio
    a la vez sobre la misma membresía, con sesiones independientes -- mismo
    patrón que `test_pago_comprobante_atomico.py::test_dos_aprobaciones_
    concurrentes_solo_una_gana`. Exactamente uno gana; el otro recibe
    `OperacionInvalida`, nunca una excepción cruda."""
    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(sesion_setup, cedula_valida(762), telefono="0990000762")
    beneficiario = crear_persona_orm(sesion_setup, cedula_valida(763), telefono="0990000763")
    tipo = crear_tipo_membresia_orm(sesion_setup, precio=Decimal("35.00"))
    membresia = crear_membresia_orm(
        sesion_setup, beneficiario, tipo, EstadoMembresia.INACTIVA, monto_aplicado=Decimal("35.00"),
    )
    descuento = Descuento(nombre="Becado Concurrencia", porcentaje=Decimal("100.00"), activo=True)
    sesion_setup.add(descuento)
    sesion_setup.flush()
    sesion_setup.add(AsignacionDescuento(
        persona_id=beneficiario.id, descuento_id=descuento.id, asignado_por_persona_id=admin.id,
    ))
    sesion_setup.commit()
    membresia_id, beneficiario_id = membresia.id, beneficiario.id
    admin_id, tipo_id, descuento_id = admin.id, tipo.id, descuento.id
    sesion_setup.close()

    barrera = threading.Barrier(2, timeout=15)
    resultados: list = [None, None]

    def aplicar(indice: int):
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            resultados[indice] = PagoServicio(sesion).aplicar_beneficio_bonificado(
                membresia_id, CoberturaBonificadaCreateDTO(meses=1),
                persona_id_solicitante=beneficiario_id, roles_solicitante=["ALUMNO"],
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[indice] = error
            sesion.rollback()
        finally:
            sesion.close()

    hilos = [threading.Thread(target=aplicar, args=(i,)) for i in (0, 1)]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)

    exitos = [r for r in resultados if isinstance(r, CoberturaBonificada)]
    rechazos = [r for r in resultados if isinstance(r, OperacionInvalida)]
    assert len(exitos) == 1, f"esperaba exactamente un ganador: {resultados}"
    assert len(rechazos) == 1, f"esperaba exactamente un perdedor con error de dominio: {resultados}"

    _limpiar_grafo_orm(
        motor_test, persona_ids=[admin_id, beneficiario_id],
        membresia_id=membresia_id, tipo_id=tipo_id, descuento_id=descuento_id,
    )


# --- 6. Autorización: dueño/representante sí, extraño/otro rol no ------------

def test_titular_aplica_su_propio_beneficio(client):
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))
    _autenticar_como(persona["id"], ["ALUMNO"])
    assert _aplicar(client, membresia["id"]).status_code == 201


def test_representante_aplica_el_beneficio_de_su_representado(client):
    representante = crear_persona_api(client, cedula=cedula_valida(470))  # id=1
    hijo = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": cedula_valida(471),
            "fecha_nacimiento": "2015-05-14", "telefono": "0990000471",
            "representante_id": representante["id"],
        },
    ).json()
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, hijo["id"], tipo["id"])
    descuento = _crear_descuento_api(client, porcentaje=Decimal("100.00"))
    asignar_beneficio_api(client, hijo["id"], descuento["id"])

    _autenticar_como(representante["id"], ["REPRESENTANTE"])
    resp = _aplicar(client, membresia["id"])
    assert resp.status_code == 201, resp.text
    assert resp.json()["personaId"] == hijo["id"]
    assert resp.json()["otorgadaPorPersonaId"] == representante["id"]


def test_extrano_no_puede_aplicar_beneficio_ajeno(client):
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))
    extrano = crear_persona_api(client, cedula=cedula_valida(480))

    _autenticar_como(extrano["id"], ["ALUMNO"])
    resp = _aplicar(client, membresia["id"])
    assert resp.status_code == 403, resp.text


def test_administrador_no_puede_aplicar_beneficio_por_el_titular(client):
    """A diferencia de `registrar_pago`, acá un ADMINISTRADOR no es dueño ni
    representante y por lo tanto tampoco puede ejecutar la acción -- el
    admin ya ejerció su parte al conceder la `AsignacionDescuento`; aplicarla
    es autoservicio del pagador (ver docstring del método)."""
    crear_persona_api(client, cedula=cedula_valida(490))  # relleno -> id=1 (el admin)
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))

    _autenticar_como_admin()  # persona_id=1, distinto del titular (persona_id=2)
    resp = _aplicar(client, membresia["id"])
    assert resp.status_code == 403, resp.text


# --- 7. Gratuidad familiar: mutuamente excluyente -----------------------------

def test_gratuidad_familiar_rechaza_aplicar_beneficio(client, db_session):
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))
    membresia_orm = db_session.get(Membresia, membresia["id"])
    membresia_orm.es_gratuidad_familiar = True
    db_session.commit()

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = _aplicar(client, membresia["id"])
    assert resp.status_code == 400, resp.text
    assert "gratuita" in resp.json()["detail"].lower()


# --- 8. Solapamiento simétrico entre Pago y CoberturaBonificada (hallazgo ----
# del revisor, reproducido en vivo contra Postgres real): `registrar_pago` y
# `regularizar_deuda` anclaban/chequeaban SOLO contra `Pago`, así que un pago
# normal podía registrarse (y aprobarse) encima de un período que un
# beneficio bonificado ya cubría. Ver `PagoServicio._fecha_fin_maxima_
# combinada`/`_hay_cobertura_en_rango`.

def test_pago_normal_ancla_despues_de_cobertura_bonificada_existente(client, db_session):
    """`registrar_pago` nunca deja elegir fecha (issue #400/PAG-5): el
    período SIEMPRE se deriva. La prueba de que ya no se solapa es que el
    pago nuevo arranca EXACTO donde terminó la cobertura bonificada, nunca
    dentro de ese rango -- antes del fix arrancaba en `hoy_club()`, que caía
    DENTRO del período ya otorgado."""
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))
    _autenticar_como(persona["id"], ["ALUMNO"])
    cobertura = _aplicar(client, membresia["id"], meses=3).json()

    resp = registrar_pago_api(client, persona["id"], membresia["id"], tipo_pago="TRANSFERENCIA")
    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["fechaInicio"] == cobertura["fechaFin"]

    _autenticar_como_admin()
    aprobado = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"},
    )
    assert aprobado.status_code == 200, aprobado.text
    # Confirmado también contra la fila real (no solo la respuesta HTTP):
    # el pago aprobado arranca justo donde terminó la cobertura, nunca antes.
    pago_orm = db_session.get(Pago, pago["id"])
    assert pago_orm.fecha_inicio.isoformat() == cobertura["fechaFin"]


def test_regularizar_deuda_no_puede_backdatear_sobre_cobertura_bonificada(client):
    """`regularizar_deuda` SÍ recibe fechas explícitas del admin (a
    diferencia de `registrar_pago`) -- acá el chequeo debe rechazar
    explícitamente, no solo "anclar mejor"."""
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))
    _autenticar_como(persona["id"], ["ALUMNO"])
    cobertura = _aplicar(client, membresia["id"], meses=1).json()

    _autenticar_como_admin()
    resp = client.post(
        f"/api/v1/membresias/{membresia['id']}/regularizar-deuda",
        json={
            "monto": "35.00",
            "fecha_inicio": cobertura["fechaInicio"],
            "fecha_fin": cobertura["fechaFin"],
            "motivo": "intento de backdate sobre cobertura bonificada",
        },
    )
    assert resp.status_code == 400, resp.text
    assert "cubierto" in resp.json()["detail"].lower()


def test_aplicar_beneficio_rechaza_solapar_pago_aprobado_aunque_el_ancla_falle(
    client, db_session, monkeypatch,
):
    """Confirma la dirección inversa (ya presente, pero sin prueba directa
    de que es un CHEQUEO y no solo un efecto lateral del ancla): se fuerza
    `_fecha_fin_maxima_combinada` a devolver `None` (simulando un ancla
    ciega a la cobertura real) para que el período candidato SÍ caiga
    encima de un pago ya aprobado, y se confirma que el pre-check explícito
    -- no la casualidad del ancla -- es quien lo rechaza."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    pago = registrar_pago_api(client, persona["id"], membresia["id"], tipo_pago="TRANSFERENCIA").json()
    client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar", json={"estado_pago": "APROBADO"},
    )

    descuento = _crear_descuento_api(client, porcentaje=Decimal("100.00"))
    asignar_beneficio_api(client, persona["id"], descuento["id"])

    monkeypatch.setattr(mps.PagoServicio, "_fecha_fin_maxima_combinada", lambda self, mid: None)

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = _aplicar(client, membresia["id"], meses=1)
    assert resp.status_code == 400, resp.text
    assert db_session.query(CoberturaBonificada).count() == 0


# --- 9. El catálogo se puede editar; lo ya otorgado NO cambia -----------------

def test_editar_el_descuento_del_catalogo_no_cambia_una_cobertura_ya_otorgada(client, db_session):
    """Hallazgo del revisor: `CoberturaBonificada` congela `descuento_valor_
    aplicado`/`_porcentaje_aplicado` al otorgar (mismo criterio que `Pago`).
    Editar el `Descuento` del catálogo DESPUÉS no debe reescribir lo que ya
    se otorgó -- se relee la fila de la base (no el objeto en memoria) para
    probar que el freeze es real, no un artefacto de la respuesta original."""
    persona, membresia, descuento = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))
    _autenticar_como(persona["id"], ["ALUMNO"])
    otorgada = _aplicar(client, membresia["id"]).json()
    assert otorgada["descuentoPorcentajeAplicado"] == "100.00"
    assert otorgada["descuentoValorAplicado"] == "35.00"

    _autenticar_como_admin()
    resp_edicion = client.patch(
        f"/api/v1/descuentos/{descuento['id']}", json={"porcentaje": "50.00"},
    )
    assert resp_edicion.status_code == 200, resp_edicion.text
    assert resp_edicion.json()["porcentaje"] == "50.00"  # el catálogo SÍ cambió

    cobertura_releida = db_session.get(CoberturaBonificada, otorgada["id"])
    releida_dto = PagoServicio(db_session).cobertura_bonificada_a_response_dto(cobertura_releida)
    assert str(releida_dto.descuento_porcentaje_aplicado) == "100.00"  # el grant NO cambió
    assert str(releida_dto.descuento_valor_aplicado) == "35.00"
    # El catálogo anidado SÍ refleja el valor vigente (es un lookup en vivo,
    # a propósito -- ver docstring de `cobertura_bonificada_a_response_dto`).
    assert str(releida_dto.asignacion_descuento.descuento.porcentaje) == "50.00"
