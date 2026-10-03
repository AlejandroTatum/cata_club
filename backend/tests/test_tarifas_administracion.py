"""Administración de tarifas del catálogo (issue #394, dentro de #400).

El problema que cierra: `/membresias/tipos` exponía solo GET y POST, y
`TipoMembresiaRepositorio` no tenía `actualizar`. Para cambiar el precio de un
plan había que crear un tipo nuevo y dejar el viejo vivo en el catálogo. Una
fuente de verdad que solo se puede escribir una vez no es una fuente de
verdad: es un valor de siembra.

El candado que importa más que el endpoint
------------------------------------------
#394 lo plantea explícitamente ("un cambio de precio no puede reescribir el
pasado") y #400 lo vuelve regla no negociable: **un cambio de tarifa afecta
pagos futuros y jamás pagos previos**. Hoy eso se cumple por una razón
frágil: `membresia.monto_aplicado` es una COPIA del precio, no una
referencia. Antes de abrir la escritura del catálogo hay que fijar esa
propiedad con tests, porque es exactamente lo que se rompería sin que nadie
lo note -- ningún error, ninguna excepción, solo plata vieja que cambia de
valor.

Los dos tests de "no toca el pasado" son, entonces, el motivo real de este
archivo; el resto es el CRUD alrededor.
"""
import pytest

from decimal import Decimal

from tests.fabricas_pagos import (
    crear_membresia_api,
    crear_pago_api,
    crear_persona_api,
    crear_tipo_membresia_api,
    crear_tipo_membresia_orm,
    registrar_pago_api,
)

RUTA_TIPOS = "/api/v1/membresias/tipos"


def test_un_admin_cambia_el_precio_de_una_tarifa(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "42.50"})

    assert respuesta.status_code == 200
    assert respuesta.json()["precio"] == "42.50"

    listado = client.get(RUTA_TIPOS).json()
    assert [t["precio"] for t in listado if t["id"] == tipo["id"]] == ["42.50"]


def test_cambiar_la_tarifa_no_toca_las_membresias_existentes(client):
    """La regla no negociable de #400. `monto_aplicado` es una copia del
    precio al momento de asignar el plan, no una referencia viva: subir la
    cuota del catálogo no puede cambiar retroactivamente lo que una membresía
    ya vigente tiene pactado."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    monto_original = membresia["montoAplicado"]

    client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "99.00"})

    despues = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert despues["montoAplicado"] == monto_original


def test_cambiar_la_tarifa_no_toca_los_pagos_historicos(client):
    """Mismo candado, un nivel más abajo: el pago ya registrado conserva su
    monto y su período de cobertura. El historial nunca se recalcula con el
    catálogo actual."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    pago = crear_pago_api(client, persona["id"], membresia["id"])

    client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "99.00"})

    despues = client.get(f"/api/v1/membresias/pagos/{pago['id']}").json()
    assert despues["monto"] == pago["monto"]
    assert despues["fechaInicio"] == pago["fechaInicio"]
    assert despues["fechaFin"] == pago["fechaFin"]


def test_el_patch_parcial_solo_cambia_lo_enviado(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "40.00"})

    cuerpo = respuesta.json()
    assert cuerpo["precio"] == "40.00"
    assert cuerpo["categoria"] == tipo["categoria"]
    assert cuerpo["modalidad"] == tipo["modalidad"]


def test_se_puede_renombrar_la_categoria_sin_tocar_el_precio(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"categoria": "Infantil"})

    assert respuesta.status_code == 200
    assert respuesta.json()["categoria"] == "Infantil"
    assert respuesta.json()["precio"] == tipo["precio"]


def test_un_precio_no_positivo_es_rechazado(client):
    """El mismo `gt=0` que ya protege al POST: una tarifa en cero o negativa
    no describe ningún plan comercial y rompería la cuenta de meses, que
    divide por este número."""
    tipo = crear_tipo_membresia_api(client)

    assert client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "0"}).status_code == 422
    assert client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "-5"}).status_code == 422


