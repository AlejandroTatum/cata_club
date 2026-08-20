"""
INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1): "Un chico tiene un solo
representante, y el representante lo vincula solo".

Antes no existía ninguna vía (ni endpoint ni pantalla) para pasar una
Persona ya registrada de un representante a otro, pese a que el mensaje de
cédula duplicada se lo prometía al usuario ("el club puede vincularla a su
cuenta"). Este archivo cubre `POST
/personas/{representante_id}/vincular-representado` y
`PersonaServicio.vincular_representado`, con los cuatro guardarraíles de la
decisión:

  1. Auditoría: fila en `VinculacionRepresentante`.
  2. Aviso al representante anterior, después del hecho, vía el feed de
     notificaciones existente.
  3. Anti-enumeración: cédula inexistente, persona no elegible (mayor de
     edad, ya vinculada al mismo representante, o la del propio
     representante) devuelven el MISMO mensaje y el MISMO código HTTP.
  4. Tope de intentos: freno progresivo por representante (mismo patrón que
     `AuthServicio._calcular_retraso_login`, TRA-4).

Sin aprobación de nadie: la decisión de negocio la evaluó y la sostuvo
explícitamente pese al riesgo -- no se re-discute acá.
"""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import OperacionInvalida
from app.dominio.mensajes import MENSAJE_VINCULACION_NO_DISPONIBLE
from app.dominio.modelos import Notificacion, Persona, VinculacionRepresentante
from app.dominio.enums import TipoNotificacion
from app.presentacion.schemas.persona_schemas import VincularRepresentadoDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio import persona_servicio as persona_servicio_modulo
from app.servicios_negocio.persona_servicio import PersonaServicio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _adulto(cedula: str, nombres="Marcela", apellidos="Vega") -> Persona:
    return Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991230000",
    )


def _menor(cedula: str, representante_id: int | None = None, nombres="Lucas", apellidos="Vega") -> Persona:
    return Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(2015, 5, 14), telefono="0991230001",
        representante_id=representante_id,
    )


def _guardado(db_session, persona: Persona) -> Persona:
    """Agrega y hace `flush` de una Persona para poder usar su `.id` real
    (ej. como `representante_id` de otra Persona) antes del `commit` final."""
    db_session.add(persona)
    db_session.flush()
    return persona


def _restaurar_override_token(correo="representante@cataclub.test", persona_id=1, roles=None):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": correo, "persona_id": persona_id, "roles": roles or [],
    }


@pytest.fixture(autouse=True)
def _limpiar_contador_intentos():
    """El contador vive en un dict a nivel de módulo (mismo criterio que
    `AuthServicio._INTENTOS_FALLIDOS_LOGIN`) -- se limpia entre tests para
    que los intentos de un test no se filtren al siguiente."""
    persona_servicio_modulo._INTENTOS_FALLIDOS_VINCULACION.clear()
    yield
    persona_servicio_modulo._INTENTOS_FALLIDOS_VINCULACION.clear()


class _SleeperEspia:
    """Sleeper falso: registra con qué segundos lo llamaron y nunca duerme de
    verdad (BRIEF.md: ningún test hace un sleep real de varios segundos)."""

    def __init__(self):
        self.llamadas = []

    def __call__(self, segundos):
        self.llamadas.append(segundos)


# ---------------------------------------------------------------------------
# Happy path — servicio
# ---------------------------------------------------------------------------

def test_vincular_representado_reasigna_representante_id(db_session):
    representante_anterior = _adulto("1710034065", nombres="Pedro")
    representante_nuevo = _adulto("1710034073", nombres="Marcela")
    menor = _menor(cedula_valida(632), representante_id=None)
    db_session.add_all([representante_anterior, representante_nuevo, menor])
    db_session.commit()

    servicio = PersonaServicio(db_session, dormir=_SleeperEspia())
    resultado = servicio.vincular_representado(
        representante_nuevo.id, VincularRepresentadoDTO(cedula=menor.cedula)
    )

    assert resultado.id == menor.id
    db_session.refresh(menor)
    assert menor.representante_id == representante_nuevo.id


def test_vincular_representado_deja_auditoria(db_session):
    representante_anterior = _guardado(db_session, _adulto("1710034065", nombres="Pedro"))
    representante_nuevo = _adulto("1710034073", nombres="Marcela")
    menor = _menor(cedula_valida(632), representante_id=representante_anterior.id)
    db_session.add_all([representante_nuevo, menor])
    db_session.commit()

    servicio = PersonaServicio(db_session, dormir=_SleeperEspia())
    servicio.vincular_representado(
        representante_nuevo.id, VincularRepresentadoDTO(cedula=menor.cedula)
    )

    filas = db_session.query(VinculacionRepresentante).filter(
        VinculacionRepresentante.persona_id == menor.id
    ).all()
    assert len(filas) == 1
    auditoria = filas[0]
    assert auditoria.representante_anterior_id == representante_anterior.id
    assert auditoria.representante_nuevo_id == representante_nuevo.id
    assert auditoria.fecha is not None


