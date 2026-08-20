"""
Pruebas del catálogo de descuentos y su aplicación a pagos (issue #11).

Modelo firmado (docs/product/concepto-alcance-modelo.md §4), colapsado a columnas de
`Pago`: el dueño confirmó que un pago lleva UN solo descuento, así que
`descuento_aplicado` como tabla 1:N no tenía cardinalidad que la justificara.
- `Descuento`: catálogo vivo administrado por el club (CRUD solo admin);
  porcentaje O monto fijo, nunca ambos; baja SUAVE vía `activo` (la misma
  filosofía de conservar historia que rige al resto del sistema).
- `Pago.descuento_*`: el hecho histórico del descuento aplicado, con el valor
  CONGELADO al momento de aplicar. Cambios posteriores al catálogo NO alteran
  pagos ya registrados.
- Invariantes: el descuento de un pago <= 100 % de su monto base (no hay
  pagos negativos); un pago admite UN solo descuento; el becado 100 %
  registra su pago de $0 por el flujo NORMAL de registro + aprobación (no es
  estado especial).

ACTUALIZACIÓN (issue #398/#400, slice 3c): aplicar un descuento a un pago ya
NO es una elección del cliente. `PagoCreateDTO` perdió el campo
`descuento_ids` -- el beneficio se ASIGNA por separado a la persona
(`BeneficioServicio`, `test_beneficio_asignacion.py`) y `PagoServicio.
registrar_pago` resuelve la asignación VIGENTE del pagador solo. Un
`descuento_ids` que el cliente mande igual se ignora en silencio (Pydantic
descarta campos de más); "un descuento inactivo no puede aplicarse" ahora es
"no puede ASIGNARSE" (el chequeo se movió de tiempo-de-pago a
tiempo-de-asignación). La aplicación automática en sí, con su propia suite,
vive en `test_beneficio_en_pago.py`.

Fábricas del grafo persona -> tipo -> membresía -> pago: `fabricas_pagos`
(única copia compartida, ver su docstring).
"""
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago
from tests.fabricas_pagos import (
    asignar_beneficio_api,
    crear_membresia_orm,
    crear_pago_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
    escenario_membresia_sin_pago_api,
    registrar_pago_api,
)

RUTA_DESCUENTOS = "/api/v1/descuentos/"


# --- Fábricas locales del catálogo -------------------------------------------

def crear_descuento_api(client, nombre="Beca municipal", *, porcentaje=None,
                        monto=None, activo=True):
    """POST /descuentos devolviendo la Response cruda (para asertar códigos)."""
    payload = {"nombre": nombre, "activo": activo}
    if porcentaje is not None:
        payload["porcentaje"] = porcentaje
    if monto is not None:
        payload["monto"] = monto
    return client.post(RUTA_DESCUENTOS, json=payload)


def crear_descuento_orm(sesion, nombre="Beca municipal", *, porcentaje=None,
                        monto=None, activo=True):
    """Escribe el descuento directo por ORM, para las pruebas cuyo cliente
    HTTP no tiene rol admin y por lo tanto no puede sembrarlo vía API."""
    from app.dominio.modelos import Descuento
    descuento = Descuento(
        nombre=nombre, porcentaje=porcentaje, monto=monto, activo=activo,
    )
    sesion.add(descuento)
    sesion.flush()
    return descuento


# --- Catálogo: CRUD y permisos -----------------------------------------------

def test_admin_crea_descuento_porcentual(client):
    respuesta = crear_descuento_api(client, "Beca municipal", porcentaje="100")
    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    assert cuerpo["nombre"] == "Beca municipal"
    assert Decimal(str(cuerpo["porcentaje"])) == Decimal("100")
    assert cuerpo["monto"] is None
    assert cuerpo["activo"] is True
    assert cuerpo["id"] > 0


def test_admin_crea_descuento_de_monto_fijo(client):
    respuesta = crear_descuento_api(client, "Convenio empresa", monto="10.00")
    assert respuesta.status_code == 201
    cuerpo = respuesta.json()
    assert cuerpo["porcentaje"] is None
    assert Decimal(str(cuerpo["monto"])) == Decimal("10.00")


def test_crear_descuento_exige_porcentaje_o_monto_exclusivos(client):
    # Ninguno de los dos: rechazado en validación del DTO.
    assert crear_descuento_api(client, "Vacío").status_code == 422
    # Ambos a la vez: también rechazado.
    respuesta = crear_descuento_api(
        client, "Ambiguo", porcentaje="50", monto="5.00",
    )
    assert respuesta.status_code == 422