def test_un_patch_vacio_no_rompe_ni_cambia_nada(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={})

    assert respuesta.status_code == 200
    assert respuesta.json() == tipo


@pytest.mark.parametrize("campo", ["categoria", "precio", "modalidad"])
def test_un_null_explicito_es_rechazado_con_422(client, campo):
    """Hallazgo de review adversarial (issue #400): `categoria`, `precio` y
    `modalidad` son NOT NULL en la base, pero el DTO las declaraba
    `Optional[...] = Field(None, ...)` -- la misma forma que
    `DescuentoUpdateDTO`, donde SÍ es correcta porque ahí un null explícito es
    una señal válida ("cambiar de porcentual a monto fijo"). Acá no hay
    ninguna modalidad "nula" del campo: un null explícito es simplemente un
    dato inválido.

    `exclude_unset` en el servicio solo descarta claves OMITIDAS del JSON;
    una clave presente con valor `null` cuenta como "seteada" y llegaba
    intacta hasta `setattr(tipo, campo, None)`, violando el NOT NULL de la
    columna. Eso reventaba como `IntegrityError` en el commit y el handler
    global de `main.py` lo traducía a un 409 de conflicto -- un status que no
    describe el problema real (dato inválido) ni nombra el campo. Debe
    rechazarse en la capa de validación, antes de tocar la base, con un 422
    que sí nombra el campo."""
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={campo: None})

    assert respuesta.status_code == 422
    assert campo in respuesta.text

    listado = client.get(RUTA_TIPOS).json()
    actual = next(t for t in listado if t["id"] == tipo["id"])
    assert actual[campo] == tipo[campo]


def test_una_tarifa_inexistente_da_404(client):
    assert client.patch(f"{RUTA_TIPOS}/999999", json={"precio": "40.00"}).status_code == 404


# Los dos candados de autorización NO piden también la fixture `client`: los
# overrides de dependencias son GLOBALES a la app, así que pedir el cliente
# admin en el mismo test reinstala el token y el endpoint contestaría 200.
# No hace falta un tipo real: la dependencia de permisos corre ANTES del
# handler, así que un id cualquiera alcanza para fijar quién puede entrar.
def test_sin_rol_administrador_da_403(client_sin_permisos):
    """Cambiar un precio es escribir sobre la plata con la que cobra el club:
    mismo candado de rol que el POST que ya existía."""
    respuesta = client_sin_permisos.patch(f"{RUTA_TIPOS}/1", json={"precio": "40.00"})

    assert respuesta.status_code == 403


def test_sin_token_da_401(client_sin_token):
    respuesta = client_sin_token.patch(f"{RUTA_TIPOS}/1", json={"precio": "40.00"})

    assert respuesta.status_code == 401


# --- GET /membresias/tarifas (issue #394, contrato de issue #331) -----------
# Mitad pública del mismo issue: el admin ya puede EDITAR una tarifa (arriba);
# esto expone el catálogo de SOLO LECTURA para quien todavía no tiene sesión
# (la pantalla de inscripción necesita mostrar el precio antes de que la
# persona exista como cuenta). Anónimo a propósito, misma clase que
# `GET /personas/instituciones`: catálogo, no dato de persona.
RUTA_TARIFAS = "/api/v1/membresias/tarifas"


# Las tres pruebas siguientes usan `db_session` (fábrica ORM) en vez del
# cliente `client` autenticado para sembrar el tipo: `client` y
# `client_sin_token` NO pueden pedirse juntos en el mismo test (ver el
# comentario de arriba, línea 154) porque ambos pisan el mismo
# `app.dependency_overrides` global -- pedir `client_sin_token` después de
# `client` borra el override del token admin antes de que el test alcance a
# usarlo.
def test_get_tarifas_es_publico_y_devuelve_200(db_session, client_sin_token):
    crear_tipo_membresia_orm(db_session)

    respuesta = client_sin_token.get(RUTA_TARIFAS)

    assert respuesta.status_code == 200