def test_vincular_representado_sin_representante_previo_no_notifica_a_nadie(db_session):
    representante_nuevo = _adulto("1710034073", nombres="Marcela")
    menor = _menor(cedula_valida(632), representante_id=None)
    db_session.add_all([representante_nuevo, menor])
    db_session.commit()

    servicio = PersonaServicio(db_session, dormir=_SleeperEspia())
    servicio.vincular_representado(
        representante_nuevo.id, VincularRepresentadoDTO(cedula=menor.cedula)
    )

    assert db_session.query(Notificacion).count() == 0
    auditoria = db_session.query(VinculacionRepresentante).one()
    assert auditoria.representante_anterior_id is None


# ---------------------------------------------------------------------------
# Guardarraíl 2: aviso al representante anterior, con forma de deshacerlo
# ---------------------------------------------------------------------------

def test_vincular_representado_notifica_al_representante_anterior(db_session):
    representante_anterior = _guardado(db_session, _adulto("1710034065", nombres="Pedro", apellidos="Ruiz"))
    representante_nuevo = _adulto("1710034073", nombres="Marcela")
    menor = _menor(cedula_valida(632), representante_id=representante_anterior.id, nombres="Lucas", apellidos="Vega")
    db_session.add_all([representante_nuevo, menor])
    db_session.commit()

    servicio = PersonaServicio(db_session, dormir=_SleeperEspia())
    servicio.vincular_representado(
        representante_nuevo.id, VincularRepresentadoDTO(cedula=menor.cedula)
    )

    notificaciones = db_session.query(Notificacion).filter(
        Notificacion.persona_id == representante_anterior.id
    ).all()
    assert len(notificaciones) == 1
    notif = notificaciones[0]
    assert notif.tipo == TipoNotificacion.VINCULACION_REPRESENTANTE
    assert notif.entidad_relacionada_id == menor.id
    # El aviso identifica al chico y ofrece una forma de deshacerlo -- el
    # representante anterior YA conocía esta cédula (fue quien la cargó), así
    # que repetirla no es información nueva para él.
    assert "Lucas Vega" in notif.mensaje
    assert menor.cedula in notif.mensaje
    # Auditoría 2026-08-10: el mensaje mandaba a "Vincular un hijo ya
    # registrado", una pantalla que no existe. El camino real es completar
    # "Agregar dependiente" con la misma cédula hasta que salte el error de
    # cédula duplicada, y desde ahí usar "Vincular a mi cuenta"
    # (WizardNavigation, `add-dependent-utils.ts::getLinkExistingErrorMessage`).
    assert "Agregar dependiente" in notif.mensaje
    assert "Vincular un hijo ya registrado" not in notif.mensaje


def test_vincular_representado_con_nombres_largos_no_revienta(db_session):
    """Hallazgo en vivo, 2026-08-11: un nombre y apellido reales (no
    inventados para el test) empujaron este aviso a 372 caracteres -- un
    nombre no tiene tope real (apellidos compuestos, partículas), y amenaza
    directamente el guardarraíl 2 de la decisión de negocio: "al anterior le
    llega el aviso, con forma de deshacerlo". 100+100 son los anchos reales
    de `Persona.nombres`/`apellidos`, el peor caso posible hoy."""
    representante_anterior = _guardado(db_session, _adulto("1710034065", nombres="Pedro", apellidos="Ruiz"))
    representante_nuevo = _adulto("1710034073", nombres="Marcela")
    nombre_largo = "Maria Fernanda Concepcion Esperanza Guadalupe Del Carmen A" * 2
    apellido_largo = "Rodriguez Gonzalez Martinez Fernandez Sanchez De La Torre B" * 2
    nombre_largo, apellido_largo = nombre_largo[:100], apellido_largo[:100]
    menor = _menor(
        cedula_valida(632), representante_id=representante_anterior.id,
        nombres=nombre_largo, apellidos=apellido_largo,
    )
    db_session.add_all([representante_nuevo, menor])
    db_session.commit()

    servicio = PersonaServicio(db_session, dormir=_SleeperEspia())
    # No debe tirar ninguna excepción -- antes de este fix, esto era un
    # DataError sin capturar (VARCHAR(255) de Notificacion.mensaje) con la
    # vinculación YA commiteada.
    servicio.vincular_representado(
        representante_nuevo.id, VincularRepresentadoDTO(cedula=menor.cedula)
    )

    notificaciones = db_session.query(Notificacion).filter(
        Notificacion.persona_id == representante_anterior.id
    ).all()
    assert len(notificaciones) == 1
    notif = notificaciones[0]
    assert notif.tipo == TipoNotificacion.VINCULACION_REPRESENTANTE
    # El nombre completo (201 caracteres) se acorta -- lo que no se pierde es
    # la cédula, con la que el representante anterior identifica al chico
    # igual que lo identificaba antes de este aviso.
    assert menor.cedula in notif.mensaje
    assert "fue vinculado a otra cuenta" in notif.mensaje
    nombre_completo = f"{nombre_largo} {apellido_largo}"
    assert nombre_completo not in notif.mensaje, "el nombre completo (201 caracteres) debe acortarse"
    assert len(notif.mensaje) <= Notificacion.MENSAJE_MAX


