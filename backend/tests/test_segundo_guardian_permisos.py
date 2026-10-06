"""
Issue #1666: matriz de permisos del segundo guardián, endpoint por endpoint.

Una fila por endpoint con chequeo de propiedad sobre una persona, una columna
por actor -- representante principal (P), segundo guardián (S), adulto sin
vínculo (X) y administrador (A) --, todo por la API pública. La matriz de
referencia está en `odd/tasks/1666-second-guardian.md` (`## Permission matrix`).

Decisión del dueño (2026-10-05): el segundo guardián tiene los permisos del
principal (ver, pagar, subir comprobantes, editar datos generales) EXCEPTO
firmar o editar la ficha médica y los consentimientos legales, que solo ve.

"Permitido" = la política deja pasar (cualquier status distinto de 401/403: el
cuerpo de cada request es mínimo y el negocio puede responder 4xx por otro
motivo). "Denegado" = 403 exacto. Un adulto sin vínculo recibe 403, no 404.
"""
from datetime import date
from unittest.mock import patch

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoSangre
from app.dominio.modelos import CoRepresentante, FichaMedica
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app
from tests.archivos_validos import jpeg_valido
from tests.fabricas_pagos import (
    asignar_beneficio_api, crear_membresia_api, crear_persona_orm, crear_tipo_membresia_api,
    registrar_pago_api,
)

BASE = "/api/v1"


def _como(persona_id: int, roles: list[str]) -> None:
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": f"p{persona_id}@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


class Escenario:
    """Familia con dos guardianes más un adulto ajeno, todo sembrado."""


@pytest.fixture()
def esc(db_session, client):
    e = Escenario()
    e.principal = crear_persona_orm(db_session, cedula_valida(8100), nombres="Madre", apellidos="Principal")
    e.segundo = crear_persona_orm(db_session, cedula_valida(8101), nombres="Padre", apellidos="Segundo")
    e.ajeno = crear_persona_orm(db_session, cedula_valida(8102), nombres="Tercero", apellidos="Ajeno")
    e.admin = crear_persona_orm(db_session, cedula_valida(8104), nombres="Admin", apellidos="Club")
    e.menor = crear_persona_orm(
        db_session, cedula_valida(8103), nombres="Hijo", apellidos="Principal",
        fecha_nacimiento=date(2015, 3, 3),
    )
    e.menor.representante_id = e.principal.id
    db_session.add(FichaMedica(
        tipo_sangre=TipoSangre.O_POSITIVO, persona_id=e.menor.id, alergias="Ninguna",
        telefono_emergencia="0991112233",
    ))
    db_session.add(CoRepresentante(
        persona_id=e.menor.id, co_representante_id=e.segundo.id,
        creado_por_persona_id=e.principal.id,
    ))
    db_session.commit()

    # Membresía, pago pendiente y cobertura, sembrados como administrador.
    _como(e.admin.id, ["ADMINISTRADOR"])
    tipo = crear_tipo_membresia_api(client)
    e.tipo_id = tipo["id"]
    e.membresia_id = crear_membresia_api(client, e.menor.id, tipo["id"])["id"]
    e.pago_id = registrar_pago_api(client, e.menor.id, e.membresia_id).json()["id"]
    descuento = client.post(
        "/api/v1/descuentos/", json={"nombre": "Becado", "activo": True, "porcentaje": "100.00"},
    ).json()
    asignar_beneficio_api(client, e.menor.id, descuento["id"])
    # Un pago existente pendiente evita que `aplicar-beneficio` opere sobre una
    # membresía sin cobertura previa; la cobertura se otorga como principal.
    _como(e.principal.id, ["REPRESENTANTE"])
    respuesta = client.post(f"{BASE}/membresias/{e.membresia_id}/aplicar-beneficio", json={})
    e.cobertura_id = respuesta.json().get("id") if respuesta.status_code == 201 else None
    return e


ACTORES = ("P", "S", "X", "A")


def _actuar(esc, actor: str) -> None:
    _como(*{
        "P": (esc.principal.id, ["REPRESENTANTE"]),
        "S": (esc.segundo.id, ["REPRESENTANTE"]),
        "X": (esc.ajeno.id, ["REPRESENTANTE"]),
        "A": (esc.admin.id, ["ADMINISTRADOR"]),
    }[actor])


# --- Un callable por endpoint: (client, esc) -> Response ---------------------
def _foto(c, e):
    with patch("app.infraestructura.cloudinary_cliente.subir_foto_perfil", return_value=1700000000):
        return c.post(
            f"{BASE}/personas/{e.menor.id}/foto",
            files={"archivo": ("foto.jpg", jpeg_valido(), "image/jpeg")},
        )