def test_get_tarifas_expone_exactamente_categoria_y_precio(db_session, client_sin_token):
    """El catálogo público NUNCA debe filtrar `id` ni `modalidad`: son
    detalles administrativos del plan, no parte del contrato público de
    tarifas (issue #331)."""
    crear_tipo_membresia_orm(db_session)

    items = client_sin_token.get(RUTA_TARIFAS).json()

    assert len(items) >= 1
    for item in items:
        assert set(item.keys()) == {"categoria", "precio"}


def test_get_tarifas_refleja_los_tipos_creados(db_session, client_sin_token):
    tipo = crear_tipo_membresia_orm(db_session, categoria="Infantil", precio=Decimal("28.75"))

    items = client_sin_token.get(RUTA_TARIFAS).json()

    coincidencias = [
        i for i in items
        if i["categoria"] == tipo.categoria and Decimal(i["precio"]) == tipo.precio
    ]
    assert len(coincidencias) == 1


# --- Ocultar y eliminar tarifas (retirar del catálogo sin romper historia) ---
# Decisión del dueño: OCULTAR (`activo`) siempre está disponible; ELIMINAR solo
# si la tarifa nunca se usó. Una tarifa oculta sale del catálogo público y no
# admite altas nuevas, pero las membresías que ya la usan siguen operando.
def _ocultar(client, tipo_id: int):
    return client.patch(f"{RUTA_TIPOS}/{tipo_id}", json={"activo": False})


def test_una_tarifa_nueva_es_activa_y_sin_uso(client):
    tipo = crear_tipo_membresia_api(client)

    assert tipo["activo"] is True
    assert tipo["enUso"] is False


def test_admin_oculta_y_reactiva_una_tarifa(client):
    tipo = crear_tipo_membresia_api(client)

    oculta = _ocultar(client, tipo["id"])
    assert oculta.status_code == 200, oculta.text
    assert oculta.json()["activo"] is False

    visible = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"activo": True})
    assert visible.json()["activo"] is True


def test_activo_null_explicito_es_rechazado(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"activo": None})

    assert respuesta.status_code == 422


def test_el_listado_admin_incluye_las_tarifas_ocultas(client):
    tipo = crear_tipo_membresia_api(client)
    _ocultar(client, tipo["id"])

    items = client.get(RUTA_TIPOS).json()

    assert {"id": tipo["id"], "activo": False} in [
        {"id": t["id"], "activo": t["activo"]} for t in items
    ]


def test_el_listado_admin_puede_pedir_solo_activas(client):
    visible = crear_tipo_membresia_api(client)
    oculta = crear_tipo_membresia_api(client)
    _ocultar(client, oculta["id"])

    ids = [t["id"] for t in client.get(RUTA_TIPOS, params={"solo_activas": "true"}).json()]

    assert visible["id"] in ids
    assert oculta["id"] not in ids


def test_get_tarifas_publico_excluye_las_ocultas(client):
    visible = crear_tipo_membresia_api(client)
    oculta = crear_tipo_membresia_api(client)
    _ocultar(client, oculta["id"])

    categorias = [t["categoria"] for t in client.get(RUTA_TARIFAS).json()]

    assert visible["categoria"] in categorias
    assert oculta["categoria"] not in categorias


def test_no_se_crea_membresia_con_tarifa_oculta(client):
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    _ocultar(client, tipo["id"])

    respuesta = client.post(
        "/api/v1/membresias/",
        json={"persona_id": persona["id"], "tipo_membresia_id": tipo["id"]},
    )

    assert respuesta.status_code == 400
    assert "oculta" in respuesta.json()["detail"].lower()