def test_porcentaje_fuera_de_rango_es_rechazado(client):
    assert crear_descuento_api(client, "Cero", porcentaje="0").status_code == 422
    assert crear_descuento_api(client, "Excedido", porcentaje="100.01").status_code == 422


def test_nombre_de_descuento_duplicado_es_rechazado(client):
    assert crear_descuento_api(client, "Beca municipal", porcentaje="100").status_code == 201
    respuesta = crear_descuento_api(client, "Beca municipal", porcentaje="50")
    assert respuesta.status_code == 400


def test_listado_admin_incluye_inactivos(client):
    beca = crear_descuento_api(client, "Beca municipal", porcentaje="100").json()
    crear_descuento_api(client, "Descuento familiar", porcentaje="100")

    # Baja suave: se desactiva vía PATCH, nunca se borra.
    respuesta = client.patch(f"{RUTA_DESCUENTOS}{beca['id']}", json={"activo": False})
    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is False

    listado = client.get(RUTA_DESCUENTOS)
    assert listado.status_code == 200
    por_nombre = {d["nombre"]: d for d in listado.json()}
    assert por_nombre["Beca municipal"]["activo"] is False
    assert por_nombre["Descuento familiar"]["activo"] is True


def test_admin_actualiza_porcentaje_del_descuento(client):
    descuento = crear_descuento_api(client, "Hermanos", porcentaje="25").json()
    respuesta = client.patch(
        f"{RUTA_DESCUENTOS}{descuento['id']}", json={"porcentaje": "30"},
    )
    assert respuesta.status_code == 200
    assert Decimal(str(respuesta.json()["porcentaje"])) == Decimal("30")


def test_actualizar_a_estado_ambiguo_es_rechazado(client):
    """Un PATCH que dejaría porcentaje Y monto definidos a la vez viola el
    invariante del catálogo y se rechaza sin persistir nada."""
    descuento = crear_descuento_api(client, "Hermanos", porcentaje="25").json()
    respuesta = client.patch(
        f"{RUTA_DESCUENTOS}{descuento['id']}", json={"monto": "5.00"},
    )
    assert respuesta.status_code == 400


def test_actualizar_descuento_inexistente_es_404(client):
    assert client.patch(f"{RUTA_DESCUENTOS}9999", json={"activo": False}).status_code == 404


def test_catalogo_requiere_rol_administrador(client_sin_permisos):
    assert crear_descuento_api(client_sin_permisos, "Beca", porcentaje="100").status_code == 403
    assert client_sin_permisos.get(RUTA_DESCUENTOS).status_code == 403
    assert client_sin_permisos.patch(f"{RUTA_DESCUENTOS}1", json={"activo": False}).status_code == 403


def test_catalogo_sin_token_responde_401(client_sin_token):
    assert client_sin_token.get(RUTA_DESCUENTOS).status_code == 401


# --- Aplicación al registrar un pago -----------------------------------------
# Issue #398/#400: el descuento de un pago YA NO lo elige el cliente. Estos
# tests aplicaban un `descuento_ids` enviado en el POST; ahora el beneficio se
# ASIGNA por separado (`asignar_beneficio_api`, endpoint de
# `test_beneficio_asignacion.py`) y `registrar_pago` lo resuelve solo. La
# aplicación automática en sí (feliz, con porcentaje/monto fijo, quién queda
# como autor, retiro, manipulación del payload) tiene su propia suite en
# `test_beneficio_en_pago.py`; lo que sigue acá es lo que YA vivía en este
# archivo y necesitaba adaptarse al nuevo contrato, sin perder lo que
# protegía.

