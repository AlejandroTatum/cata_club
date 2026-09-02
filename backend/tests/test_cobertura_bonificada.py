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
from datetime import date
from decimal import Decimal

import pytest
import threading
from sqlalchemy.orm import Session

import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import (
    AsignacionDescuento, CoberturaBonificada, Descuento, HistorialEstadoMembresia, Membresia,
    Notificacion, Pago, Persona, TipoMembresia,
)
from app.infraestructura.repositorios.pago_repositorio import CoberturaBonificadaRepositorio
from app.servicios_negocio.dtos.cobertura_bonificada_schemas import CoberturaBonificadaCreateDTO
from app.servicios_negocio.dtos.membresia_pago_schemas import CorreccionPagoDTO
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
        # Issue #459: pago TRANSFERENCIA sin voucher adjunto -- sin este
        # motivo, aprobar devuelve 400 desde este fix.
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    ).json()

    descuento = _crear_descuento_api(client, porcentaje=Decimal("100.00"))
    asignar_beneficio_api(client, persona["id"], descuento["id"])

    _autenticar_como(persona["id"], ["ALUMNO"])
    cobertura = _aplicar(client, membresia["id"], meses=1).json()
    assert cobertura["fechaInicio"] == aprobado["fechaFin"]
    assert db_session.query(Pago).count() == 1  # el único Pago sigue siendo el normal


# --- 5. Idempotencia (pre-check ciego) y concurrencia real --------------------

@pytest.mark.skip(
    reason=(
        "Issue #400/08 (hallazgo del scout, DETENIDO -- no decidido acá): "
        "esta técnica de 'pre-check ciego' abre una SEGUNDA sesión (`intrusa`) "
        "que inserta directamente en `cobertura_bonificada` DESDE ADENTRO de "
        "la propia llamada a `aplicar_beneficio_bonificado`, mientras la "
        "sesión externa (`sesion_servicio`) todavía tiene abierta su "
        "transacción con el lock de `Membresia` (`obtener_por_id_con_bloqueo`, "
        "agregado en este mismo slice). El INSERT de `intrusa` referencia esa "
        "MISMA fila de `Membresia` por FK, así que Postgres exige un lock "
        "`FOR KEY SHARE` sobre ella antes de poder insertar -- lock que la "
        "transacción externa ya tiene tomado y NO puede soltar hasta que "
        "termine de ejecutar, pero no puede terminar de ejecutar hasta que "
        "`intrusa.commit()` retorne. Es un ciclo de espera real (mismo hilo "
        "de SO, dos conexiones), pero Postgres NO lo detecta como deadlock -- "
        "desde su perspectiva `sesion_servicio` no está esperando ningún "
        "lock, así que su detector de deadlocks nunca dispara. El resultado "
        "es un cuelgue indefinido de la suite completa (confirmado con "
        "`py-spy`/`faulthandler`, no una corazonada), no un fallo de aserción "
        "-- muy distinto del caso ya resuelto en este mismo archivo "
        "(`test_dos_aplicaciones_concurrentes_se_serializan_sin_perder_ni_"
        "solapar_cobertura`), que solo necesitó actualizar su assertion. "
        "Arreglarlo de verdad exige rediseñar la técnica de simulación "
        "(la 'intrusa' no puede seguir siendo una sesión anidada DENTRO del "
        "mismo call stack mientras el lock sigue tomado) o aceptar que el "
        "lock ya vuelve estructuralmente imposible la carrera que este test "
        "ejercitaba -- ninguna de las dos es una corrección mecánica, así que "
        "se marca skip en vez de reescribirla unilateralmente."
    )
)
def test_reintento_con_pre_check_ciego_no_crea_dos_coberturas_solapadas(motor_test, monkeypatch):
    """"Back to back": simula que el pre-check de una segunda petición
    idéntica corrió ANTES de que la primera terminara de commitear (network
    retry / doble click) -- exactamente la misma técnica que
    `test_beneficio_asignacion.py::test_dos_asignaciones_concurrentes_no_
    dejan_dos_activas`. La restricción de exclusión es quien de verdad lo
    evita cuando el pre-check queda ciego.

    SKIPPED (issue #400/08): ver el `reason` del marker de arriba -- esta
    técnica deadlockea contra el lock de `Membresia` que este mismo slice le
    agregó a `aplicar_beneficio_bonificado`."""
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


