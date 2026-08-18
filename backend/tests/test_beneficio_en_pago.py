"""
Beneficio personal aplicado automáticamente al pago (issue #398/#400, slice
3c): el punto donde `BeneficioServicio` (asignación, ya cubierta por
`test_beneficio_asignacion.py`) y `PagoServicio` (registro de pago) se
cruzan.

`PagoCreateDTO` ya no tiene ningún campo de descuento -- `PagoServicio.
registrar_pago` resuelve la `AsignacionDescuento` VIGENTE del PAGADOR
(`datos.persona_id`, no de quien hace el request) server-side, vía
`_congelar_beneficio_activo`, y congela su valor en las columnas
`descuento_*` de `Pago`. La mecánica del congelamiento en sí (valor
histórico, catálogo posterior no reescribe, CHECK de la base) no cambió y
sigue probada en `test_descuentos.py`, adaptada al nuevo contrato -- lo que
sigue acá es lo GENUINAMENTE nuevo de resolverlo server-side:

- La aplicación es 100 % automática: el cliente no envía nada.
- Sin beneficio vigente, no hay descuento.
- Enviar `descuento_ids` de todos modos NO puede ni agregar ni sustituir el
  beneficio vigente (issue #398, "seguridad e invariantes": "el backend
  ignora o rechaza cualquier intento del cliente de sustituir la asignación
  vigente").
- `descuento_autorizado_por_persona_id` es el ADMIN QUE ASIGNÓ el beneficio,
  nunca quien registra el pago -- antes coincidían siempre por construcción
  (solo un admin podía elegir el descuento Y registrar el pago); acá se
  ejercita el caso donde NO coinciden (un alumno adulto se autoservicia un
  pago con un beneficio que otro admin le concedió).
- Retirar el beneficio: pagos ya registrados quedan intactos, el próximo
  pago sale sin descuento.
- Un beneficio porcentual y uno de monto fijo funcionan igual, en `Decimal`,
  y el tope del 100 % sigue de pie.
"""
from decimal import Decimal

from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import Pago
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_pagos import (
    asignar_beneficio_api,
    crear_membresia_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
    escenario_membresia_sin_pago_api,
    registrar_pago_api,
    retirar_beneficio_api,
)

RUTA_DESCUENTOS = "/api/v1/descuentos/"


