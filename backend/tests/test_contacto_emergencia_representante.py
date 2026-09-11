"""
Issue #1138: el contacto de emergencia de un menor representado se deriva
SIEMPRE de su representante -- nunca un texto libre independiente que alguien
tenga que mantener sincronizado a mano.

Nombres de test en inglés a propósito: son los cuatro candados que el dueño
del producto pidió explícitamente por nombre en el issue, como criterio de
cierre.
"""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoSangre
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import FichaMedica, Persona
from app.servicios_negocio.dtos.persona_schemas import RepresentadoCreateDTO, VincularRepresentadoDTO
from app.servicios_negocio.ficha_medica_servicio import FichaMedicaServicio
from app.servicios_negocio.persona_servicio import PersonaServicio
from tests.conftest import crear_entrenador


def _crear_representante(db_session, telefono="0987654321", sufijo=0):
    representante = Persona(
        nombres="Marta", apellidos="Solís", cedula=cedula_valida(9100 + sufijo),
        fecha_nacimiento=date(1985, 3, 20), telefono=telefono,
    )
    db_session.add(representante)
    db_session.flush()
    return representante


def _crear_hijo(db_session, representante, sufijo=0):
    hijo = Persona(
        nombres="Iker", apellidos="Solís", cedula=cedula_valida(9200 + sufijo),
        fecha_nacimiento=date(2015, 5, 14), telefono="0990000000",
        representante_id=representante.id,
    )
    db_session.add(hijo)
    db_session.commit()
    return hijo


# --- 1. Los dos formularios rechazan explícitamente los campos retirados ----
def test_represented_child_contract_rejects_removed_fields(client, db_session):
    """Los dos caminos que dan de alta un menor representado -- la
    autoinscripción pública con `representante` y `POST
    /personas/{id}/representados` -- rechazan con 422 explícito, no en
    silencio, si el cuerpo igual manda `contacto_emergencia` o
    `telefono_emergencia`."""
    respuesta_enrollment = client.post(
        "/api/v1/enrollment/",
        json={
            "representante": {
                "nombres": "Sofia", "apellidos": "Martinez", "cedula": cedula_valida(9301),
                "fecha_nacimiento": "1990-05-20", "telefono": "0991234567",
                "correo": "sofia-1138@example.com", "contrasenia": "password8",
            },
            "alumno": {
                "nombres": "Lucas", "apellidos": "Martinez", "cedula": cedula_valida(9302),
                "fecha_nacimiento": "2015-06-15", "telefono": "0991234568",
            },
            "ficha_medica": {
                "tipo_sangre": "O_POSITIVO",
                "contacto_emergencia": "Sofia Martinez",
                "telefono_emergencia": "0991112233",
            },
            "acepta_consentimientos": True,
        },
    )
    assert respuesta_enrollment.status_code == 422
    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(9302)).first() is None

    # `client` ya autentica como ADMINISTRADOR (ver conftest.py), que también
    # puede usar este endpoint (mismo patrón que
    # `test_personas.py::test_crear_representado_admin_puede_usar_endpoint`).
    representante = _crear_representante(db_session, sufijo=1)
    respuesta_representados = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json={
            "nombres": "Ana", "apellidos": "Solís", "cedula": cedula_valida(9303),
            "fecha_nacimiento": "2015-05-14", "telefono": "0991230001",
            "ficha_medica": {"tipo_sangre": "O_POSITIVO", "telefono_emergencia": "0991112233"},
        },
    )
    assert respuesta_representados.status_code == 422
    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(9303)).first() is None


# --- 2. El contacto se deriva del representante ACTUAL ----------------------
def test_emergency_contact_is_derived_from_current_representative(db_session):
    """Cambiar el teléfono del representante cambia lo que ve el entrenador,
    SIN tocar ningún registro del representado (que no tiene ficha médica)."""
    crear_entrenador(db_session)
    representante = _crear_representante(db_session, telefono="0987654321", sufijo=2)
    hijo = _crear_hijo(db_session, representante, sufijo=2)

    servicio = FichaMedicaServicio(db_session)
    primera = servicio.obtener_ficha_emergencia(hijo.id, consultante_persona_id=1)
    assert primera.contacto_emergencia == "Marta Solís"
    assert primera.telefono_emergencia == "0987654321"

    representante.telefono = "0999998888"
    db_session.commit()

    segunda = servicio.obtener_ficha_emergencia(hijo.id, consultante_persona_id=1)
    assert segunda.telefono_emergencia == "0999998888"
    assert segunda.contacto_emergencia == "Marta Solís"
    # Ningún registro del representado se tocó: sigue sin ficha médica.
    db_session.refresh(hijo)
    assert hijo.ficha_medica is None


