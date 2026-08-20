"""
Excepción auditada: aprobar una TRANSFERENCIA sin comprobante (issue #459).

Antes de este fix, `PATCH /pagos/{id}/validar` aprobaba CUALQUIER pago
PENDIENTE_VALIDACION sin mirar si tenía voucher adjunto -- el único gate
vivía en el frontend (dos checkboxes de autoatestación, sin ninguna
validación real detrás), así que una transferencia sin ningún comprobante
podía terminar APROBADA sin dejar ningún rastro de por qué.

Decisión de producto (no se reabre acá):
  1. Una TRANSFERENCIA puede aprobarse sin voucher si el admin verificó la
     cuenta bancaria directamente -- permitido como EXCEPCIÓN AUDITADA, no
     un camino silencioso.
  2. Esa excepción requiere motivo Y autoría (issue #458), AMBOS
     obligatorios.

Alcance deliberadamente angosto -- ver el docstring de
`PagoServicio.validar_pago`:
  - Solo se exige al APROBAR. Rechazar nunca activa nada; no hay nada que
    auditar ahí.
  - Solo aplica a TRANSFERENCIA. Un EFECTIVO sin comprobante es el camino
    NORMAL (issue #452), no una excepción.
  - No aplica si el pago YA tiene voucher (el camino de siempre, sin
    cambios).
"""
from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Pago
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app


# --- helpers locales (mismo esquema que test_autoria_validar_pago.py) ------

def _crear_persona(client, cedula, fecha_nacimiento="1990-01-01"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": fecha_nacimiento, "telefono": "0991234567",
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


def _crear_pago_transferencia_pendiente(client, persona_id, membresia_id):
    """Registra un pago TRANSFERENCIA -- nunca adjunta voucher (eso es un
    endpoint separado, `POST /pagos/{id}/voucher`): queda PENDIENTE_
    VALIDACION sin comprobante, exactamente el escenario que este issue
    ataca."""
    return client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "TRANSFERENCIA",
            "persona_id": persona_id, "membresia_id": membresia_id,
        },
    ).json()


def _armar_transferencia_pendiente(client, cedula):
    persona = _crear_persona(client, cedula)
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago_transferencia_pendiente(client, persona["id"], membresia["id"])
    return persona, pago


def _autenticar_como(persona_id: int, roles: list[str]):
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": f"persona-{persona_id}@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _adjuntar_voucher_directo(db_session, pago_id: int) -> None:
    """Setea `voucher_url` directo por ORM, sin pasar por Cloudinary: a esta
    suite le interesa la regla de negocio de `validar_pago` (¿hay o no hay
    voucher?), no la mecánica de subida -- ya cubierta por
    `test_voucher_pago.py`."""
    fila = db_session.get(Pago, pago_id)
    fila.voucher_url = "voucher-fake-existente"
    fila.voucher_formato = "image/jpeg"
    db_session.commit()


# --- RED: hoy (antes del fix) esto se aprobaba igual; con el fix, se
# rechaza limpio -----------------------------------------------------------

def test_aprobar_transferencia_sin_voucher_y_sin_motivo_se_rechaza(client, db_session):
    """El caso central del issue: TRANSFERENCIA PENDIENTE_VALIDACION, sin
    voucher, se intenta aprobar sin indicar el motivo de la excepción -->
    400, y el pago NO queda aprobado (ni la membresía activada) por el
    intento fallido."""
    admin = _crear_persona(client, cedula_valida(950))
    _, pago = _armar_transferencia_pendiente(client, cedula_valida(951))
    assert pago["voucherUrl"] is None

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp.status_code == 400

    from app.dominio.enums import EstadoPago
    fila = db_session.get(Pago, pago["id"])
    assert fila.estado_pago == EstadoPago.PENDIENTE_VALIDACION
    assert fila.motivo_excepcion_sin_comprobante is None
    assert fila.validado_por_persona_id is None


# --- GREEN: con motivo, la excepción se aprueba y queda auditada -----------

def test_aprobar_transferencia_sin_voucher_con_motivo_aprueba_y_audita(client, db_session):
    admin = _crear_persona(client, cedula_valida(952))
    _, pago = _armar_transferencia_pendiente(client, cedula_valida(953))

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Depósito verificado en la cuenta del club el 18/08.",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["estadoPago"] == "APROBADO"
    # Expuesto en el DTO de respuesta (issue #459, criterio 3): visible en
    # el historial del pago, no solo auditable leyendo la base directo.
    assert body["motivoExcepcionSinComprobante"] == (
        "Depósito verificado en la cuenta del club el 18/08."
    )
    assert body["validadoPorPersonaId"] == admin["id"]

    fila = db_session.get(Pago, pago["id"])
    assert fila.motivo_excepcion_sin_comprobante == (
        "Depósito verificado en la cuenta del club el 18/08."
    )
    assert fila.validado_por_persona_id == admin["id"]


# --- TRIANGULATE 1: aprobar CON voucher sigue funcionando sin pedir motivo
# extra (no romper el camino normal) ----------------------------------------