def test_no_se_cambia_el_plan_a_una_tarifa_oculta(client):
    persona = crear_persona_api(client)
    vigente = crear_tipo_membresia_api(client)
    oculta = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], vigente["id"])
    _ocultar(client, oculta["id"])

    respuesta = client.post(
        f"/api/v1/membresias/{membresia['id']}/cambiar-plan",
        json={"nuevo_tipo_membresia_id": oculta["id"]},
    )

    assert respuesta.status_code == 400


def test_la_membresia_existente_sigue_cobrando_con_su_tarifa_oculta(client):
    """Ocultar no rompe el historial: pagos y aprobación siguen funcionando."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    _ocultar(client, tipo["id"])

    pago = registrar_pago_api(client, persona["id"], membresia["id"])
    assert pago.status_code == 201, pago.text

    validado = client.patch(
        f"/api/v1/membresias/pagos/{pago.json()['id']}/validar",
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert validado.status_code == 200, validado.text
    estado = client.get(f"/api/v1/membresias/{membresia['id']}").json()["estado"]
    assert estado == "ACTIVA"


def test_eliminar_tarifa_sin_uso_da_204(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.delete(f"{RUTA_TIPOS}/{tipo['id']}")

    assert respuesta.status_code == 204
    assert tipo["id"] not in [t["id"] for t in client.get(RUTA_TIPOS).json()]


def test_eliminar_tarifa_inexistente_da_404(client):
    assert client.delete(f"{RUTA_TIPOS}/999999").status_code == 404


def test_eliminar_tarifa_con_membresia_da_409_y_la_marca_en_uso(client):
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    crear_membresia_api(client, persona["id"], tipo["id"])

    respuesta = client.delete(f"{RUTA_TIPOS}/{tipo['id']}")

    assert respuesta.status_code == 409
    assert "ocultarla" in respuesta.json()["detail"]
    en_listado = next(t for t in client.get(RUTA_TIPOS).json() if t["id"] == tipo["id"])
    assert en_listado["enUso"] is True


def test_eliminar_tarifa_usada_solo_en_historial_de_cambio_de_plan_da_409(client, db_session):
    """Una tarifa a la que ya nadie pertenece pero que figura en la auditoría
    de un cambio de plan tampoco se puede borrar (FK de historial)."""
    persona = crear_persona_api(client)
    anterior = crear_tipo_membresia_api(client)
    nueva = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], anterior["id"])
    cambio = client.post(
        f"/api/v1/membresias/{membresia['id']}/cambiar-plan",
        json={"nuevo_tipo_membresia_id": nueva["id"]},
    )
    assert cambio.status_code == 200, cambio.text
    # Membresía sin referencias directas a `anterior`; solo queda el historial.
    assert client.delete(f"{RUTA_TIPOS}/{anterior['id']}").status_code == 409


def test_eliminar_tarifa_que_gana_la_carrera_contra_el_pre_chequeo_da_409(
    client, db_session, monkeypatch,
):
    """Una membresía se confirma entre el pre-chequeo `ids_en_uso` y el DELETE:
    la FK lo rechaza y el cliente igual recibe el 409 "en uso", no un error
    genérico. La tarifa sigue existiendo."""
    from app.infraestructura.repositorios.membresia_repositorio import (
        TipoMembresiaRepositorio,
    )

    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    crear_membresia_api(client, persona["id"], tipo["id"])
    monkeypatch.setattr(TipoMembresiaRepositorio, "ids_en_uso", lambda self, ids: set())

    respuesta = client.delete(f"{RUTA_TIPOS}/{tipo['id']}")

    assert respuesta.status_code == 409
    assert "ocultarla" in respuesta.json()["detail"]
    monkeypatch.undo()
    assert tipo["id"] in [t["id"] for t in client.get(RUTA_TIPOS).json()]


def test_eliminar_tarifa_sin_rol_administrador_da_403(client_sin_permisos):
    assert client_sin_permisos.delete(f"{RUTA_TIPOS}/1").status_code == 403
