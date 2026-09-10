"""El validador compartido de la relación (PR 4, #1133).

`RelacionRepresentacionServicio.validar_enlace` es el ÚNICO dueño de los
invariantes sin-cambio/self/edad/alcance/teléfono/ciclo: la reasignación
administrativa (y todo comando futuro de relación) pasa por acá, en ESTE
orden documentado en `design.md`. La base es la garantía final contra
bypasseos (ver `test_representacion_triggers.py`); el servicio es el camino
de error legible y accionable.

Esta suite también ancla la mitad autorizacional del contrato: la historia
de auditoría NUNCA autoriza (solo `Persona.representante_id` actual) y no
existe ninguna tabla de solicitud/pendiente de relación.
"""
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Persona, Usuario, VinculacionRepresentante
from app.servicios_negocio.politica_acceso import PoliticaAccesoPersona
from app.servicios_negocio.relacion_representacion_servicio import (
    RelacionRepresentacionServicio,
)


def _persona(db, seed, fnac, rep_id=None, activo=True, telefono="0991234567"):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(seed),
        fecha_nacimiento=fnac, telefono=telefono, activo=activo,
        representante_id=rep_id,
    )
    db.add(persona)
    db.flush()
    return persona


def _persona_adulta_vinculada(db, seed, fnac, rep_id):
    """Fila de adulto YA vinculado, sembrada como llega de verdad a la base:
    el vínculo se creó siendo menor y envejeció en el sitio. El candado de
    relación de PR 4 (`i1141relinteg`) rechaza el alta cruda (`INSERT`) de un
    adulto vinculado, así que un `_persona(db, seed, fnac, rep_id=...)` directo
    dejaría de representar la fila legada. El `UPDATE` de fecha NO toca
    `representante_id`, que es la columna del trigger."""
    persona = _persona(db, seed, date(2015, 5, 14), rep_id=rep_id)
    db.query(Persona).filter(Persona.id == persona.id).update(
        {"fecha_nacimiento": fnac}, synchronize_session=False,
    )
    db.refresh(persona)
    return persona


def _cuenta(db, persona, activo=True):
    usuario = Usuario(
        correo=f"cuenta{persona.id}@test.com", contrasenia="hash",
        persona_id=persona.id, activo=activo, correo_verificado=True,
    )
    db.add(usuario)
    db.flush()
    return usuario


def _escenario_valido(db):
    """Menor con su representante actual (`viejo`) y un destino elegible."""
    viejo = _persona(db, 600, date(1985, 1, 1))
    _cuenta(db, viejo)
    menor = _persona(db, 601, date(2020, 1, 1), rep_id=viejo.id)
    nuevo = _persona(db, 602, date(1988, 1, 1))
    _cuenta(db, nuevo)
    return menor, viejo, nuevo


def _cuenta_de(db, persona):
    return db.query(Usuario).filter_by(persona_id=persona.id).one_or_none()


def _rechazo(db, match, *, objetivo, destino, enlace, con_cuenta=True):
    """Corre el validador esperando SU OperacionInvalida con ese motivo."""
    with pytest.raises(OperacionInvalida, match=match):
        RelacionRepresentacionServicio(db).validar_enlace(
            objetivo=objetivo, destino=destino, enlace_actual=enlace,
            cuenta_destino=_cuenta_de(db, destino) if con_cuenta else None,
        )


# --- Camino válido ------------------------------------------------------------

def test_acepta_un_enlace_valido(db_session):
    menor, _, nuevo = _escenario_valido(db_session)
    RelacionRepresentacionServicio(db_session).validar_enlace(
        objetivo=menor, destino=nuevo, enlace_actual=menor.representante_id,
        cuenta_destino=_cuenta_de(db_session, nuevo),
    )


def test_un_destino_sin_cuenta_propia_puede_recibir(db_session):
    """Paridad con el criterio #1139: un tutor cargado a mano, sin login,
    no tiene cuenta que pueda estar desactivada y sigue siendo destino."""
    menor, viejo, _ = _escenario_valido(db_session)
    tutor = _persona(db_session, 618, date(1988, 1, 1))
    RelacionRepresentacionServicio(db_session).validar_enlace(
        objetivo=menor, destino=tutor, enlace_actual=viejo.id,
        cuenta_destino=None,
    )


