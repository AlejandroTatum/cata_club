"""
Autoría de aprobación/rechazo de pago (issue #458).

`PATCH /pagos/{id}/validar` aprobaba o rechazaba un pago sin registrar QUIÉN
lo hizo: el JWT del admin nunca se decodificaba dentro del handler
(`GestorPermisos(ROL_ADMIN)` solo servía de puerta de acceso), y `Pago` no
tenía ninguna columna de autor para esta operación -- a diferencia de
`descuento_autorizado_por_persona_id` y `regularizada_por_persona_id`, que sí
nombran a su admin.

Decisión de producto (no se reabre acá): todo pago aprobado o rechazado
registra SIEMPRE al administrador responsable, de forma fail-closed -- si no
se puede determinar su identidad, la operación se rechaza en vez de guardar
un pago sin autor.
"""
from app.dominio.cedula import cedula_valida
from app.seguridad.gestor_auth import GestorAutenticacion


# --- helpers locales (mismo esquema que test_notificaciones.py / test_membresias_pagos.py) ---

def _crear_persona(client, cedula):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_tipo_membresia(client):
    return client.post(
        "/api/v1/membresias/tipos",
        json={"categoria": "Adultos", "precio": "35.00", "modalidad": "MENSUAL"},
    ).json()


def _crear_membresia(client, persona_id, tipo_id):
    return client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona_id, "tipo_membresia_id": tipo_id,
        },
    ).json()


def _crear_pago_pendiente(client, persona_id, membresia_id):
    # TRANSFERENCIA por conveniencia de esta suite, no por una restricción:
    # desde el issue #565 un ADMINISTRADOR también puede registrar EFECTIVO a
    # nombre de un tercero (ver `test_efectivo_solo_por_socio.py`). Estos pagos
    # van sin comprobante adjunto, y TRANSFERENCIA es la vía que ejercita el
    # `motivo_excepcion_sin_comprobante` que estos tests ya declaran.
    return client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "TRANSFERENCIA",
            "persona_id": persona_id, "membresia_id": membresia_id,
        },
    ).json()


def _armar_pago_pendiente(client, cedula):
    """Arma persona + tipo + membresía + pago PENDIENTE_VALIDACION completo,
    devuelve (persona, pago)."""
    persona = _crear_persona(client, cedula)
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago_pendiente(client, persona["id"], membresia["id"])
    return persona, pago


def _autenticar_como(persona_id: int, roles: list[str]):
    """Reemplaza el token decodificado del cliente de pruebas por uno que
    dice ser `persona_id` con `roles`. Mismo idiom que
    `test_membresias_pagos.py::test_obtener_membresia_owner_puede_acceder`."""
    from main import app

    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": f"persona-{persona_id}@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


# --- Baseline: hoy un pago recién validado no debía exponer autor (documenta
# el punto de partida; con el fix de abajo, SIEMPRE queda poblado) ----------

def test_pago_pendiente_no_tiene_autor(client):
    """Antes de validarse, un pago no tiene autor de aprobación/rechazo --
    el campo solo se completa al validar, nunca antes."""
    _, pago = _armar_pago_pendiente(client, cedula_valida(900))
    assert pago["validadoPorPersonaId"] is None


# --- GREEN: aprobar y rechazar registran al admin autenticado ---------------

def test_pago_aprobado_registra_al_admin_que_aprueba(client, db_session):
    """Aprobar un pago persiste `validado_por_persona_id` con el `persona_id`
    del JWT del admin -- no `None`, no un valor que el cliente pueda mandar
    (`PagoValidarDTO` no acepta ningún campo de autor)."""
    admin = _crear_persona(client, cedula_valida(901))
    persona, pago = _armar_pago_pendiente(client, cedula_valida(902))

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        # `motivo_excepcion_sin_comprobante` (issue #459): estos pagos son
        # TRANSFERENCIA sin voucher adjunto (`_crear_pago_pendiente` nunca
        # adjunta uno) -- sin este motivo, aprobar devuelve 400 desde este
        # fix. Esta suite prueba autoría (issue #458), no la excepción; el
        # motivo acá es solo lo que hace falta para que la aprobación pase.
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["validadoPorPersonaId"] == admin["id"]

    from app.dominio.modelos import Pago
    fila = db_session.get(Pago, pago["id"])
    assert fila.validado_por_persona_id == admin["id"]


def test_pago_rechazado_registra_al_admin_que_rechaza(client, db_session):
    """Rechazar también persiste `validado_por_persona_id`: el mismo campo
    sirve para las dos operaciones -- mismo criterio que `fecha_validacion`,
    que ya es el "cuándo" de ambas."""
    admin = _crear_persona(client, cedula_valida(903))
    persona, pago = _armar_pago_pendiente(client, cedula_valida(904))

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Comprobante ilegible"},
    )
    assert resp.status_code == 200
    assert resp.json()["estadoPago"] == "RECHAZADO"
    assert resp.json()["validadoPorPersonaId"] == admin["id"]

    from app.dominio.modelos import Pago
    fila = db_session.get(Pago, pago["id"])
    assert fila.validado_por_persona_id == admin["id"]


# --- TRIANGULATE: dos admins, dos pagos, sin cruzarse -----------------------