def test_aprobar_transferencia_con_voucher_no_requiere_motivo(client, db_session):
    admin = _crear_persona(client, cedula_valida(954))
    _, pago = _armar_transferencia_pendiente(client, cedula_valida(955))
    _adjuntar_voucher_directo(db_session, pago["id"])

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["estadoPago"] == "APROBADO"
    # Ningún motivo se inventa ni se persiste: este NO es el camino de la
    # excepción, es el camino de siempre (revisar el voucher adjunto).
    assert body["motivoExcepcionSinComprobante"] is None

    fila = db_session.get(Pago, pago["id"])
    assert fila.motivo_excepcion_sin_comprobante is None


def test_motivo_enviado_de_mas_se_descarta_si_el_pago_tenia_voucher(client, db_session):
    """Un motivo enviado quese descarta cuando no aplica (el pago sí tenía
    voucher): la columna solo debe significar "esta aprobación fue la
    excepción auditada", nunca un dato suelto sin relación con lo que
    realmente pasó."""
    admin = _crear_persona(client, cedula_valida(956))
    _, pago = _armar_transferencia_pendiente(client, cedula_valida(957))
    _adjuntar_voucher_directo(db_session, pago["id"])

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Motivo irrelevante, el pago sí tenía voucher.",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["motivoExcepcionSinComprobante"] is None

    fila = db_session.get(Pago, pago["id"])
    assert fila.motivo_excepcion_sin_comprobante is None


# --- TRIANGULATE 2: rechazar sin voucher NO exige el motivo de la
# excepción -- rechazar no activa nada, no hay nada que auditar -------------

def test_rechazar_transferencia_sin_voucher_no_exige_motivo_de_excepcion(client, db_session):
    admin = _crear_persona(client, cedula_valida(958))
    _, pago = _armar_transferencia_pendiente(client, cedula_valida(959))

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Sin comprobante ni respuesta del socio"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["estadoPago"] == "RECHAZADO"
    assert body["motivoExcepcionSinComprobante"] is None

    from app.dominio.enums import EstadoPago
    fila = db_session.get(Pago, pago["id"])
    assert fila.estado_pago == EstadoPago.RECHAZADO
    assert fila.motivo_excepcion_sin_comprobante is None


# --- TRIANGULATE 3: motivo vacío o solo espacios se rechaza ----------------

def test_motivo_excepcion_solo_espacios_se_rechaza_422(client, db_session):
    """Un motivo PRESENTE pero en blanco es un error de forma del payload
    (nivel DTO, `PagoValidarDTO._validar_campos`) -- 422, no 400. Distinto
    del caso "no se mandó ningún motivo" (nivel de negocio, necesita leer
    el `Pago` real para saber si hace falta -- ver el test 400 de arriba)."""
    admin = _crear_persona(client, cedula_valida(960))
    _, pago = _armar_transferencia_pendiente(client, cedula_valida(961))

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO", "motivo_excepcion_sin_comprobante": "   "},
    )
    assert resp.status_code == 422

    from app.dominio.enums import EstadoPago
    fila = db_session.get(Pago, pago["id"])
    assert fila.estado_pago == EstadoPago.PENDIENTE_VALIDACION


# --- TRIANGULATE 4: EFECTIVO -- alcance correcto (issue #452: el voucher
# nunca aplicó a pagos en efectivo, así que su ausencia no es una
# excepción que requiera justificarse) ---------------------------------------

def test_aprobar_efectivo_sin_comprobante_no_requiere_motivo(client, db_session):
    """Un pago EFECTIVO nunca lleva voucher (no tiene sentido para dinero
    entregado en persona, issue #452) -- aprobarlo sin comprobante es el
    camino NORMAL, no la excepción auditada de este issue."""
    # Ambas personas (y la membresía) se crean ANTES de bajar el token del
    # `client` a ALUMNO: `POST /personas/` en sí requiere ADMINISTRADOR
    # (el `client` del fixture ya lo es por defecto), así que crear al admin
    # DESPUÉS de autenticarse como el socio fallaría por permisos.
    socio = _crear_persona(client, cedula_valida(962), fecha_nacimiento="1990-01-01")
    admin = _crear_persona(client, cedula_valida(963))
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, socio["id"], tipo["id"])

    # EFECTIVO solo puede registrarlo el propio socio o su representante
    # (`PagoServicio.registrar_pago`) -- el `client` del fixture es admin
    # por defecto, así que hace falta autenticarse como el propio socio acá.
    _autenticar_como(socio["id"], ["ALUMNO"])
    pago = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "EFECTIVO",
            "persona_id": socio["id"], "membresia_id": membresia["id"],
        },
    ).json()
    assert pago["voucherUrl"] is None

    _autenticar_como(admin["id"], ["ADMINISTRADOR"])
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["estadoPago"] == "APROBADO"
    assert body["motivoExcepcionSinComprobante"] is None

    fila = db_session.get(Pago, pago["id"])
    assert fila.motivo_excepcion_sin_comprobante is None