def _crear_descuento_api(client, nombre="Beca", *, porcentaje=None, monto=None):
    """POST /descuentos ya aprobado (`.json()`): estos tests solo necesitan
    el catálogo sembrado, nunca asertar sus códigos de error (eso ya lo
    cubre `test_descuentos.py`)."""
    payload = {"nombre": nombre, "activo": True}
    if porcentaje is not None:
        payload["porcentaje"] = porcentaje
    if monto is not None:
        payload["monto"] = monto
    respuesta = client.post(RUTA_DESCUENTOS, json=payload)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def _autenticar_como(persona_id, roles):
    """Sobrescribe el token del cliente de test para simular a OTRA persona
    autenticada (mismo truco que `_autenticar_como` en
    `test_efectivo_solo_por_socio.py`/`test_ownership_pagos.py`): necesario
    acá porque `client` del conftest siempre autentica como persona_id=1, y
    distinguir "quien asignó" de "quien paga" exige dos personas distintas
    de verdad."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


# --- 1. Aplicación automática: con y sin beneficio vigente -------------------

def test_pago_de_persona_con_beneficio_activo_congela_descuento_automaticamente(client, db_session):
    """El cliente no envía NADA sobre descuentos -- ni el campo existe ya en
    `PagoCreateDTO`. El backend resuelve solo la asignación vigente de
    `persona_id` y congela su valor, igual que si el admin la hubiera
    elegido a mano (comportamiento viejo, issue #11)."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = _crear_descuento_api(client, "Media beca", porcentaje="50")
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 201, respuesta.text
    pago = respuesta.json()
    assert pago["descuentoId"] == descuento["id"]
    assert Decimal(str(pago["monto"])) == Decimal("17.50")

    fila = db_session.get(Pago, pago["id"])
    assert fila.descuento_valor_aplicado == Decimal("17.50")


def test_pago_de_persona_sin_beneficio_no_congela_descuento(client):
    """El contrario del anterior: sin ninguna `AsignacionDescuento` vigente
    para la persona, el pago se registra íntegro, sin ningún campo
    `descuento_*` poblado."""
    persona, membresia = escenario_membresia_sin_pago_api(client)

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 201, respuesta.text
    pago = respuesta.json()
    assert pago["descuentoId"] is None
    assert Decimal(str(pago["monto"])) == Decimal("35.00")


# --- 2. Manipulación de payload: `descuento_ids` no sustituye el beneficio ---

def test_enviar_descuento_ids_no_sustituye_el_beneficio_vigente(client, db_session):
    """Caso de manipulación de payload que exigen los criterios de
    aceptación de #398: la persona tiene un beneficio A vigente (50 %) y el
    cliente manda en el POST un `descuento_ids` apuntando a OTRO descuento B
    del catálogo, intentando forzarlo. El campo no existe en el contrato: se
    ignora, y el pago congela A -- nunca B."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    beneficio_a = _crear_descuento_api(client, "Beneficio concedido", porcentaje="50")
    otro_b = _crear_descuento_api(client, "Otro descuento del catálogo", porcentaje="30")
    asignacion = asignar_beneficio_api(client, persona["id"], beneficio_a["id"])
    assert asignacion.status_code == 201, asignacion.text

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[otro_b["id"]],
    )
    assert respuesta.status_code == 201, respuesta.text
    pago = respuesta.json()
    assert pago["descuentoId"] == beneficio_a["id"]
    assert Decimal(str(pago["monto"])) == Decimal("17.50")


def test_enviar_descuento_ids_sin_beneficio_asignado_no_concede_ninguno(client):
    """La otra mitad del caso de manipulación: sin ningún beneficio vigente,
    mandar `descuento_ids` tampoco le concede uno -- "un usuario nunca puede
    enviar un descuento_id para concedérselo" (issue #398, "seguridad e
    invariantes")."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    ajeno = _crear_descuento_api(client, "Descuento ajeno", porcentaje="80")

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[ajeno["id"]],
    )
    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["descuentoId"] is None


# --- 3. Autor congelado: el admin que ASIGNÓ, nunca quien PAGA ---------------

def test_autor_congelado_es_el_admin_que_asigno_no_el_pagador(client, db_session):
    """El caso subyacente al fix (issue #398/#400, "LA SUBTIL" del slice):
    hasta ahora `descuento_autorizado_por_persona_id` coincidía siempre con
    quien registraba el pago porque solo un admin podía elegir el descuento
    Y registrar el pago en el mismo acto -- ningún test existente podía
    distinguir los dos valores.

    Acá el ADMIN (persona id=1, el mismo que autentica `client`) asigna el
    beneficio, y luego es el propio BENEFICIARIO (persona adulta, id=2)
    quien se autoservicia su pago. La columna debe seguir nombrando a quien
    CONCEDIÓ el beneficio, no a quien apretó pagar."""
    admin = crear_persona_orm(db_session, "1710034065")  # id=1: el token de `client`
    beneficiario = crear_persona_orm(
        db_session, "1710034073", nombres="Beneficiario", apellidos="Autoservicio",
        telefono="0990002222",
    )  # id=2, adulto por default (fecha_nacimiento=1990-01-01)
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, beneficiario, tipo, EstadoMembresia.INACTIVA)
    db_session.commit()

    descuento = _crear_descuento_api(client, "Beca concedida", porcentaje="50")
    asignacion = asignar_beneficio_api(client, beneficiario.id, descuento["id"])
    assert asignacion.status_code == 201, asignacion.text
    assert asignacion.json()["asignadoPorPersonaId"] == admin.id

    _autenticar_como(beneficiario.id, ["ALUMNO"])
    # `crear_tipo_membresia_orm` siembra precio $30.00 (no $35.00, el
    # default de `registrar_pago_api` pensado para el catálogo vía API) --
    # pero `meses=1` (el default) alcanza igual: es la cantidad, no el
    # precio, la que este factory recibe desde issue #400/4b.
    respuesta = registrar_pago_api(client, beneficiario.id, membresia.id)
    assert respuesta.status_code == 201, respuesta.text
    pago = respuesta.json()

    fila = db_session.get(Pago, pago["id"])
    assert fila.descuento_id == descuento["id"]
    assert fila.descuento_autorizado_por_persona_id == admin.id
    assert fila.descuento_autorizado_por_persona_id != beneficiario.id


