"""Reasignación administrativa atómica de representación (#1133 / #1137).

`RelacionRepresentacionServicio.reasignar_presencial` reemplaza al
representante de un menor, SOLO desde un administrador con la persona
enfrente (decisión del dueño de 2026-09-11, punto 2: "sí, la ejecuta un
administrador con la persona presente"). La suite ancla los locks
deterministas (objetivo, ex y nuevo ascendente por `persona.id`, luego las
cuentas), las validaciones de dominio sobre filas ya bloqueadas (destino
mayor de edad, con teléfono válido, cuenta alcanzable y con el rol
REPRESENTANTE si tiene cuenta -- issue #1133, decisión del dueño), el
conflicto por estado observado obsoleto, el reintento idempotente, la
auditoría `REASIGNACION`/`ADMIN_PRESENCIAL`, el epoch SOLO del ex
representante y la defensa real de la base contra un servicio bypasseado
(`test_representacion_triggers.py`/`test_rol_representante_triggers.py`).
"""
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.excepciones import (
    ConflictoConcurrencia, EntidadNoEncontrada, OperacionInvalida,
)
from app.dominio.modelos import (
    Notificacion, Persona, Rol, Usuario, VinculacionRepresentante,
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


def _representante(db_session, seed: int, *, telefono: str = "0998765432",
                    con_rol: bool = True) -> tuple[Persona, Usuario]:
    persona = Persona(
        nombres="Rita", apellidos="Representante", cedula=cedula_valida(seed),
        fecha_nacimiento=date(1988, 3, 20), telefono=telefono,
    )
    db_session.add(persona)
    db_session.flush()
    roles = [Rol(tipo_rol=TipoRol.REPRESENTANTE, descripcion="Representante")] if con_rol else []
    usuario = Usuario(
        correo=f"rep{seed}@test.com", contrasenia="hash", persona_id=persona.id,
        correo_verificado=True, roles=roles,
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
    """Admin, ex representante (viejo, con rol), nuevo destino (con rol) y
    menor vinculado."""
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


# --- El validador de dominio decide: rechazos sin mutación -------------------


def test_rechaza_un_destino_menor_sin_mutar(db_session):
    admin = _admin(db_session)
    viejo, _ = _representante(db_session, 402)
    menor = _menor_vinculado(db_session, 403, viejo.id)
    destino_menor = _menor_vinculado(db_session, 410, viejo.id)

    with pytest.raises(OperacionInvalida, match="mayor de edad"):
        _reasignar(db_session, admin, menor, nuevo=destino_menor, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == viejo.id
    assert db_session.query(VinculacionRepresentante).count() == 0


def test_rechaza_un_destino_sin_el_rol_representante(db_session):
    """Issue #1133, decisión del dueño: una cuenta sin el rol REPRESENTANTE
    no puede recibir representados, ni siquiera por reasignación."""
    admin = _admin(db_session)
    viejo, _ = _representante(db_session, 402)
    nuevo_sin_rol, _ = _representante(db_session, 425, con_rol=False)
    menor = _menor_vinculado(db_session, 403, viejo.id)

    with pytest.raises(OperacionInvalida, match="rol de Representante"):
        _reasignar(db_session, admin, menor, nuevo=nuevo_sin_rol, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == viejo.id
    assert db_session.query(VinculacionRepresentante).count() == 0


def test_destino_sin_cuenta_propia_es_aceptado(db_session):
    """Issue #1133, decisión del dueño (punto 6): un tutor cargado a mano,
    sin cuenta, sigue permitido -- la regla del rol aplica cuando la cuenta
    existe."""
    admin = _admin(db_session)
    viejo, _ = _representante(db_session, 402)
    menor = _menor_vinculado(db_session, 403, viejo.id)
    tutor_sin_cuenta = Persona(
        nombres="Marcela", apellidos="Vega", cedula=cedula_valida(426),
        fecha_nacimiento=date(1988, 7, 1), telefono="0991230000",
    )
    db_session.add(tutor_sin_cuenta)
    db_session.commit()

    resultado = _reasignar(db_session, admin, menor, nuevo=tutor_sin_cuenta, actual=viejo.id)

    assert resultado["representante_nuevo_id"] == tutor_sin_cuenta.id
    db_session.refresh(menor)
    assert menor.representante_id == tutor_sin_cuenta.id


# --- Guardarraíles del propio comando: no-op y auto-referencia --------------
# Hallazgo de verificación independiente (2026-09-11): ninguno de los dos
# necesita ninguna fila bloqueada -- son comparaciones de ids del propio
# comando -- así que se rechazan ANTES de pedir cualquier lock o escribir
# nada.


def test_rechaza_reasignacion_sin_cambio_sin_mutar(db_session):
    """`nuevo_representante_id == representante_actual_id` no es una
    reasignación: dejarlo pasar bloqueaba filas y revocaba la sesión de un
    representante que sigue representando a la misma persona."""
    admin, viejo, usuario_viejo, _, _, menor = _escenario(db_session)

    with pytest.raises(OperacionInvalida, match="mismo que el actual"):
        _reasignar(db_session, admin, menor, nuevo=viejo, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == viejo.id
    assert db_session.query(VinculacionRepresentante).count() == 0
    db_session.refresh(usuario_viejo)
    assert usuario_viejo.version_sesion == 1


def test_rechaza_autoreferencia_sin_mutar(db_session):
    """`nuevo_representante_id == persona_id`: una persona no puede ser su
    propio representante. El trigger de base también lo rechaza, pero acá
    llega como un 422 legible ANTES de bloquear nada -- no el
    `IntegrityError` genérico traducido a 409."""
    admin, viejo, _, _, _, menor = _escenario(db_session)

    with pytest.raises(OperacionInvalida, match="propio representante"):
        _reasignar(db_session, admin, menor, nuevo=menor, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == viejo.id
    assert db_session.query(VinculacionRepresentante).count() == 0


def test_rechaza_un_ciclo_de_representacion(db_session):
    """Ciclo de dos: A representa a B (B.representante_id = A), y se pide
    reasignar al representante DE A hacia B -- cerraría A -> B -> A.

    Ninguna de las dos puntas puede ser adulta y menor a la vez por el
    camino normal, así que se construye con el mismo patrón "envejecido en
    el sitio" que `test_representacion_triggers.py`
    (`test_sql_directo_rechaza_reenlazar_a_un_adulto`): B nace MENOR
    vinculado a A (alta válida) y después se lo envejece por SQL crudo,
    tocando solo `fecha_nacimiento` -- la columna que el trigger no vigila
    -- para que pase la validación de dominio del servicio (destino mayor de
    edad) sin haber pasado nunca por un alta de adulto.

    El servicio no duplica el CTE recursivo del trigger para detectar
    ciclos de más de un salto: se deja que
    `trg_relacion_representacion_valida` (`i1141relinteg`) lo rechace y el
    `IntegrityError` suba sin traducir (mismo criterio que
    `test_la_base_rechaza_lo_que_el_servicio_no_valida`)."""
    admin = _admin(db_session)
    # C: representante actual de A (cualquier adulto con cuenta y rol válido).
    representante_actual, _ = _representante(db_session, 460)
    # A: menor representado por `representante_actual`, y a la vez el
    # representante de B (representante_id de B apunta a A.id).
    a = _menor_vinculado(db_session, 461, representante_actual.id)
    # B: nace MENOR vinculado a A (alta válida -- A ya tiene representante_id
    # fijado a `representante_actual` en este punto, así que el alta de B no
    # cierra ningún ciclo todavía).
    b = _menor_vinculado(db_session, 462, a.id)
    # Envejecer a B por SQL crudo: la columna que cambia (`fecha_nacimiento`)
    # no es la que vigila el trigger (`UPDATE OF representante_id`), así que
    # b.representante_id sigue siendo a.id -- exactamente el estado "adulto
    # con vínculo legado" que un alta real nunca podría producir.
    from sqlalchemy import text

    db_session.execute(text(
        "UPDATE persona SET fecha_nacimiento = CAST('1990-01-01' AS date)"
        " WHERE id = :pid"
    ), {"pid": b.id})
    db_session.commit()
    db_session.add(Usuario(
        correo="ciclo-b@test.com", contrasenia="hash", persona_id=b.id,
        correo_verificado=True,
        roles=[Rol(tipo_rol=TipoRol.REPRESENTANTE, descripcion="Representante")],
    ))
    db_session.commit()
    db_session.refresh(b)

    with pytest.raises(IntegrityError, match="ciclo"):
        _reasignar(db_session, admin, a, nuevo=b, actual=representante_actual.id)

    db_session.refresh(a)
    assert a.representante_id == representante_actual.id
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
    # El destino NUEVO se crea PRIMERO (id bajo) y el VIEJO después (id
    # alto): el orden ascendente difiere del orden de descubrimiento.
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
    """Aunque se salteen las validaciones de dominio del servicio, el trigger
    `trg_relacion_representacion_valida` (`i1141relinteg`) rechaza el destino
    sin teléfono válido y el comando revierte entero."""
    from sqlalchemy import text

    admin, viejo, _, nuevo, _, menor = _escenario(db_session)
    # Truthy para no chocar con `not destino.telefono` del lado del servicio
    # (que este test saltea abajo), pero sin la forma que exige el trigger.
    db_session.execute(text(
        "UPDATE persona SET telefono = 'invalido' WHERE id = :pid"
    ), {"pid": nuevo.id})
    db_session.commit()

    from app.servicios_negocio import relacion_representacion_servicio as rrs

    monkeypatch.setattr(rrs, "es_telefono_valido", lambda telefono: True)

    with pytest.raises(IntegrityError):
        _reasignar(db_session, admin, menor, nuevo=nuevo, actual=viejo.id)

    db_session.refresh(menor)
    assert menor.representante_id == viejo.id
    assert db_session.query(VinculacionRepresentante).count() == 0


def test_persona_inexistente_da_entidad_no_encontrada(db_session):
    admin = _admin(db_session)
    # `nuevo` distinto de `actual` y de la persona objetivo -- ninguno de los
    # dos guardarraíles del comando (no-op, auto-referencia) debe interceptar
    # este caso antes de que el lock descubra que la persona no existe.
    with pytest.raises(EntidadNoEncontrada):
        _reasignar(db_session, admin, Persona(id=999999),
                   nuevo=Persona(id=999998), actual=1)


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
    # `nuevo_representante_id` distinto de `representante_actual_id`: el
    # guardarraíl de no-op corre ANTES de cualquier lock y no debe
    # interceptar este caso, que quiere probar la persona inexistente.
    resp = client.post(
        "/api/v1/personas/999999/reasignar-representante",
        json={
            "nuevo_representante_id": 2,
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