def _voucher(c, e):
    with patch(
        "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
        return_value="https://res.cloudinary.com/test/image/upload/v.jpg",
    ):
        return c.post(
            f"{BASE}/membresias/pagos/{e.pago_id}/voucher",
            files={"archivo": ("voucher.jpg", jpeg_valido(), "image/jpeg")},
        )


ENDPOINTS = {
    "GET /personas/{id}": lambda c, e: c.get(f"{BASE}/personas/{e.menor.id}"),
    "GET /personas/{id}/beneficio": lambda c, e: c.get(f"{BASE}/personas/{e.menor.id}/beneficio"),
    "POST /personas/{id}/foto": _foto,
    "GET /personas/{id}/antecedentes-club": lambda c, e: c.get(f"{BASE}/personas/{e.menor.id}/antecedentes-club"),
    "GET /asistencias/persona/{id}": lambda c, e: c.get(f"{BASE}/asistencias/persona/{e.menor.id}"),
    "GET /asistencias/alumnos/{id}/horarios": lambda c, e: c.get(f"{BASE}/asistencias/alumnos/{e.menor.id}/horarios"),
    "GET /fichas-medicas/persona/{id}": lambda c, e: c.get(f"{BASE}/fichas-medicas/persona/{e.menor.id}"),
    "PATCH /fichas-medicas/persona/{id}": lambda c, e: c.patch(
        f"{BASE}/fichas-medicas/persona/{e.menor.id}", json={"alergias": "Polen"},
    ),
    "GET /membresias/mias?persona_id": lambda c, e: c.get(f"{BASE}/membresias/mias", params={"persona_id": e.menor.id}),
    "GET /membresias/persona/{id}": lambda c, e: c.get(f"{BASE}/membresias/persona/{e.menor.id}"),
    "GET /membresias/{id}": lambda c, e: c.get(f"{BASE}/membresias/{e.membresia_id}"),
    "POST /membresias/pagos": lambda c, e: registrar_pago_api(c, e.menor.id, e.membresia_id),
    "GET /membresias/pagos/{id}": lambda c, e: c.get(f"{BASE}/membresias/pagos/{e.pago_id}"),
    "GET /membresias/pagos/persona/{id}": lambda c, e: c.get(f"{BASE}/membresias/pagos/persona/{e.menor.id}"),
    "GET /membresias/coberturas/persona/{id}": lambda c, e: c.get(f"{BASE}/membresias/coberturas/persona/{e.menor.id}"),
    "GET /membresias/coberturas/{id}/comprobante": lambda c, e: c.get(
        f"{BASE}/membresias/coberturas/{e.cobertura_id or 999999}/comprobante",
    ),
    "POST /membresias/pagos/{id}/voucher": _voucher,
    "POST /membresias/representado/pago": lambda c, e: c.post(
        f"{BASE}/membresias/representado/pago",
        json={"persona_id": e.menor.id, "tipo_membresia_id": e.tipo_id, "tipo_pago": "TRANSFERENCIA", "meses": 1},
    ),
    "POST /membresias/{id}/aplicar-beneficio": lambda c, e: c.post(
        f"{BASE}/membresias/{e.membresia_id}/aplicar-beneficio", json={},
    ),
}

#: Excepciones a "P, S y A permitidos; X denegado". El resto de la matriz es
#: la regla general: lo que el principal puede hacer, el segundo guardián
#: también.
ESPERADO = {
    # S2: el segundo guardián NO edita la ficha médica.
    "PATCH /fichas-medicas/persona/{id}": {"P": True, "S": False, "X": False, "A": True},
    # Solo el rol REPRESENTANTE inscribe a un representado (sin cambio).
    "POST /membresias/representado/pago": {"P": True, "S": True, "X": False, "A": False},
    # Autoservicio del pagador: dueño o guardián, no admin (sin cambio).
    "POST /membresias/{id}/aplicar-beneficio": {"P": True, "S": True, "X": False, "A": False},
}
REGLA_GENERAL = {"P": True, "S": True, "X": False, "A": True}


def _casos():
    for nombre in ENDPOINTS:
        for actor in ACTORES:
            yield pytest.param(nombre, actor, id=f"{nombre}|{actor}")


@pytest.mark.parametrize("nombre,actor", list(_casos()))
def test_matriz_de_permisos(client, esc, nombre, actor):
    permitido = ESPERADO.get(nombre, REGLA_GENERAL)[actor]
    _actuar(esc, actor)
    respuesta = ENDPOINTS[nombre](client, esc)
    if permitido:
        assert respuesta.status_code not in (401, 403), (nombre, actor, respuesta.text)
        assert respuesta.status_code < 500, (nombre, actor, respuesta.text)
    else:
        assert respuesta.status_code == 403, (nombre, actor, respuesta.status_code, respuesta.text)