def test_dos_aplicaciones_concurrentes_se_serializan_sin_perder_ni_solapar_cobertura(motor_test):
    """Concurrencia REAL (no simulada), issue #400/08 (hallazgo del scout):
    dos hilos aplican el MISMO beneficio a la vez sobre la misma membresía,
    con sesiones independientes.

    Antes de este fix, `aplicar_beneficio_bonificado` era el único de los
    seis métodos que mutan `Membresia` sin `obtener_por_id_con_bloqueo` --
    dependía solo de la restricción de exclusión `ex_cobertura_bonificada_
    periodo_no_solapa` para atajar la carrera: los dos hilos leían la MISMA
    ancla sin lock, calculaban el MISMO rango, y solo uno ganaba la
    inserción (el otro recibía `IntegrityError` traducido a
    `OperacionInvalida`). Esta prueba pineaba ese resultado ("solo una
    gana").

    Con el lock de `Membresia` (mismo patrón que `corregir_pago`/
    `registrar_pago`, ver `test_correccion_pago.py::test_corregir_pago_
    concurrente_con_registrar_pago_no_pierde_ni_solapa_cobertura`), las dos
    aplicaciones se SERIALIZAN: la segunda espera el commit de la primera y
    relee `_fecha_fin_maxima_combinada` YA actualizada, así que ancla su
    propio período justo a continuación del primero -- medio-abierto, sin
    hueco, sin solape. Las DOS aplicaciones ahora tienen éxito, ninguna se
    pierde ni se rechaza espuriamente; el otorgamiento de un beneficio no
    debería fallar solo por perder una carrera de temporización."""
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

    errores = [r for r in resultados if isinstance(r, BaseException)]
    assert errores == [], f"ninguna de las dos aplicaciones debía fallar: {errores}"

    exitos = [r for r in resultados if isinstance(r, CoberturaBonificada)]
    assert len(exitos) == 2, f"esperaba que las dos aplicaciones tuvieran éxito: {resultados}"

    verificacion = Session(bind=motor_test)
    try:
        coberturas = (
            verificacion.query(CoberturaBonificada)
            .filter_by(membresia_id=membresia_id)
            .order_by(CoberturaBonificada.fecha_inicio)
            .all()
        )
        assert len(coberturas) == 2, "ninguna de las dos filas debía perderse"
        primera, segunda = coberturas
        # Medio-abierto, contigua: la segunda arranca exactamente donde
        # termina la primera -- ni hueco ni solape.
        assert primera.fecha_fin == segunda.fecha_inicio
        assert primera.fecha_inicio < primera.fecha_fin <= segunda.fecha_inicio
    finally:
        verificacion.close()

    _limpiar_grafo_orm(
        motor_test, persona_ids=[admin_id, beneficiario_id],
        membresia_id=membresia_id, tipo_id=tipo_id, descuento_id=descuento_id,
    )


# --- 5b. Issue #400/08: aplicar_beneficio_bonificado ahora comparte el ------
#         mismo lock de Membresia que sus cinco hermanos ---------------------

