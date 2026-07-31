"""
Pruebas del catálogo de descuentos y su aplicación a pagos (issue #11).

Modelo firmado (docs/concepto-alcance-modelo.md §4):
- `Descuento`: catálogo vivo administrado por el club (CRUD solo admin);
  porcentaje O monto fijo, nunca ambos; baja SUAVE vía `activo` (la misma
  filosofía de conservar historia que rige al resto del sistema).
- `DescuentoAplicado`: hecho histórico por pago con el valor CONGELADO al
  momento de aplicar. Cambios posteriores al catálogo NO alteran pagos ya
  registrados.
- Invariantes: descuento total de un pago <= 100 % (no hay pagos negativos);
  un descuento inactivo no puede aplicarse; el becado 100 % registra su pago
  de $0 por el flujo NORMAL de registro + aprobación (no es estado especial).

Fábricas del grafo persona -> tipo -> membresía -> pago: `fabricas_pagos`
(única copia compartida, ver su docstring).
"""
from datetime import date
from decimal import Decimal

from tests.fabricas_pagos import (
    crear_membresia_orm,
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

def _obtener_aplicaciones(sesion, pago_id: int):
    from app.dominio.modelos import DescuentoAplicado
    return (
        sesion.query(DescuentoAplicado)
        .filter(DescuentoAplicado.pago_id == pago_id)
        .all()
    )


def test_pago_con_descuento_porcentual_congela_valor_y_autor(client, db_session):
    """El servicio resuelve el valor VIGENTE del catálogo, lo congela en
    DescuentoAplicado y descuenta el monto final; queda registrado a quién se
    aplicó y qué admin lo autorizó (persona_id 1 del token de `client`)."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = crear_descuento_api(client, "Media beca", porcentaje="50").json()

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[descuento["id"]],
    )
    assert respuesta.status_code == 201
    pago = respuesta.json()
    assert Decimal(str(pago["monto"])) == Decimal("17.50")

    aplicaciones = _obtener_aplicaciones(db_session, pago["id"])
    assert len(aplicaciones) == 1
    aplicacion = aplicaciones[0]
    assert aplicacion.descuento_id == descuento["id"]
    assert aplicacion.valor_aplicado == Decimal("17.50")
    assert aplicacion.porcentaje_aplicado == Decimal("50")
    assert aplicacion.persona_id == persona["id"]
    assert aplicacion.autorizado_por_persona_id == 1

    # La respuesta del endpoint también expone el registro congelado
    # (claves camelCase: ver alias_generator de ResponseBase).
    assert len(pago["descuentosAplicados"]) == 1
    assert Decimal(str(pago["descuentosAplicados"][0]["valorAplicado"])) == Decimal("17.50")


def test_pago_con_descuento_de_monto_fijo(client, db_session):
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = crear_descuento_api(client, "Convenio", monto="10.00").json()

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[descuento["id"]],
    )
    assert respuesta.status_code == 201
    pago = respuesta.json()
    assert Decimal(str(pago["monto"])) == Decimal("25.00")

    (aplicacion,) = _obtener_aplicaciones(db_session, pago["id"])
    assert aplicacion.valor_aplicado == Decimal("10.00")
    assert aplicacion.porcentaje_aplicado is None


def test_descuento_total_no_puede_superar_el_100_por_ciento(client, db_session):
    """Tope firmado: no existen pagos negativos. Dos descuentos que suman
    110 % se rechazan y NO queda registrado ningún pago."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    d1 = crear_descuento_api(client, "Beca parcial", porcentaje="60").json()
    d2 = crear_descuento_api(client, "Familiar", porcentaje="50").json()

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[d1["id"], d2["id"]],
    )
    assert respuesta.status_code == 400
    assert "100" in respuesta.json()["detail"]

    from app.dominio.modelos import Pago
    assert db_session.query(Pago).count() == 0


def test_descuento_inactivo_es_rechazado(client):
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = crear_descuento_api(client, "Beca vieja", porcentaje="50").json()
    client.patch(f"{RUTA_DESCUENTOS}{descuento['id']}", json={"activo": False})

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[descuento["id"]],
    )
    assert respuesta.status_code == 400
    assert "inactivo" in respuesta.json()["detail"].lower()


def test_descuento_inexistente_es_404(client):
    persona, membresia = escenario_membresia_sin_pago_api(client)
    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[9999],
    )
    assert respuesta.status_code == 404


def test_descuento_repetido_en_la_solicitud_es_rechazado(client):
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = crear_descuento_api(client, "Media beca", porcentaje="50").json()
    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"],
        descuento_ids=[descuento["id"], descuento["id"]],
    )
    assert respuesta.status_code == 400


def test_alumno_no_puede_aplicar_descuentos(client_sin_permisos, db_session):
    """Aplicar descuentos es decisión del ADMINISTRADOR (modelo firmado §4:
    'el admin decide, el sistema registra'). Un alumno adulto puede registrar
    su propio pago, pero adjuntarle descuentos responde 403."""
    persona = crear_persona_orm(
        db_session, "1710034065", fecha_nacimiento=date(1990, 1, 1),
    )
    tipo = crear_tipo_membresia_orm(db_session)
    from app.dominio.enums import EstadoMembresia
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    descuento = crear_descuento_orm(db_session, porcentaje=Decimal("50"))

    respuesta = registrar_pago_api(
        client_sin_permisos, persona.id, membresia.id,
        monto="30.00", descuento_ids=[descuento.id],
    )
    assert respuesta.status_code == 403


# --- El becado no es un estado especial: pago de $0 por el flujo normal ------

def test_beca_total_registra_pago_de_cero_por_el_flujo_normal(client, monkeypatch):
    """Beca municipal 100 %: el pago se registra en $0, se aprueba por el
    MISMO camino que cualquier pago, la membresía se activa y se dispara la
    generación del comprobante. Así el becado figura al día con la misma
    lógica que todos."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    beca = crear_descuento_api(client, "Beca municipal", porcentaje="100").json()

    respuesta = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[beca["id"]],
    )
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
        json={"estado_pago": "APROBADO"},
    )
    assert aprobacion.status_code == 200
    assert aprobacion.json()["estadoPago"] == "APROBADO"

    activada = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert activada["estado"] == "ACTIVA"
    assert disparos == [pago["id"]]


# --- Valor congelado: el catálogo posterior no reescribe la historia ---------

def test_editar_el_catalogo_no_altera_descuentos_ya_aplicados(client, db_session):
    """Invariante firmado: cambios al catálogo NUNCA alteran pagos históricos.
    Tras aplicar un 50 %, se cambia el descuento a 10 %, se renombra y se
    desactiva: la fila de DescuentoAplicado y el monto del pago no se mueven."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    descuento = crear_descuento_api(client, "Media beca", porcentaje="50").json()

    pago = registrar_pago_api(
        client, persona["id"], membresia["id"], descuento_ids=[descuento["id"]],
    ).json()
    assert Decimal(str(pago["monto"])) == Decimal("17.50")

    # Edición posterior del catálogo: valor, nombre y estado.
    edicion = client.patch(
        f"{RUTA_DESCUENTOS}{descuento['id']}",
        json={"nombre": "Beca reducida", "porcentaje": "10", "activo": False},
    )
    assert edicion.status_code == 200

    (aplicacion,) = _obtener_aplicaciones(db_session, pago["id"])
    assert aplicacion.valor_aplicado == Decimal("17.50")
    assert aplicacion.porcentaje_aplicado == Decimal("50")

    from app.dominio.modelos import Pago
    assert db_session.get(Pago, pago["id"]).monto == Decimal("17.50")