def test_la_cobertura_de_la_matriz_existe(esc):
    """El escenario siembra una cobertura real: sin ella la fila del recibo
    probaría un 404 en vez de la política."""
    assert esc.cobertura_id is not None


# --- Respuestas con contenido: el segundo guardián recibe LOS DATOS ----------
def test_el_segundo_guardian_lee_la_ficha_y_el_perfil_del_menor(client, esc):
    _actuar(esc, "S")
    assert client.get(f"{BASE}/fichas-medicas/persona/{esc.menor.id}").json()["alergias"] == "Ninguna"
    assert client.get(f"{BASE}/personas/{esc.menor.id}").json()["id"] == esc.menor.id


def test_el_segundo_guardian_paga_y_edita_datos_generales(client, esc):
    _actuar(esc, "S")
    assert _voucher(client, esc).status_code == 201
    assert _foto(client, esc).status_code == 200


def test_la_ficha_del_menor_no_cambia_cuando_el_segundo_guardian_intenta_editarla(client, db_session, esc):
    _actuar(esc, "S")
    assert ENDPOINTS["PATCH /fichas-medicas/persona/{id}"](client, esc).status_code == 403
    db_session.expire_all()
    assert db_session.query(FichaMedica).filter_by(persona_id=esc.menor.id).one().alergias == "Ninguna"


# --- Portal, listado de representados, notificaciones, compuerta -------------
def test_portal_y_representados_incluyen_al_menor_para_ambos_guardianes(client, esc):
    for actor, persona in (("P", esc.principal), ("S", esc.segundo)):
        _actuar(esc, actor)
        portal = client.get(f"{BASE}/portal/alumno/{persona.id}")
        assert portal.status_code == 200, (actor, portal.text)
        assert [r["persona"]["id"] for r in portal.json()["representados"]] == [esc.menor.id]
        lista = client.get(f"{BASE}/personas/{persona.id}/representados")
        assert [p["id"] for p in lista.json()] == [esc.menor.id]


def test_el_adulto_ajeno_no_ve_al_menor_en_su_portal_ni_abre_el_de_otro(client, esc):
    _actuar(esc, "X")
    propio = client.get(f"{BASE}/portal/alumno/{esc.ajeno.id}")
    assert propio.status_code == 200 and propio.json()["representados"] == []
    assert client.get(f"{BASE}/portal/alumno/{esc.principal.id}").status_code == 403
    assert client.get(f"{BASE}/portal/alumno/{esc.segundo.id}").status_code == 403
    assert client.get(f"{BASE}/personas/{esc.principal.id}/representados").status_code == 403


def test_el_segundo_guardian_no_abre_el_portal_del_principal(client, esc):
    _actuar(esc, "S")
    assert client.get(f"{BASE}/portal/alumno/{esc.principal.id}").status_code == 403
    assert client.get(f"{BASE}/personas/{esc.principal.id}/representados").status_code == 403


def test_la_compuerta_de_activacion_se_cumple_con_el_menor_del_segundo_guardian(db_session, esc):
    """`alta_presencial_completada`: la membresía vive en el menor, así que el
    segundo guardián la satisface igual que el principal (issue #1194) -- y deja
    de hacerlo en cuanto se retira el vínculo."""
    from app.dominio.enums import EstadoMembresia
    from app.dominio.modelos import Membresia
    db_session.query(Membresia).filter_by(id=esc.membresia_id).update({"estado": EstadoMembresia.ACTIVA})
    db_session.commit()
    assert GestorAutenticacion.alta_presencial_completada(db_session, esc.principal.id) is True
    assert GestorAutenticacion.alta_presencial_completada(db_session, esc.segundo.id) is True
    assert GestorAutenticacion.alta_presencial_completada(db_session, esc.ajeno.id) is False
    db_session.query(CoRepresentante).filter_by(persona_id=esc.menor.id).delete()
    db_session.commit()
    assert GestorAutenticacion.alta_presencial_completada(db_session, esc.segundo.id) is False


# --- Revocación inmediata ----------------------------------------------------
def test_quitar_el_vinculo_corta_el_acceso_en_la_siguiente_llamada(client, db_session, esc):
    _actuar(esc, "S")
    assert client.get(f"{BASE}/personas/{esc.menor.id}").status_code == 200
    db_session.query(CoRepresentante).filter_by(persona_id=esc.menor.id).delete()
    db_session.commit()
    for nombre in ("GET /personas/{id}", "GET /fichas-medicas/persona/{id}", "GET /membresias/pagos/persona/{id}"):
        assert ENDPOINTS[nombre](client, esc).status_code == 403, nombre