# ---------------------------------------------------------------------------
# Guardarraíl 3 (el más importante): anti-enumeración
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "armar_escenario",
    [
        pytest.param(lambda db, rep: None, id="cedula_inexistente"),
        pytest.param(
            lambda db, rep: db.add(_adulto(cedula_valida(630))) or db.commit(),
            id="persona_existe_pero_es_mayor_de_edad",
        ),
        pytest.param(
            lambda db, rep: (
                db.add(_menor(cedula_valida(630), representante_id=rep.id)),
                db.commit(),
            ),
            id="ya_vinculada_al_mismo_representante",
        ),
    ],
)
def test_vincular_representado_rechaza_sin_filtrar_el_motivo(db_session, armar_escenario):
    representante = _adulto("1710034073", nombres="Marcela")
    db_session.add(representante)
    db_session.commit()
    armar_escenario(db_session, representante)

    servicio = PersonaServicio(db_session, dormir=_SleeperEspia())
    with pytest.raises(OperacionInvalida) as excinfo:
        servicio.vincular_representado(
            representante.id, VincularRepresentadoDTO(cedula=cedula_valida(630))
        )
    assert excinfo.value.mensaje == MENSAJE_VINCULACION_NO_DISPONIBLE
    assert db_session.query(VinculacionRepresentante).count() == 0


def test_vincular_representado_propia_cedula_rechazada_con_mensaje_generico(db_session):
    representante = _adulto("1710034073", nombres="Marcela")
    db_session.add(representante)
    db_session.commit()

    servicio = PersonaServicio(db_session, dormir=_SleeperEspia())
    with pytest.raises(OperacionInvalida) as excinfo:
        servicio.vincular_representado(
            representante.id, VincularRepresentadoDTO(cedula=representante.cedula)
        )
    assert excinfo.value.mensaje == MENSAJE_VINCULACION_NO_DISPONIBLE


def test_cedula_inexistente_y_persona_no_elegible_son_indistinguibles(db_session):
    """El corazón del guardarraíl 3: comparado contra una cédula que SÍ
    existe (pero no es elegible) y una que no existe en absoluto, ni el
    mensaje ni el tipo de excepción distinguen un caso del otro."""
    representante = _adulto("1710034073", nombres="Marcela")
    mayor_de_edad = _adulto(cedula_valida(630), nombres="Otro")
    db_session.add_all([representante, mayor_de_edad])
    db_session.commit()

    servicio = PersonaServicio(db_session, dormir=_SleeperEspia())

    with pytest.raises(OperacionInvalida) as caso_existente:
        servicio.vincular_representado(representante.id, VincularRepresentadoDTO(cedula=cedula_valida(630)))
    with pytest.raises(OperacionInvalida) as caso_inexistente:
        servicio.vincular_representado(representante.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))

    assert caso_existente.value.mensaje == caso_inexistente.value.mensaje == MENSAJE_VINCULACION_NO_DISPONIBLE
    assert type(caso_existente.value) is type(caso_inexistente.value)


# ---------------------------------------------------------------------------
# Guardarraíl 4: tope de intentos (freno progresivo, nunca bloqueo duro)
# ---------------------------------------------------------------------------

def test_primeros_dos_intentos_fallidos_no_retrasan(db_session):
    representante = _adulto("1710034073")
    db_session.add(representante)
    db_session.commit()
    espia = _SleeperEspia()
    servicio = PersonaServicio(db_session, dormir=espia)

    for _ in range(2):
        with pytest.raises(OperacionInvalida):
            servicio.vincular_representado(representante.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))

    assert espia.llamadas == []


