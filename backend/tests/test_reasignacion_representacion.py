"""Reasignación administrativa atómica de representación (#1133 / #1137, PR4c1).

`RelacionRepresentacionServicio.reasignar_presencial` es el TERCER comando del
contrato del diseño: reemplaza al representante de un menor, SOLO desde un
administrador con la persona enfrente. La suite ancla el validador compartido de
PR 4b, los locks deterministas (objetivo, ex y nuevo ascendente por `persona.id`,
luego las cuentas), el conflicto por estado observado obsoleto, el reintento
idempotente, la auditoría `REASIGNACION`/`ADMIN_PRESENCIAL`, el epoch SOLO del ex
representante y la defensa real de la base contra un servicio bypasseado.
"""
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import (
    ConflictoConcurrencia, EntidadNoEncontrada, OperacionInvalida,
)
from app.dominio.modelos import (
    Notificacion, Persona, Usuario, VinculacionRepresentante,
)
from app.servicios_negocio.dtos.persona_schemas import ReasignarRepresentacionDTO
from app.servicios_negocio.relacion_representacion_servicio import (
    RelacionRepresentacionServicio,
)


CLAVE = "reasignacion-test-0001"


# --- helpers -----------------------------------------------------------------


def _admin(db_session, seed: int = 300) -> Persona:
    admin = Persona(
        nombres="Ada", apellidos="Administradora", cedula=cedula_valida(seed),
        fecha_nacimiento=date(1980, 1, 1), telefono="0990000001",
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


def _representante(db_session, seed: int, *, telefono: str = "0998765432") -> tuple[Persona, Usuario]:
    persona = Persona(
        nombres="Rita", apellidos="Representante", cedula=cedula_valida(seed),
        fecha_nacimiento=date(1988, 3, 20), telefono=telefono,
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo=f"rep{seed}@test.com", contrasenia="hash", persona_id=persona.id,
        correo_verificado=True,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(persona)
    db_session.refresh(usuario)
    return persona, usuario


def _menor_vinculado(db_session, seed: int, representante_id: int) -> Persona:
    menor = Persona(
        nombres="Mateo", apellidos="Menor", cedula=cedula_valida(seed),
        fecha_nacimiento=date(2020, 5, 14), telefono="0991234567",
        representante_id=representante_id,
    )
    db_session.add(menor)
    db_session.commit()
    db_session.refresh(menor)
    return menor


def _comando(nuevo_representante_id: int, representante_actual_id: int) -> ReasignarRepresentacionDTO:
    return ReasignarRepresentacionDTO(
        nuevo_representante_id=nuevo_representante_id,
        representante_actual_id=representante_actual_id,
        evidencia_identidad="cédula verificada en mostrador",
    )


def _reasignar(db_session, admin: Persona, persona: Persona, *, nuevo: Persona,
               actual: int, clave: str = CLAVE,
               comando: ReasignarRepresentacionDTO | None = None) -> dict:
    return RelacionRepresentacionServicio(db_session).reasignar_presencial(
        admin_actor_id=admin.id, persona_id=persona.id,
        comando=comando or _comando(nuevo.id, actual), idempotency_key=clave,
    )


def _escenario(db_session):
    """Admin, ex representante (viejo), nuevo destino y menor vinculado."""
    admin = _admin(db_session)
    nuevo, usuario_nuevo = _representante(db_session, 401)
    viejo, usuario_viejo = _representante(db_session, 402)
    menor = _menor_vinculado(db_session, 403, viejo.id)
    return admin, viejo, usuario_viejo, nuevo, usuario_nuevo, menor


# --- Camino feliz: reemplazo atómico + auditoría -----------------------------


def test_reasigna_atomicamente_y_audita(db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)

    resultado = _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    assert resultado["persona_id"] == menor.id
    assert resultado["representante_anterior_id"] == viejo.id
    assert resultado["representante_nuevo_id"] == nuevo.id
    assert resultado["replay"] is False
    assert "access_token" not in resultado

    db_session.refresh(menor)
    assert menor.representante_id == nuevo.id

    evento = db_session.query(VinculacionRepresentante).one()
    assert evento.operacion == "REASIGNACION"
    assert evento.origen == "ADMIN_PRESENCIAL"
    assert evento.actor_persona_id == admin.id
    assert evento.persona_id == menor.id
    assert evento.representante_anterior_id == viejo.id
    assert evento.representante_nuevo_id == nuevo.id
    assert evento.idempotency_key == CLAVE
    assert len(evento.request_fingerprint) == 64
    assert evento.fecha is not None


def test_el_comando_invoca_el_validador_compartido(db_session, monkeypatch):
    """El comando NO reimplementa invariantes: delega en `validar_enlace` de
    PR4b con las filas ya bloqueadas."""
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)

    original = RelacionRepresentacionServicio.validar_enlace
    llamadas: list[dict] = []

    def espia(self, **kwargs):
        llamadas.append(kwargs)
        return original(self, **kwargs)

    monkeypatch.setattr(RelacionRepresentacionServicio, "validar_enlace", espia)
    _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    assert len(llamadas) == 1
    assert llamadas[0]["objetivo"].id == menor.id
    assert llamadas[0]["destino"].id == nuevo.id
    assert llamadas[0]["enlace_actual"] == viejo.id


# --- El validador decide: rechazos sin mutación ------------------------------


def test_rechaza_un_destino_menor_sin_mutar(db_session):
    admin, viejo, _, _, _, menor = _escenario(db_session)
    destino_menor = _menor_vinculado(db_session, 410, viejo.id)

    with pytest.raises(OperacionInvalida, match="debe ser mayor de edad"):
        _reasignar(db_session, admin, menor, nuevo=destino_menor, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == viejo.id
    assert db_session.query(VinculacionRepresentante).count() == 0


# --- Conflicto por estado obsoleto y reintento idempotente -------------------


def test_el_observado_obsoleto_pierde_la_carrera(db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    otro, _ = _representante(db_session, 420)

    _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    with pytest.raises(ConflictoConcurrencia):
        _reasignar(db_session, admin, menor, nuevo=otro, actual=viejo.id,
                   clave="clave-perdedora")

    db_session.refresh(menor)
    assert menor.representante_id == nuevo.id
    assert db_session.query(VinculacionRepresentante).count() == 1


def test_reintento_idempotente_devuelve_el_resultado_establecido(db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)

    primero = _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)
    segundo = _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    assert primero["replay"] is False
    assert segundo["replay"] is True
    assert segundo["representante_nuevo_id"] == nuevo.id
    assert db_session.query(VinculacionRepresentante).count() == 1
    db_session.refresh(menor)
    assert menor.representante_id == nuevo.id


def test_clave_reusada_con_otro_comando_conflicta(db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    otro, _ = _representante(db_session, 421)

    _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    with pytest.raises(ConflictoConcurrencia):
        _reasignar(db_session, admin, menor, nuevo=otro, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == nuevo.id
    assert db_session.query(VinculacionRepresentante).count() == 1


# --- Epoch: solo el ex representante -----------------------------------------


def test_epoch_del_ex_representante_sube_y_el_nuevo_no(db_session):
    admin, viejo, usuario_viejo, nuevo, usuario_nuevo, menor = _escenario(db_session)

    _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    db_session.refresh(usuario_viejo)
    db_session.refresh(usuario_nuevo)
    assert usuario_viejo.version_sesion == 2
    assert usuario_nuevo.version_sesion == 1


# --- Rollback ----------------------------------------------------------------


def test_fallo_antes_del_commit_deja_el_vinculo_y_cero_filas(db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    servicio = RelacionRepresentacionServicio(db_session)
    original = servicio.repo_ledger.registrar

    def _explotar(**kwargs):
        raise RuntimeError("falla de base simulada")

    servicio.repo_ledger.registrar = _explotar
    with pytest.raises(RuntimeError):
        servicio.reasignar_presencial(
            admin_actor_id=admin.id, persona_id=menor.id,
            comando=_comando(nuevo.id, viejo.id), idempotency_key=CLAVE,
        )
    servicio.repo_ledger.registrar = original

    db_session.refresh(menor)
    assert menor.representante_id == viejo.id
    assert db_session.query(VinculacionRepresentante).count() == 0
    assert db_session.query(Notificacion).count() == 0


# --- Locks deterministas -----------------------------------------------------


def test_bloquea_objetivo_ex_y_nuevo_en_orden_ascendente(db_session, monkeypatch):
    from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio

    admin = _admin(db_session)
    # El destino NUEVO se crea PRIMERO (id bajo) y el VIEJO después (id alto):
    # el orden ascendente difiere del orden de descubrimiento.
    nuevo, _ = _representante(db_session, 430)
    viejo, _ = _representante(db_session, 431)
    menor = _menor_vinculado(db_session, 432, viejo.id)

    original = PersonaRepositorio.obtener_por_id_bloqueando
    llamadas: list[int] = []

    def espia(self, persona_id):
        llamadas.append(persona_id)
        return original(self, persona_id)

    monkeypatch.setattr(PersonaRepositorio, "obtener_por_id_bloqueando", espia)
    _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    assert llamadas == sorted([menor.id, viejo.id, nuevo.id])
    assert llamadas == [nuevo.id, viejo.id, menor.id]


def test_emite_for_update_sobre_personas_y_cuentas(db_session, contar_selects):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)

    with contar_selects() as sentencias:
        _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    con_lock = [s for s in sentencias if "FOR UPDATE" in s]
    assert any("persona" in s for s in con_lock), con_lock
    assert any("usuario" in s for s in con_lock), con_lock


# --- Triangulación con el candado real de la base ----------------------------


def test_la_base_rechaza_lo_que_el_servicio_no_valida(db_session, monkeypatch):
    """Aunque se saltee el validador del servicio, el candado de la base rechaza
    el destino sin teléfono válido y el comando revierte entero."""
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    db_session.execute(text(
        "UPDATE persona SET telefono = CAST('' AS varchar) WHERE id = :pid"
    ), {"pid": nuevo.id})
    db_session.commit()

    monkeypatch.setattr(
        RelacionRepresentacionServicio, "validar_enlace", lambda self, **kw: None,
    )

    with pytest.raises(IntegrityError):
        _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == viejo.id
    assert db_session.query(VinculacionRepresentante).count() == 0


def test_persona_inexistente_da_entidad_no_encontrada(db_session):
    admin = _admin(db_session)
    with pytest.raises(EntidadNoEncontrada):
        _reasignar(db_session, admin, Persona(id=999999),
                   nuevo=Persona(id=999999), actual=1)


# --- Endpoint: solo administrador -------------------------------------------


def test_endpoint_rechaza_a_quien_no_es_administrador(client_sin_permisos, db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    resp = client_sin_permisos.post(
        f"/api/v1/personas/{menor.id}/reasignar-representante",
        json={
            "nuevo_representante_id": nuevo.id,
            "representante_actual_id": viejo.id,
            "evidencia_identidad": "x",
        },
        headers={"Idempotency-Key": CLAVE},
    )
    assert resp.status_code == 403


def test_endpoint_admin_reasigna_sin_tokens(client, db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    resp = client.post(
        f"/api/v1/personas/{menor.id}/reasignar-representante",
        json={
            "nuevo_representante_id": nuevo.id,
            "representante_actual_id": viejo.id,
            "evidencia_identidad": "cédula verificada en mostrador",
        },
        headers={"Idempotency-Key": CLAVE},
    )
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["persona_id"] == menor.id
    assert cuerpo["representante_anterior_id"] == viejo.id
    assert cuerpo["representante_nuevo_id"] == nuevo.id
    assert "access_token" not in cuerpo
    assert "refresh_token" not in cuerpo
    db_session.refresh(menor)
    assert menor.representante_id == nuevo.id


def test_endpoint_sin_clave_de_idempotencia_da_400(client, db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    resp = client.post(
        f"/api/v1/personas/{menor.id}/reasignar-representante",
        json={
            "nuevo_representante_id": nuevo.id,
            "representante_actual_id": viejo.id,
            "evidencia_identidad": "x",
        },
    )
    assert resp.status_code == 400


def test_endpoint_observado_obsoleto_da_409(client, db_session):
    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    otro, _ = _representante(db_session, 450)
    _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    resp = client.post(
        f"/api/v1/personas/{menor.id}/reasignar-representante",
        json={
            "nuevo_representante_id": otro.id,
            "representante_actual_id": viejo.id,
            "evidencia_identidad": "x",
        },
        headers={"Idempotency-Key": "clave-obsoleta"},
    )
    assert resp.status_code == 409


def test_endpoint_persona_inexistente_da_404(client, db_session):
    resp = client.post(
        "/api/v1/personas/999999/reasignar-representante",
        json={
            "nuevo_representante_id": 1,
            "representante_actual_id": 1,
            "evidencia_identidad": "x",
        },
        headers={"Idempotency-Key": CLAVE},
    )
    assert resp.status_code == 404


# --- DTO del comando ---------------------------------------------------------


def test_dto_exige_nuevo_actual_y_evidencia():
    comando = ReasignarRepresentacionDTO(
        nuevo_representante_id=7, representante_actual_id=3,
        evidencia_identidad="cédula verificada",
    )
    assert comando.nuevo_representante_id == 7
    assert comando.representante_actual_id == 3

    with pytest.raises(Exception):
        ReasignarRepresentacionDTO(nuevo_representante_id=7, representante_actual_id=3)
    with pytest.raises(Exception):
        ReasignarRepresentacionDTO(nuevo_representante_id=7, evidencia_identidad="x")
    with pytest.raises(Exception):
        ReasignarRepresentacionDTO(
            nuevo_representante_id=7, representante_actual_id=3, evidencia_identidad="",
        )