# --- 3. Un vínculo nuevo exige un representante con teléfono válido --------
def test_link_requires_representative_valid_phone(db_session):
    """Ni `crear_representado` ni `vincular_representado` pueden apuntar a
    un representante sin un teléfono válido: de él se deriva el contacto de
    emergencia, y una fila legada con `telefono=""` (tolerada por el modelo)
    no es un candidato válido para un vínculo que se crea HOY."""
    representante_sin_telefono = _crear_representante(db_session, telefono="", sufijo=3)
    db_session.commit()

    with pytest.raises(OperacionInvalida, match="teléfono válido"):
        PersonaServicio(db_session).crear_representado(
            representante_sin_telefono.id,
            RepresentadoCreateDTO(
                nombres="Nuevo", apellidos="Dependiente", cedula=cedula_valida(9304),
                fecha_nacimiento=date(2016, 1, 1), telefono="0991230009",
            ),
        )
    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(9304)).first() is None

    candidato = Persona(
        nombres="Sin", apellidos="Vinculo", cedula=cedula_valida(9305),
        fecha_nacimiento=date(2016, 1, 1), telefono="0991230010",
    )
    db_session.add(candidato)
    db_session.commit()

    with pytest.raises(OperacionInvalida, match="teléfono válido"):
        PersonaServicio(db_session).vincular_representado(
            representante_sin_telefono.id,
            VincularRepresentadoDTO(cedula=candidato.cedula),
        )
    db_session.refresh(candidato)
    assert candidato.representante_id is None


# --- 4. Un valor legado en la ficha no se usa operativamente ---------------
def test_legacy_emergency_values_are_not_used_operationally(db_session):
    """Una `FichaMedica` legada (previa a #1138) puede seguir teniendo
    `contacto_emergencia`/`telefono_emergencia` propios de texto libre --
    quedan almacenados, pero la tarjeta de emergencia YA NO los lee: siempre
    deriva del representante actual."""
    crear_entrenador(db_session)
    representante = _crear_representante(db_session, telefono="0987654321", sufijo=4)
    hijo = _crear_hijo(db_session, representante, sufijo=4)
    db_session.add(FichaMedica(
        tipo_sangre=TipoSangre.O_POSITIVO, persona_id=hijo.id,
        contacto_emergencia="Vecina Legada", telefono_emergencia="0991110000",
    ))
    db_session.commit()

    resultado = FichaMedicaServicio(db_session).obtener_ficha_emergencia(
        hijo.id, consultante_persona_id=1,
    )

    assert resultado.contacto_emergencia == "Marta Solís"
    assert resultado.telefono_emergencia == "0987654321"
    # El valor legado sigue en la fila, simplemente sin uso operativo.
    db_session.refresh(hijo)
    assert hijo.ficha_medica.contacto_emergencia == "Vecina Legada"
    assert hijo.ficha_medica.telefono_emergencia == "0991110000"


# --- 5. Candado transversal: todo alumno tiene un teléfono alcanzable ------
def test_todo_alumno_tiene_un_telefono_de_emergencia_alcanzable(db_session):
    """Issue #1138, candado transversal del issue: para cada alumno --
    adulto autogestionado o menor representado -- la tarjeta de emergencia
    debe tener un teléfono al que llamar."""
    crear_entrenador(db_session)
    representante = _crear_representante(db_session, telefono="0987650000", sufijo=5)
    hijo = _crear_hijo(db_session, representante, sufijo=5)

    adulto = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(9306),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991110001",
    )
    db_session.add(adulto)
    db_session.flush()
    db_session.add(FichaMedica(
        tipo_sangre=TipoSangre.A_POSITIVO, persona_id=adulto.id,
        contacto_emergencia="Hermana", telefono_emergencia="0991112222",
    ))
    db_session.commit()

    servicio = FichaMedicaServicio(db_session)
    for alumno in (hijo, adulto):
        ficha_emergencia = servicio.obtener_ficha_emergencia(alumno.id, consultante_persona_id=1)
        assert (ficha_emergencia.telefono_emergencia or "").strip(), (
            f"persona_id={alumno.id} no tiene un teléfono de emergencia alcanzable"
        )