def test_dos_admins_aprobando_pagos_distintos_no_se_cruzan(client, db_session):
    """Admin A aprueba el pago 1, admin B aprueba el pago 2: cada fila debe
    quedar atribuida a SU admin, nunca al otro."""
    admin_a = _crear_persona(client, cedula_valida(905))
    admin_b = _crear_persona(client, cedula_valida(906))
    _, pago_1 = _armar_pago_pendiente(client, cedula_valida(907))
    _, pago_2 = _armar_pago_pendiente(client, cedula_valida(908))

    _autenticar_como(admin_a["id"], ["ADMINISTRADOR"])
    resp_1 = client.patch(
        f"/api/v1/membresias/pagos/{pago_1['id']}/validar",
        # `motivo_excepcion_sin_comprobante` (issue #459): estos pagos son
        # TRANSFERENCIA sin voucher adjunto (`_crear_pago_pendiente` nunca
        # adjunta uno) -- sin este motivo, aprobar devuelve 400 desde este
        # fix. Esta suite prueba autoría (issue #458), no la excepción; el
        # motivo acá es solo lo que hace falta para que la aprobación pase.
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert resp_1.status_code == 200

    _autenticar_como(admin_b["id"], ["ADMINISTRADOR"])
    resp_2 = client.patch(
        f"/api/v1/membresias/pagos/{pago_2['id']}/validar",
        # `motivo_excepcion_sin_comprobante` (issue #459): estos pagos son
        # TRANSFERENCIA sin voucher adjunto (`_crear_pago_pendiente` nunca
        # adjunta uno) -- sin este motivo, aprobar devuelve 400 desde este
        # fix. Esta suite prueba autoría (issue #458), no la excepción; el
        # motivo acá es solo lo que hace falta para que la aprobación pase.
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert resp_2.status_code == 200

    from app.dominio.modelos import Pago
    fila_1 = db_session.get(Pago, pago_1["id"])
    fila_2 = db_session.get(Pago, pago_2["id"])

    assert fila_1.validado_por_persona_id == admin_a["id"]
    assert fila_2.validado_por_persona_id == admin_b["id"]
    assert fila_1.validado_por_persona_id != fila_2.validado_por_persona_id


# --- Fail-closed: sin identidad verificable, la operación se rechaza -------

def test_validar_pago_falla_cerrado_si_el_token_no_trae_persona_id(client, db_session):
    """Un JWT con rol ADMINISTRADOR pero SIN `persona_id` (token legado o
    malformado) pasa el chequeo de rol de `GestorPermisos` -- que solo mira
    roles -- pero debe rechazarse ANTES de guardar nada: guardar la
    aprobación sin autor es exactamente el defecto que este issue cierra.
    403, no 500: no es un bug del servidor, es que no se pudo verificar la
    identidad de quien pide la operación."""
    _, pago = _armar_pago_pendiente(client, cedula_valida(909))

    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "admin-legado@cataclub.test", "roles": ["ADMINISTRADOR"],
    }
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        # `motivo_excepcion_sin_comprobante` (issue #459): estos pagos son
        # TRANSFERENCIA sin voucher adjunto (`_crear_pago_pendiente` nunca
        # adjunta uno) -- sin este motivo, aprobar devuelve 400 desde este
        # fix. Esta suite prueba autoría (issue #458), no la excepción; el
        # motivo acá es solo lo que hace falta para que la aprobación pase.
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert resp.status_code == 403

    from app.dominio.enums import EstadoPago
    from app.dominio.modelos import Pago
    fila = db_session.get(Pago, pago["id"])
    assert fila.estado_pago == EstadoPago.PENDIENTE_VALIDACION
    assert fila.validado_por_persona_id is None


def test_pago_validar_dto_no_declara_ningun_campo_de_autor():
    """Chequeo estático: `PagoValidarDTO` no debe declarar NINGÚN campo de
    autor/admin como parte de su contrato -- si alguien lo agregara a
    futuro, este test lo detecta aunque el fix de abajo (Pydantic ignora
    extras) lo siga tolerando en runtime."""
    from app.servicios_negocio.dtos.membresia_pago_schemas import PagoValidarDTO

    campos = set(PagoValidarDTO.model_fields)
    assert "validado_por_persona_id" not in campos
    assert "actor_persona_id" not in campos
    assert "admin_persona_id" not in campos


def test_validar_pago_no_acepta_autor_enviado_por_el_cliente(client):
    """Un cliente que mande `validado_por_persona_id` (o `actor_persona_id`)
    en el body lo pierde en silencio (Pydantic ignora extras, ver el
    chequeo estático de arriba) -- el autor real sigue siendo el del token,
    nunca el del payload."""
    admin = _crear_persona(client, cedula_valida(910))
    otra_persona = _crear_persona(client, cedula_valida(911))
    _, pago = _armar_pago_pendiente(client, cedula_valida(912))

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={
            "estado_pago": "APROBADO",
            "validado_por_persona_id": otra_persona["id"],
            "actor_persona_id": otra_persona["id"],
            # Issue #459: TRANSFERENCIA sin voucher, ver comentario arriba.
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["validadoPorPersonaId"] == admin["id"]