# --- Rechazos: cada invariante con su mensaje ---------------------------------

def test_rechaza_el_sin_cambio(db_session):
    menor, viejo, _ = _escenario_valido(db_session)
    _rechazo(db_session, "ya es su representante actual",
             objetivo=menor, destino=viejo, enlace=viejo.id)


def test_rechaza_la_auto_referencia(db_session):
    menor, _, _ = _escenario_valido(db_session)
    _rechazo(db_session, "no puede ser su propio representante",
             objetivo=menor, destino=menor, enlace=menor.representante_id)


def test_rechaza_un_objetivo_adulto(db_session):
    _, _, nuevo = _escenario_valido(db_session)
    abuelo = _persona(db_session, 611, date(1960, 1, 1))
    adulto = _persona_adulta_vinculada(
        db_session, 610, date(1995, 1, 1), abuelo.id,
    )
    _rechazo(db_session, "se vincula a menores",
             objetivo=adulto, destino=nuevo, enlace=abuelo.id)


def test_rechaza_un_destino_menor(db_session):
    menor, viejo, _ = _escenario_valido(db_session)
    destino_menor = _persona(db_session, 612, date(2020, 1, 1))
    _rechazo(db_session, "debe ser mayor de edad",
             objetivo=menor, destino=destino_menor, enlace=viejo.id)


def test_rechaza_un_destino_dado_de_baja(db_session):
    menor, viejo, _ = _escenario_valido(db_session)
    baja = _persona(db_session, 613, date(1988, 1, 1), activo=False)
    _cuenta(db_session, baja)
    _rechazo(db_session, "está dada de baja",
             objetivo=menor, destino=baja, enlace=viejo.id)


def test_rechaza_un_destino_con_cuenta_desactivada(db_session):
    menor, viejo, _ = _escenario_valido(db_session)
    apagado = _persona(db_session, 614, date(1988, 1, 1))
    _cuenta(db_session, apagado, activo=False)
    _rechazo(db_session, "no puede recibir representados nuevos",
             objetivo=menor, destino=apagado, enlace=viejo.id)


@pytest.mark.parametrize("telefono", ["", "123"])
def test_rechaza_un_destino_sin_telefono_valido(db_session, telefono):
    """Filas legadas sembradas por SQL (o con el teléfono vacío): el
    destino sin un teléfono válido actual no recibe representados.

    `persona.telefono` es NOT NULL en la base, así que la ausencia se siembra
    como `''` -- el mismo caso "sin teléfono" que `_exigir_telefono_valido`
    tolera en el ORM -- en vez de `NULL`."""
    menor, viejo, _ = _escenario_valido(db_session)
    destino = _persona(db_session, 615, date(1988, 1, 1))
    _cuenta(db_session, destino)
    db_session.execute(text(
        "UPDATE persona SET telefono = CAST(:tel AS varchar) WHERE id = :pid"
    ), {"tel": telefono, "pid": destino.id})
    db_session.expire_all()
    destino = db_session.get(Persona, destino.id)
    _rechazo(db_session, "teléfono válido",
             objetivo=menor, destino=destino, enlace=viejo.id)


def test_rechaza_el_ciclo_indirecto(db_session):
    menor, viejo, _ = _escenario_valido(db_session)
    # destino -> W -> menor: enlazar al menor bajo `destino` cierra el ciclo.
    w = _persona(db_session, 616, date(2020, 2, 1), rep_id=menor.id)
    destino = _persona_adulta_vinculada(
        db_session, 617, date(1988, 1, 1), w.id,
    )
    _cuenta(db_session, destino)
    _rechazo(db_session, "formaría un ciclo",
             objetivo=menor, destino=destino, enlace=viejo.id)


# --- El orden de validación es el documentado ---------------------------------