def test_tercer_intento_fallido_retrasa_un_segundo(db_session):
    representante = _adulto("1710034073")
    db_session.add(representante)
    db_session.commit()
    espia = _SleeperEspia()
    servicio = PersonaServicio(db_session, dormir=espia)

    for _ in range(3):
        with pytest.raises(OperacionInvalida):
            servicio.vincular_representado(representante.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))

    assert espia.llamadas == [1]


def test_retraso_duplica_y_tiene_techo_de_30_segundos(db_session):
    representante = _adulto("1710034073")
    db_session.add(representante)
    db_session.commit()
    espia = _SleeperEspia()
    servicio = PersonaServicio(db_session, dormir=espia)

    for _ in range(9):
        with pytest.raises(OperacionInvalida):
            servicio.vincular_representado(representante.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))

    # Intentos 3..9 -> 1, 2, 4, 8, 16, 30(techo), 30(techo)
    assert espia.llamadas == [1, 2, 4, 8, 16, 30, 30]


def test_vinculacion_exitosa_resetea_el_contador(db_session):
    representante = _adulto("1710034073")
    menor = _menor(cedula_valida(632), representante_id=None)
    db_session.add_all([representante, menor])
    db_session.commit()
    espia = _SleeperEspia()
    servicio = PersonaServicio(db_session, dormir=espia)

    for _ in range(2):
        with pytest.raises(OperacionInvalida):
            servicio.vincular_representado(representante.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))

    servicio.vincular_representado(representante.id, VincularRepresentadoDTO(cedula=menor.cedula))

    espia.llamadas.clear()
    with pytest.raises(OperacionInvalida):
        servicio.vincular_representado(representante.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))
    assert espia.llamadas == []


def test_contador_es_por_representante_no_global(db_session):
    representante_a = _adulto("1710034073", nombres="A")
    representante_b = _adulto("1710034081", nombres="B")
    db_session.add_all([representante_a, representante_b])
    db_session.commit()
    espia = _SleeperEspia()
    servicio = PersonaServicio(db_session, dormir=espia)

    for _ in range(3):
        with pytest.raises(OperacionInvalida):
            servicio.vincular_representado(representante_a.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))
    assert espia.llamadas == [1]

    espia.llamadas.clear()
    for _ in range(3):
        with pytest.raises(OperacionInvalida):
            servicio.vincular_representado(representante_b.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))
    assert espia.llamadas == [1]


def test_cedula_existente_no_elegible_sigue_la_misma_curva_de_retraso_que_una_inexistente(db_session):
    """Anti-enumeración de extremo a extremo: el TIMING de la respuesta
    tampoco distingue "existe pero no es elegible" de "no existe"."""
    representante_a = _adulto("1710034073", nombres="A")
    representante_b = _adulto("1710034081", nombres="B")
    mayor_de_edad = _adulto(cedula_valida(630), nombres="Otro")
    db_session.add_all([representante_a, representante_b, mayor_de_edad])
    db_session.commit()

    espia_real = _SleeperEspia()
    servicio_real = PersonaServicio(db_session, dormir=espia_real)
    espia_fantasma = _SleeperEspia()
    servicio_fantasma = PersonaServicio(db_session, dormir=espia_fantasma)

    for _ in range(5):
        with pytest.raises(OperacionInvalida):
            servicio_real.vincular_representado(representante_a.id, VincularRepresentadoDTO(cedula=cedula_valida(630)))
        with pytest.raises(OperacionInvalida):
            servicio_fantasma.vincular_representado(representante_b.id, VincularRepresentadoDTO(cedula=cedula_valida(631)))

    assert espia_real.llamadas == espia_fantasma.llamadas == [1, 2, 4]


# ---------------------------------------------------------------------------
# Router — ownership, permisos, forma de la respuesta
# ---------------------------------------------------------------------------