# --- 4. Retiro: pagos históricos intactos, el PRÓXIMO pago sin descuento -----

def test_retirar_beneficio_no_altera_pagos_ya_registrados(client, db_session):
    """Issue #398: "retirar el beneficio afecta únicamente pagos futuros;
    los pagos anteriores conservan su copia congelada". Se registra el pago
    con el beneficio vigente y RECIÉN DESPUÉS se retira: las columnas
    congeladas de ese pago no se mueven un centavo."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = _crear_descuento_api(client, "Media beca", porcentaje="50")
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text

    pago = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    assert Decimal(str(pago["monto"])) == Decimal("17.50")

    retiro = retirar_beneficio_api(client, persona["id"])
    assert retiro.status_code == 200, retiro.text

    fila = db_session.get(Pago, pago["id"])
    assert fila.descuento_id == descuento["id"]
    assert fila.descuento_valor_aplicado == Decimal("17.50")
    assert fila.descuento_porcentaje_aplicado == Decimal("50")
    assert fila.monto == Decimal("17.50")


def test_retirar_beneficio_deja_sin_descuento_el_proximo_pago(client):
    """La otra mitad del mismo invariante: "el siguiente pago queda sin
    descuento"."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = _crear_descuento_api(client, "Media beca", porcentaje="50")
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text

    primero = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    # Una membresía admite UN solo pago PENDIENTE a la vez
    # (`existe_pendiente_para_membresia`): hay que aprobar el primero antes
    # de poder registrar el segundo sobre la misma membresía.
    aprobacion = client.patch(
        f"/api/v1/membresias/pagos/{primero['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert aprobacion.status_code == 200, aprobacion.text

    retiro = retirar_beneficio_api(client, persona["id"])
    assert retiro.status_code == 200, retiro.text

    segundo = registrar_pago_api(client, persona["id"], membresia["id"])
    assert segundo.status_code == 201, segundo.text
    assert segundo.json()["descuentoId"] is None


# --- 5. Porcentual y monto fijo funcionan igual -------------------------------

def test_beneficio_porcentual_funciona_end_to_end(client, db_session):
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = _crear_descuento_api(client, "Porcentual", porcentaje="20")
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text

    pago = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    assert Decimal(str(pago["monto"])) == Decimal("28.00")

    fila = db_session.get(Pago, pago["id"])
    assert fila.descuento_porcentaje_aplicado == Decimal("20")
    assert fila.descuento_valor_aplicado == Decimal("7.00")


def test_beneficio_de_monto_fijo_funciona_end_to_end(client, db_session):
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = _crear_descuento_api(client, "Monto fijo", monto="15.00")
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text

    pago = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    assert Decimal(str(pago["monto"])) == Decimal("20.00")

    fila = db_session.get(Pago, pago["id"])
    assert fila.descuento_porcentaje_aplicado is None
    assert fila.descuento_valor_aplicado == Decimal("15.00")


# --- 6. Decimal, nunca float; el tope del 100 % sigue de pie -----------------

def test_valores_congelados_son_decimal_no_float(client, db_session):
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = _crear_descuento_api(client, "Media beca", porcentaje="50")
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text

    pago = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    fila = db_session.get(Pago, pago["id"])
    assert isinstance(fila.monto, Decimal)
    assert isinstance(fila.descuento_valor_aplicado, Decimal)
    assert isinstance(fila.descuento_porcentaje_aplicado, Decimal)


def test_beneficio_de_monto_fijo_excesivo_sigue_topeado_al_100_por_ciento(client, db_session):
    """El tope de #11 ("el descuento no supera el monto base") sigue de pie
    bajo la resolución automática: un beneficio de monto fijo mayor al monto
    base del pago se rechaza -- no se registra un pago negativo ni se
    recorta en silencio."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = _crear_descuento_api(client, "Convenio excesivo", monto="999.00")
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 400, respuesta.text
    assert "100" in respuesta.json()["detail"]
    assert db_session.query(Pago).count() == 0
