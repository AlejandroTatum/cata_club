"""QA4 FAM-06: el aviso de «Nueva inscripción» que recibe la familia habla a la
familia (sin cédula del menor, sin «Nuevo alumno inscrito»); el del club no
cambia."""
from datetime import date

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import EnrollmentNotificacionOutbox, Persona
from app.servicios_negocio.enrollment_servicio import EnrollmentServicio
from tests.test_enrollment_notificacion_outbox import _admin


def _inscripcion_de_menor(db_session):
    admin = _admin(db_session)
    representante = Persona(
        nombres="Rosa", apellidos="Vera", cedula=cedula_valida(741),
        fecha_nacimiento=date(1985, 5, 5), telefono="0991111113",
    )
    db_session.add(representante)
    db_session.flush()
    menor = Persona(
        nombres="Mateo Andrés", apellidos="Mendoza Vera", cedula=cedula_valida(742),
        fecha_nacimiento=date(2014, 2, 2), telefono="0991111114",
        representante_id=representante.id,
    )
    db_session.add(menor)
    db_session.flush()
    EnrollmentServicio(db_session)._notificar_nueva_inscripcion(menor)
    mensajes = {
        e.admin_persona_id: e.mensaje
        for e in db_session.query(EnrollmentNotificacionOutbox).all()
    }
    return admin, representante, menor, mensajes


def test_el_aviso_del_representante_habla_a_la_familia_sin_cedula(db_session):
    _, representante, menor, mensajes = _inscripcion_de_menor(db_session)

    texto = mensajes[representante.id]
    assert texto == "Inscribimos a Mateo. Falta el primer pago para activar la membresía."
    assert menor.cedula not in texto


def test_el_aviso_del_club_conserva_nombre_y_cedula(db_session):
    admin, _, menor, mensajes = _inscripcion_de_menor(db_session)

    assert mensajes[admin.id] == (
        f"Nuevo alumno inscrito: Mateo Andrés Mendoza Vera (cédula: {menor.cedula})."
    )