def test_vincular_representado_router_happy_path(client, db_session):
    representante_anterior = _guardado(db_session, _adulto("1710034065", nombres="Pedro"))
    representante_nuevo = _adulto("1710034073", nombres="Marcela")
    menor = _menor(cedula_valida(632), representante_id=representante_anterior.id)
    db_session.add_all([representante_nuevo, menor])
    db_session.commit()
    _restaurar_override_token(persona_id=representante_nuevo.id, roles=["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{representante_nuevo.id}/vincular-representado",
        json={"cedula": menor.cedula},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == menor.id
    assert data["representanteId"] == representante_nuevo.id

    notificaciones = db_session.query(Notificacion).filter(
        Notificacion.persona_id == representante_anterior.id
    ).all()
    assert len(notificaciones) == 1


def test_vincular_representado_router_no_elegible_da_400_generico(client, db_session):
    representante = _adulto("1710034073", nombres="Marcela")
    db_session.add(representante)
    db_session.commit()
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{representante.id}/vincular-representado",
        json={"cedula": cedula_valida(631)},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == MENSAJE_VINCULACION_NO_DISPONIBLE


def test_vincular_representado_persona_id_no_coincide_con_token_da_403(client, db_session):
    representante = _adulto("1710034065", nombres="Pedro")
    otro_representante = _adulto("1710034073", nombres="Marcela")
    db_session.add_all([representante, otro_representante])
    db_session.commit()
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{otro_representante.id}/vincular-representado",
        json={"cedula": cedula_valida(631)},
    )
    assert resp.status_code == 403
    detalle = resp.json()["detail"].lower()
    assert "no encontrad" not in detalle


def test_vincular_representado_sin_rol_representante_da_403(client, db_session):
    representante = _adulto("1710034073", nombres="Marcela")
    db_session.add(representante)
    db_session.commit()
    _restaurar_override_token(persona_id=representante.id, roles=["ALUMNO"])

    resp = client.post(
        f"/api/v1/personas/{representante.id}/vincular-representado",
        json={"cedula": cedula_valida(631)},
    )
    assert resp.status_code == 403


def test_vincular_representado_administrador_puede_vincular_por_cualquiera(client, db_session):
    representante = _adulto("1710034073", nombres="Marcela")
    menor = _menor(cedula_valida(632), representante_id=None)
    db_session.add_all([representante, menor])
    db_session.commit()
    _restaurar_override_token(persona_id=999, roles=["ADMINISTRADOR"])

    resp = client.post(
        f"/api/v1/personas/{representante.id}/vincular-representado",
        json={"cedula": menor.cedula},
    )
    assert resp.status_code == 200, resp.text


def test_vincular_representado_admin_representante_id_inexistente_da_conflicto_claro(client, db_session):
    """Issue #460, TRIANGULATE: el panel admin (`Miembros -> Editar ->
    Representante legal`) ahora invoca este endpoint con un `representante_id`
    resuelto por búsqueda (`GET /personas/buscar`), así que la UI nueva nunca
    envía un id inexistente -- pero un ADMINISTRADOR igual puede llamarlo
    directamente por API con cualquier `persona_id` en la URL
    (`exigir_acceso_directo` no valida que el objetivo exista para un rol
    privilegiado). `representante_id` no se verifica en
    `_resolver_representado_elegible`, así que el `UPDATE` viola la FK
    `Persona.representante_id -> Persona.id` y el `IntegrityError` sube sin
    capturar hasta el manejador de último recurso de `main.py`
    (`_integrity_error_handler`): 409 con un mensaje legible, nunca un 500
    crudo ni una traza de SQLAlchemy."""
    menor = _menor(cedula_valida(632), representante_id=None)
    db_session.add(menor)
    db_session.commit()
    _restaurar_override_token(persona_id=999, roles=["ADMINISTRADOR"])
    representante_id_inexistente = 999999

    resp = client.post(
        f"/api/v1/personas/{representante_id_inexistente}/vincular-representado",
        json={"cedula": menor.cedula},
    )

    assert resp.status_code == 409, resp.text
    cuerpo = resp.json()
    assert cuerpo["detail"]
    assert "traceback" not in resp.text.lower()
    assert "integrityerror" not in resp.text.lower()


def test_vincular_representado_cedula_invalida_da_422(client, db_session):
    representante = _adulto("1710034073", nombres="Marcela")
    db_session.add(representante)
    db_session.commit()
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{representante.id}/vincular-representado",
        json={"cedula": "123"},
    )
    assert resp.status_code == 422


def test_vincular_representado_cedula_con_digito_verificador_incorrecto_da_422(client, db_session):
    # PR 4b, issue #228: 10 dígitos no alcanza -- "1712345678" tiene el largo
    # correcto pero el verificador debería ser 5, no 8. Prueba end-to-end la
    # `_validation_exception_handler` de `main.py`: el 422 tiene que llegar
    # como {detail, message} en castellano, no como la lista cruda de
    # Pydantic (que el frontend descarta -- ver `services/api.ts`).
    representante = _adulto("1710034073", nombres="Marcela")
    db_session.add(representante)
    db_session.commit()
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{representante.id}/vincular-representado",
        json={"cedula": "1712345678"},
    )
    assert resp.status_code == 422
    cuerpo = resp.json()
    assert cuerpo["detail"] == "Ese número de cédula no es válido."
    assert cuerpo["message"] == "Ese número de cédula no es válido."