def _escenario_con_beneficio_asignado(
    client, *, porcentaje=None, monto=None, nombre="Media beca",
) -> tuple[dict, dict, dict]:
    """Persona + tipo + membresía (sin pago) + beneficio YA asignado, vía API
    completa. Devuelve (persona, membresia, descuento). Base común de las
    pruebas de este archivo que necesitan un beneficio vigente antes de
    registrar el pago."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = crear_descuento_api(client, nombre, porcentaje=porcentaje, monto=monto).json()
    asignacion = asignar_beneficio_api(client, persona["id"], descuento["id"])
    assert asignacion.status_code == 201, asignacion.text
    return persona, membresia, descuento


def test_pago_con_beneficio_porcentual_congela_valor_y_autor(client, db_session):
    """El servicio resuelve la asignación VIGENTE del pagador (issue #398),
    la congela en las columnas `descuento_*` de Pago y descuenta el monto
    final -- el cliente no envía nada sobre descuentos. Queda registrado qué
    admin CONCEDIÓ el beneficio (`asignado_por_persona_id`, persona_id 1 del
    token de `client`), no quien registró el pago (ver
    `test_beneficio_en_pago.py` para el caso en que son personas distintas)."""
    persona, membresia, descuento = _escenario_con_beneficio_asignado(
        client, porcentaje="50",
    )

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 201
    pago = respuesta.json()
    assert Decimal(str(pago["monto"])) == Decimal("17.50")

    from app.dominio.modelos import Pago
    fila = db_session.get(Pago, pago["id"])
    assert fila.descuento_id == descuento["id"]
    assert fila.descuento_valor_aplicado == Decimal("17.50")
    assert fila.descuento_porcentaje_aplicado == Decimal("50")
    assert fila.descuento_autorizado_por_persona_id == 1

    # La respuesta del endpoint también expone el descuento congelado
    # (claves camelCase: ver alias_generator de ResponseBase).
    assert pago["descuentoId"] == descuento["id"]
    assert Decimal(str(pago["descuentoValorAplicado"])) == Decimal("17.50")


def test_pago_con_beneficio_de_monto_fijo(client, db_session):
    persona, membresia, descuento = _escenario_con_beneficio_asignado(
        client, nombre="Convenio", monto="10.00",
    )

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 201
    pago = respuesta.json()
    assert Decimal(str(pago["monto"])) == Decimal("25.00")

    from app.dominio.modelos import Pago
    fila = db_session.get(Pago, pago["id"])
    assert fila.descuento_valor_aplicado == Decimal("10.00")
    assert fila.descuento_porcentaje_aplicado is None


def test_historial_propio_expone_el_beneficio_congelado(client):
    """El portal del socio lee `GET /membresias/pagos/persona/{id}`, y de ahí
    -- no del POST -- saca lo que muestra en el historial. El socio no elige
    el beneficio (lo concede el admin por separado, issue #398), pero sí
    tiene que poder LEER el que el club ya le aplicó: sin
    `descuentoValorAplicado` en esta respuesta, la pantalla solo puede
    mostrarle un monto final sin explicación, que es justamente el reclamo de
    QA del 17/08/2026.

    El precio de lista NO viaja como campo propio: `Pago.monto` es el monto
    FINAL (`registrar_pago` hace `pago.monto = monto_final`) y el base se
    reconstruye exacto sumándole el valor congelado, porque
    `_congelar_beneficio_activo` devuelve justamente `monto_base - valor`.
    Este test fija esa relación además de la presencia de los campos: es la
    aritmética que el cliente rehace para poder nombrar los tres números."""
    persona, membresia, descuento = _escenario_con_beneficio_asignado(
        client, porcentaje="50",
    )
    assert persona["id"] == 1  # el token de `client` es persona_id=1: es "su" historial
    registrar_pago_api(client, persona["id"], membresia["id"])

    respuesta = client.get(f"/api/v1/membresias/pagos/persona/{persona['id']}")
    assert respuesta.status_code == 200
    historial = respuesta.json()
    assert len(historial) == 1
    pago = historial[0]

    assert pago["descuentoId"] == descuento["id"]
    assert Decimal(str(pago["descuentoValorAplicado"])) == Decimal("17.50")
    assert Decimal(str(pago["descuentoPorcentajeAplicado"])) == Decimal("50")
    assert Decimal(str(pago["monto"])) == Decimal("17.50")
    # Precio de lista = monto final + descuento congelado, exacto.
    assert (
        Decimal(str(pago["monto"])) + Decimal(str(pago["descuentoValorAplicado"]))
        == Decimal("35.00")
    )


def test_historial_propio_sin_descuento_deja_los_campos_en_null(client):
    """El contrario del anterior, y la razón por la que la pantalla puede
    decidir sin ambigüedad: un pago sin descuento no trae ceros, trae `None`.
    Un `0.00` obligaría al cliente a distinguir «no hubo descuento» de «hubo
    uno de cero», y el producto no muestra nada cuando no hubo. Sin ningún
    beneficio asignado (no se toca `_escenario_con_beneficio_asignado`), este
    test no necesitó cambios: sigue probando exactamente lo mismo."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    registrar_pago_api(client, persona["id"], membresia["id"])

    historial = client.get(f"/api/v1/membresias/pagos/persona/{persona['id']}").json()
    assert len(historial) == 1
    pago = historial[0]
    assert pago["descuentoId"] is None
    assert pago["descuentoValorAplicado"] is None
    assert pago["descuentoPorcentajeAplicado"] is None


def test_beneficio_no_puede_superar_el_100_por_ciento(client, db_session):
    """Tope firmado: no existen pagos negativos. Un porcentual nunca puede
    solo excederlo: el catálogo ya limita `porcentaje <= 100`
    (`ck_descuento_porcentaje_en_rango`), así que a lo sumo iguala el monto
    base. La única forma real de que un beneficio supere el 100 % es uno de
    monto FIJO mayor que el monto base del pago -- exactamente lo que se
    ejercita acá, ahora vía asignación en vez de `descuento_ids`."""
    persona, membresia, descuento = _escenario_con_beneficio_asignado(
        client, nombre="Convenio excesivo", monto="40.00",
    )

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 400
    assert "100" in respuesta.json()["detail"]

    from app.dominio.modelos import Pago
    assert db_session.query(Pago).count() == 0


# --- `descuento_ids` ya no existe en el contrato: enviarlo no tiene efecto ---
# Los cinco tests siguientes protegían, cada uno, una forma distinta de
# payload inválido de `descuento_ids` (más de un id, un id inactivo, un id
# inexistente, un id repetido, un id enviado sin ser admin) que antes se
# RECHAZABA con 400/403/404. Bajo el contrato nuevo el campo no existe:
# Pydantic lo descarta al parsear (ver docstring de `PagoCreateDTO`), así que
# ninguna de esas formas puede romper nada -- el pago se registra igual, SIN
# descuento. Se mantienen las cinco variantes de payload (no se colapsan en
# una sola prueba) porque cada una demuestra que el campo es inerte pase lo
# que pase adentro, no solo en el caso feliz.

def test_enviar_varios_descuento_ids_no_tiene_efecto(client):
    """ANTES: un pago admitía UN solo descuento, así que enviar dos ids se
    rechazaba con 400 (colapsado a columnas de Pago)."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    d1 = crear_descuento_api(client, "Beca parcial", porcentaje="30").json()
    d2 = crear_descuento_api(client, "Familiar", porcentaje="20").json()

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[d1["id"], d2["id"]],
    )
    assert respuesta.status_code == 201
    pago = respuesta.json()
    assert pago["descuentoId"] is None
    assert Decimal(str(pago["monto"])) == Decimal("35.00")


def test_enviar_descuento_ids_de_un_descuento_inactivo_no_tiene_efecto(client):
    """ANTES: un descuento inactivo enviado en `descuento_ids` se rechazaba
    con 400 al registrar el pago. AHORA esa validación vive en
    `BeneficioServicio.asignar` (issue #398,
    `test_beneficio_asignacion.py::test_asignar_descuento_inactivo_es_rechazado`)
    -- un descuento inactivo no puede ASIGNARSE como beneficio. Al registrar
    el pago ya no hay ningún `descuento_ids` que validar."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = crear_descuento_api(client, "Beca vieja", porcentaje="50").json()
    client.patch(f"{RUTA_DESCUENTOS}{descuento['id']}", json={"activo": False})

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[descuento["id"]],
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["descuentoId"] is None


def test_enviar_descuento_ids_inexistente_no_tiene_efecto(client):
    """ANTES: un id inexistente en `descuento_ids` daba 404."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[9999],
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["descuentoId"] is None


def test_enviar_descuento_ids_repetido_no_tiene_efecto(client):
    """ANTES: el mismo id repetido dos veces en `descuento_ids` se rechazaba
    con 400."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = crear_descuento_api(client, "Media beca", porcentaje="50").json()
    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"],
        descuento_ids=[descuento["id"], descuento["id"]],
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["descuentoId"] is None


def test_enviar_descuento_ids_no_tiene_efecto_sin_ser_admin(client_sin_permisos, db_session):
    """ANTES: aplicar descuentos era decisión del ADMINISTRADOR (modelo
    firmado §4: 'el admin decide, el sistema registra'); un alumno adulto que
    enviara `descuento_ids` en su propio pago recibía 403 -- ese era el único
    caso en que este archivo probaba la autorización de `descuento_ids` en
    sí. AHORA esa autorización dejó de tener sentido: nadie "aplica" un
    descuento al pagar (el admin lo asigna aparte, issue #398), así que un
    no-admin que igual mande `descuento_ids` no necesita ningún permiso
    especial para eso -- simplemente no tiene efecto, igual que para un
    admin (tests de arriba)."""
    persona = crear_persona_orm(
        db_session, "1710034065", fecha_nacimiento=date(1990, 1, 1),
    )
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    descuento = crear_descuento_orm(db_session, porcentaje=Decimal("50"))

    respuesta = registrar_pago_api(
        client_sin_permisos, persona.id, membresia.id,
        descuento_ids=[descuento.id],
    )
    assert respuesta.status_code == 201
    assert respuesta.json()["descuentoId"] is None


# --- El becado no es un estado especial: pago de $0 por el flujo normal ------

def test_beca_total_registra_pago_de_cero_por_el_flujo_normal(client, monkeypatch):
    """Beca municipal 100 %: el pago se registra en $0, se aprueba por el
    MISMO camino que cualquier pago, la membresía se activa y se dispara la
    generación del comprobante. Así el becado figura al día con la misma
    lógica que todos -- ahora con el beneficio asignado de antemano en vez de
    enviado en el POST."""
    persona, membresia, beca = _escenario_con_beneficio_asignado(
        client, nombre="Beca municipal", porcentaje="100",
    )

    respuesta = registrar_pago_api(client, persona["id"], membresia["id"])
    assert respuesta.status_code == 201
    pago = respuesta.json()
    assert Decimal(str(pago["monto"])) == Decimal("0.00")
    assert pago["estadoPago"] == "PENDIENTE_VALIDACION"

    # Registrar qué comprobantes se disparan (el autouse de conftest ya
    # anula el disparo real; acá lo reemplazamos por un grabador).
    disparos: list[int] = []
    import app.servicios_negocio.membresia_pago_servicio as mps
    monkeypatch.setattr(
        mps.PagoServicio, "_disparar_generacion_comprobante_pdf",
        lambda self, pago_id: disparos.append(pago_id),
    )

    aprobacion = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        # Issue #459: TRANSFERENCIA sin voucher (default de `registrar_pago_api`).
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert aprobacion.status_code == 200
    assert aprobacion.json()["estadoPago"] == "APROBADO"

    activada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert activada["estado"] == "ACTIVA"
    assert disparos == [pago["id"]]


# --- Valor congelado: el catálogo posterior no reescribe la historia ---------

def test_editar_el_catalogo_no_altera_beneficios_ya_aplicados(client, db_session):
    """Invariante firmado: cambios al catálogo NUNCA alteran pagos históricos.
    Tras aplicar un 50 %, se cambia el descuento a 10 %, se renombra y se
    desactiva: las columnas `descuento_*` del pago y su monto no se mueven."""
    persona, membresia, descuento = _escenario_con_beneficio_asignado(
        client, porcentaje="50",
    )

    pago = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    assert Decimal(str(pago["monto"])) == Decimal("17.50")

    # Edición posterior del catálogo: valor, nombre y estado.
    edicion = client.patch(
        f"{RUTA_DESCUENTOS}{descuento['id']}",
        json={"nombre": "Beca reducida", "porcentaje": "10", "activo": False},
    )
    assert edicion.status_code == 200

    from app.dominio.modelos import Pago
    fila = db_session.get(Pago, pago["id"])
    assert fila.descuento_valor_aplicado == Decimal("17.50")
    assert fila.descuento_porcentaje_aplicado == Decimal("50")
    assert fila.monto == Decimal("17.50")


# --- El CHECK es el espejo del chequeo del servicio (colapsado a columnas) ---

def test_pago_con_descuento_id_pero_sin_valor_congelado_viola_el_check(db_session):
    """`PagoServicio._congelar_beneficio_activo` siempre asigna
    `descuento_id` y `descuento_valor_aplicado` juntos, o ninguno de los dos
    -- pero un INSERT que se lo salte (directo por ORM, como acá) debe
    seguir rechazado por `ck_pago_descuento_valor_congelado`: el servicio es
    el camino primario de error, la base es la red de seguridad."""
    persona = crear_persona_orm(db_session, cedula_valida(220))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    descuento = crear_descuento_orm(db_session, porcentaje=Decimal("50"))
    pago = crear_pago_orm(db_session, persona, membresia, EstadoPago.PENDIENTE_VALIDACION)

    pago.descuento_id = descuento.id
    # `descuento_valor_aplicado` se deja NULL a propósito: viola el CHECK.
    with pytest.raises(IntegrityError):
        db_session.flush()