def test_el_orden_de_validacion_es_el_documentado(db_session):
    menor, viejo, _ = _escenario_valido(db_session)
    baja = _persona(db_session, 620, date(1988, 1, 1), activo=False)
    _cuenta(db_session, baja)
    # El sin-cambio gana aunque el destino además esté roto:
    _rechazo(db_session, "ya es su representante actual",
             objetivo=menor, destino=viejo, enlace=viejo.id)
    # La auto-referencia gana antes que las validaciones del destino:
    _rechazo(db_session, "no puede ser su propio representante",
             objetivo=menor, destino=menor, enlace=baja.id)
    # La edad del objetivo gana antes que las del destino (el adulto no tiene
    # vínculo actual, así que el `enlace` observado es `None`):
    adulto = _persona(db_session, 621, date(1995, 1, 1))
    _rechazo(db_session, "se vincula a menores",
             objetivo=adulto, destino=baja, enlace=None)


def test_el_representante_historico_queda_denegado(db_session):
    """Evidencia vieja en el ledger NO autoriza: `PoliticaAccesoPersona`
    lee la columna `representante_id` actual, y solo ella."""
    menor, viejo_rep, nuevo_rep = _escenario_valido(db_session)
    db_session.add(VinculacionRepresentante(
        persona_id=menor.id, representante_anterior_id=None,
        representante_nuevo_id=viejo_rep.id, actor_persona_id=viejo_rep.id,
        operacion="CREACION", origen="SESION_AUTENTICADA",
    ))
    menor.representante_id = nuevo_rep.id
    db_session.flush()

    politica = PoliticaAccesoPersona(db_session)
    assert politica.puede_acceder(
        persona_id_objetivo=menor.id, persona_id_solicitante=nuevo_rep.id,
        roles_solicitante=["REPRESENTANTE"],
    )
    assert not politica.puede_acceder(
        persona_id_objetivo=menor.id, persona_id_solicitante=viejo_rep.id,
        roles_solicitante=["REPRESENTANTE"],
    )
    assert politica.puede_acceder(
        persona_id_objetivo=menor.id, persona_id_solicitante=viejo_rep.id,
        roles_solicitante=["ADMINISTRADOR"],
    )


# --- La historia no autoriza; no hay estado de solicitud ----------------------


def test_no_existe_estado_de_solicitud_de_relacion(db_session):
    """El contrato prohíbe tablas de solicitud/pendiente/aprobación de
    relación: el ledger append-only es la ÚNICA tabla de vínculos."""
    tablas = {
        fila[0] for fila in db_session.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )).all()
    }
    assert {t for t in tablas if "vinculacion" in t} == {
        "vinculacion_representante",
    }
    assert not [t for t in tablas if "solicitud" in t or "relacion_pend" in t]


# --- TRIANGULATE: paridad con el candado de la base (i1141relinteg) ----------


@pytest.mark.parametrize("telefono", ["0991234567", "022345678"])
def test_acepta_el_telefono_canonico_del_destino(db_session, telefono):
    """Paridad positiva del predicado canónico `^(09[0-9]{8}|0[0-9]{8})$` con
    el trigger de la base: pasan las DOS ramas válidas -- celular de 10 y fijo
    de 9 --, no solo el celular que usan el resto de los fixtures."""
    menor, viejo, _ = _escenario_valido(db_session)
    destino = _persona(db_session, 632, date(1988, 1, 1), telefono=telefono)
    _cuenta(db_session, destino)
    RelacionRepresentacionServicio(db_session).validar_enlace(
        objetivo=menor, destino=destino, enlace_actual=viejo.id,
        cuenta_destino=_cuenta_de(db_session, destino),
    )


def test_el_trigger_rechaza_el_mismo_ciclo_que_el_servicio(db_session):
    """Paridad de la detección de ciclo: el grafo que el validador rechaza es
    el MISMO que la base rechaza. Se intenta el `UPDATE` real bajo un savepoint
    para poder seguir usando la sesión tras el `CheckViolation`."""
    menor, viejo, _ = _escenario_valido(db_session)
    w = _persona(db_session, 633, date(2020, 3, 1), rep_id=menor.id)
    destino = _persona_adulta_vinculada(
        db_session, 634, date(1988, 1, 1), w.id,
    )
    _rechazo(db_session, "formaría un ciclo",
             objetivo=menor, destino=destino, enlace=viejo.id)
    with pytest.raises(IntegrityError, match="ciclo"):
        with db_session.begin_nested():
            db_session.execute(
                text("UPDATE persona SET representante_id = :r WHERE id = :p"),
                {"r": destino.id, "p": menor.id},
            )