def test_aplicar_beneficio_concurrente_con_suspender_no_deja_estado_inconsistente(motor_test):
    """Concurrencia REAL (issue #400/08, hallazgo del scout): un hilo aplica
    el beneficio bonificado mientras otro suspende la MISMA membresía.

    Antes del lock, `_activar_membresia_con_red_de_seguridad` escribía
    `membresia.estado = ACTIVA` INCONDICIONALMENTE (ver su docstring) y
    recién commiteaba al final de `aplicar_beneficio_bonificado` (dentro de
    `CoberturaBonificadaRepositorio.crear`). Si `suspender_membresia`
    commiteaba SUSPENDIDA en el medio, esa escritura tardía de ACTIVA la
    pisaba en silencio -- un lost update: el admin ve su suspensión
    "aceptada" (200), pero la membresía vuelve a ACTIVA sin que nadie lo
    pida, ninguna de las dos transacciones se entera del cambio de la otra.

    Con el lock, las dos operaciones se serializan y solo hay dos órdenes
    posibles, ninguno inconsistente:
    - Si `aplicar` corre primero: cobertura otorgada, la membresía sigue
      ACTIVA (su propio flush no cambia nada), y `suspender` -- que corre
      después -- ve ACTIVA y tiene éxito. Final: cobertura + SUSPENDIDA.
    - Si `suspender` corre primero: la membresía queda SUSPENDIDA, y
      `aplicar` -- que corre después -- ve SUSPENDIDA y se rechaza con
      `OperacionInvalida` (mismo gate que `registrar_pago`). Final: sin
      cobertura + SUSPENDIDA.

    En AMBOS casos el estado final es SUSPENDIDA -- la aserción que este
    test existe para blindar es precisamente esa: el `estado` final nunca
    puede volver a ACTIVA por la escritura incondicional de `aplicar`."""
    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(sesion_setup, cedula_valida(764), telefono="0990000764")
    beneficiario = crear_persona_orm(sesion_setup, cedula_valida(765), telefono="0990000765")
    tipo = crear_tipo_membresia_orm(sesion_setup, precio=Decimal("35.00"))
    membresia = crear_membresia_orm(
        sesion_setup, beneficiario, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("35.00"),
    )
    descuento = Descuento(nombre="Becado Concurrencia 2", porcentaje=Decimal("100.00"), activo=True)
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

    def aplicar():
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            resultados[0] = PagoServicio(sesion).aplicar_beneficio_bonificado(
                membresia_id, CoberturaBonificadaCreateDTO(meses=1),
                persona_id_solicitante=beneficiario_id, roles_solicitante=["ALUMNO"],
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[0] = error
            sesion.rollback()
        finally:
            sesion.close()

    def suspender():
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            resultados[1] = PagoServicio(sesion).suspender_membresia(
                membresia_id, "Ausencia prolongada", actor_persona_id=admin_id,
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[1] = error
            sesion.rollback()
        finally:
            sesion.close()

    hilos = [threading.Thread(target=aplicar), threading.Thread(target=suspender)]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)

    resultado_aplicar, resultado_suspender = resultados

    # `suspender_membresia` nunca debía fallar en este escenario: su origen
    # (ACTIVA) es válido sin importar el orden -- `aplicar` jamás lo cambia
    # a otra cosa que no sea ACTIVA.
    assert isinstance(resultado_suspender, Membresia), f"suspender debía tener éxito: {resultado_suspender}"
    assert resultado_suspender.estado == EstadoMembresia.SUSPENDIDA

    # `aplicar` o tuvo éxito (corrió primero) o fue rechazado con el error
    # de dominio esperado (corrió después de la suspensión) -- nunca una
    # excepción cruda.
    if isinstance(resultado_aplicar, BaseException):
        assert isinstance(resultado_aplicar, OperacionInvalida), (
            f"tipo de error inesperado: {resultado_aplicar!r}"
        )
    else:
        assert isinstance(resultado_aplicar, CoberturaBonificada)

    verificacion = Session(bind=motor_test)
    try:
        membresia_final = verificacion.get(Membresia, membresia_id)
        # La aserción central del hallazgo: el estado final SIEMPRE es
        # SUSPENDIDA -- nunca revertido a ACTIVA por la escritura
        # incondicional de `_activar_membresia_con_red_de_seguridad`.
        assert membresia_final.estado == EstadoMembresia.SUSPENDIDA
    finally:
        verificacion.close()

    # `suspender_membresia` deja una fila de `HistorialEstadoMembresia` (FK
    # a `membresia`) -- `_limpiar_grafo_orm` no la conoce (los otros
    # escenarios de este archivo nunca suspenden), así que se borra acá
    # antes de que ese helper intente borrar la `Membresia`.
    limpieza = Session(bind=motor_test)
    try:
        limpieza.query(HistorialEstadoMembresia).filter(
            HistorialEstadoMembresia.membresia_id == membresia_id
        ).delete()
        limpieza.commit()
    finally:
        limpieza.close()

    _limpiar_grafo_orm(
        motor_test, persona_ids=[admin_id, beneficiario_id],
        membresia_id=membresia_id, tipo_id=tipo_id, descuento_id=descuento_id,
    )


def test_aplicar_beneficio_concurrente_con_corregir_pago_no_pierde_ni_solapa_cobertura(motor_test):
    """Concurrencia REAL (issue #400/08, hallazgo del scout): un hilo aplica
    el beneficio bonificado mientras otro corrige (reduce) las fechas de un
    pago YA APROBADO de la MISMA membresía -- mismo criterio que
    `test_correccion_pago.py::test_corregir_pago_concurrente_con_registrar_
    pago_no_pierde_ni_solapa_cobertura`, con `aplicar_beneficio_bonificado`
    en el rol que ahí ocupa `registrar_pago`.

    Sin el lock, `aplicar` podía leer `_fecha_fin_maxima_combinada` ANTES de
    que la corrección commiteara su reducción, anclando sobre un valor que
    la corrección iba a dejar obsoleto un instante después. Con el lock,
    las dos operaciones se serializan y solo hay dos órdenes posibles:

    - Si `corregir` corre primero: reduce el pago a 2 meses sin problema
      (nada más existe todavía), y `aplicar` -- que corre después -- ancla
      sobre el valor YA reducido: cobertura contigua, sin hueco.
    - Si `aplicar` corre primero: ancla sobre el valor VIEJO (3 meses) y
      otorga la cobertura sin problema. `corregir` -- que corre después --
      intenta reducir el pago a 2 meses, pero la envolvente de su chequeo
      de continuidad ahora toca la cobertura recién otorgada (que arrancó
      justo en el borde de 3 meses) y se rechaza con `OperacionInvalida`:
      reducir rompería la continuidad con un beneficio ya otorgado, mismo
      criterio que reducir rompiendo la continuidad con OTRO pago posterior
      (ver docstring de `corregir_pago`).

    En NINGÚN caso queda cobertura solapada ni una corrección aplicada a
    medias: `aplicar_beneficio_bonificado` siempre tiene éxito (nada en
    este escenario puede rechazarlo), y la corrección tiene éxito o se
    rechaza limpiamente según el orden real de ejecución."""
    TARIFA = Decimal("30.00")
    FECHA_INICIO = date(2027, 2, 1)
    fecha_fin_original = mps._sumar_meses(FECHA_INICIO, 3)
    fecha_fin_reducida = mps._sumar_meses(FECHA_INICIO, 2)

    sesion_setup = Session(bind=motor_test)
    admin = crear_persona_orm(sesion_setup, cedula_valida(766), telefono="0990000766")
    socio = crear_persona_orm(sesion_setup, cedula_valida(767), telefono="0990000767")
    tipo = crear_tipo_membresia_orm(sesion_setup, precio=TARIFA)
    membresia = crear_membresia_orm(
        sesion_setup, socio, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA,
    )
    pago = Pago(
        monto=TARIFA * 3,
        tarifa_mensual_aplicada=TARIFA,
        meses_comprados=3,
        monto_base=TARIFA * 3,
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=FECHA_INICIO,
        fecha_fin=fecha_fin_original,
        persona_id=socio.id,
        membresia_id=membresia.id,
    )
    sesion_setup.add(pago)
    descuento = Descuento(nombre="Becado Concurrencia 3", porcentaje=Decimal("100.00"), activo=True)
    sesion_setup.add(descuento)
    sesion_setup.flush()
    sesion_setup.add(AsignacionDescuento(
        persona_id=socio.id, descuento_id=descuento.id, asignado_por_persona_id=admin.id,
    ))
    sesion_setup.commit()
    pago_id, membresia_id = pago.id, membresia.id
    socio_id, admin_id, tipo_id, descuento_id = socio.id, admin.id, tipo.id, descuento.id
    sesion_setup.close()

    barrera = threading.Barrier(2, timeout=15)
    resultados: list = [None, None]

    def corregir():
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            resultados[0] = PagoServicio(sesion).corregir_pago(
                pago_id,
                CorreccionPagoDTO(
                    meses_comprados=2,
                    monto_base=TARIFA * 2,
                    monto=TARIFA * 2,
                    fecha_fin=fecha_fin_reducida,
                    motivo="El socio solo pagó 2 meses",
                ),
                actor_persona_id=admin_id,
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[0] = error
            sesion.rollback()
        finally:
            sesion.close()

    def aplicar():
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            resultados[1] = PagoServicio(sesion).aplicar_beneficio_bonificado(
                membresia_id, CoberturaBonificadaCreateDTO(meses=1),
                persona_id_solicitante=socio_id, roles_solicitante=["ALUMNO"],
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[1] = error
            sesion.rollback()
        finally:
            sesion.close()

    hilos = [threading.Thread(target=corregir), threading.Thread(target=aplicar)]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)

    resultado_correccion, resultado_aplicar = resultados

    # `aplicar_beneficio_bonificado` nunca debía fallar en este escenario:
    # nada en la corrección puede bloquear SU propio chequeo de solapamiento
    # sin importar el orden (ver docstring arriba).
    assert isinstance(resultado_aplicar, CoberturaBonificada), (
        f"aplicar debía tener éxito sin importar el orden: {resultado_aplicar!r}"
    )

    correccion_exitosa = not isinstance(resultado_correccion, BaseException)
    if not correccion_exitosa:
        assert isinstance(resultado_correccion, OperacionInvalida), (
            f"tipo de error inesperado: {resultado_correccion!r}"
        )

    verificacion = Session(bind=motor_test)
    try:
        pago_final = verificacion.get(Pago, pago_id)
        coberturas = (
            verificacion.query(CoberturaBonificada).filter_by(membresia_id=membresia_id).all()
        )
        assert len(coberturas) == 1, "la cobertura otorgada no debía perderse"
        cobertura = coberturas[0]

        if correccion_exitosa:
            # `corregir` corrió primero: el pago quedó en 2 meses y
            # `aplicar` ancló justo donde ese valor YA reducido termina.
            assert pago_final.fecha_fin == fecha_fin_reducida
        else:
            # `aplicar` corrió primero: el pago sigue en 3 meses (la
            # corrección se rechazó) y la cobertura ancló sobre ESE valor.
            assert pago_final.fecha_fin == fecha_fin_original

        # Invariante universal, sin importar el orden: la cobertura es
        # EXACTAMENTE contigua al pago final -- ni hueco ni solape.
        assert cobertura.fecha_inicio == pago_final.fecha_fin
        assert cobertura.fecha_fin > cobertura.fecha_inicio
    finally:
        verificacion.close()

    limpieza = Session(bind=motor_test)
    try:
        limpieza.query(Notificacion).filter(
            Notificacion.persona_id.in_([admin_id, socio_id])
        ).delete(synchronize_session=False)
        limpieza.query(CoberturaBonificada).filter(
            CoberturaBonificada.membresia_id == membresia_id
        ).delete()
        limpieza.query(mps.CorreccionPago).filter(
            mps.CorreccionPago.pago_id == pago_id
        ).delete()
        limpieza.query(Pago).filter(Pago.membresia_id == membresia_id).delete()
        limpieza.query(AsignacionDescuento).filter(
            AsignacionDescuento.persona_id.in_([admin_id, socio_id])
        ).delete(synchronize_session=False)
        limpieza.query(Descuento).filter(Descuento.id == descuento_id).delete()
        limpieza.query(Membresia).filter(Membresia.id == membresia_id).delete()
        limpieza.query(Persona).filter(Persona.id.in_([admin_id, socio_id])).delete(
            synchronize_session=False
        )
        limpieza.query(TipoMembresia).filter(TipoMembresia.id == tipo_id).delete()
        limpieza.commit()
    finally:
        limpieza.close()


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
        # Issue #459: pago TRANSFERENCIA sin voucher adjunto -- sin este
        # motivo, aprobar devuelve 400 desde este fix.
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
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
        # Issue #459: pago TRANSFERENCIA sin voucher adjunto -- sin este
        # motivo, aprobar devuelve 400 desde este fix.
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
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
