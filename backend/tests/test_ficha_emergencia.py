"""
Ficha de emergencia para el entrenador durante el entrenamiento (issue #360).

Los cuatro candados del issue, uno por test class:
- con token de ENTRENADOR, el endpoint responde 200 con EXACTAMENTE los
  campos enumerados en `FichaEmergenciaResponseDTO`, ni uno más;
- con token de ENTRENADOR, `GET /fichas-medicas/persona/{id}` (la ficha
  COMPLETA) sigue en 403 -- este endpoint nuevo no la abre;
- un alumno sin ficha médica cargada devuelve el respaldo del representante,
  nunca un error ni una pantalla vacía;
- la consulta queda registrada en `ConsultaFichaEmergencia`.
"""
from datetime import date

from app.dominio.enums import TipoSangre
from app.dominio.modelos import ConsultaFichaEmergencia, FichaMedica, Persona
from tests.conftest import crear_entrenador

CAMPOS_ESPERADOS = {
    "alumnoNombreCompleto",
    "tipoSangre",
    "alergias",
    "contactoEmergencia",
    "telefonoEmergencia",
    "representanteNombreCompleto",
    "representanteTelefono",
}


def _crear_representante(db_session, cedula="1710034065"):
    representante = Persona(
        nombres="Marta", apellidos="Solís", cedula=cedula,
        fecha_nacimiento=date(1985, 3, 20), telefono="0987654321",
    )
    db_session.add(representante)
    db_session.flush()
    return representante


def _crear_alumno_menor(db_session, representante, cedula="1710034066"):
    alumno = Persona(
        nombres="Iker", apellidos="Solís", cedula=cedula,
        fecha_nacimiento=date(2015, 5, 14), telefono="0990000000",
        representante_id=representante.id,
    )
    db_session.add(alumno)
    db_session.commit()
    return alumno


class TestCandado1ExactamenteLosCamposEnumerados:
    def test_entrenador_recibe_200_con_exactamente_los_campos_del_dto(
        self, client_entrenador, db_session,
    ):
        # Fila REAL del entrenador que autentica `client_entrenador`
        # (persona_id=1, ver conftest.py) -- necesaria para que la FK de
        # `ConsultaFichaEmergencia.consultante_persona_id` sea honesta y no
        # dependa de que la primera Persona creada abajo herede el id=1 por
        # casualidad de la secuencia.
        crear_entrenador(db_session)
        representante = _crear_representante(db_session, cedula="1710034070")
        alumno = _crear_alumno_menor(db_session, representante)
        ficha = FichaMedica(
            tipo_sangre=TipoSangre.O_POSITIVO, persona_id=alumno.id,
            alergias="Polen", contacto_emergencia="Marta Solís",
            telefono_emergencia="0987654321",
        )
        db_session.add(ficha)
        db_session.commit()

        resp = client_entrenador.get(f"/api/v1/fichas-medicas/persona/{alumno.id}/emergencia")

        assert resp.status_code == 200
        cuerpo = resp.json()
        assert set(cuerpo.keys()) == CAMPOS_ESPERADOS
        assert cuerpo["alumnoNombreCompleto"] == "Iker Solís"
        assert cuerpo["tipoSangre"] == "O_POSITIVO"
        assert cuerpo["alergias"] == "Polen"
        assert cuerpo["contactoEmergencia"] == "Marta Solís"
        assert cuerpo["telefonoEmergencia"] == "0987654321"
        assert cuerpo["representanteNombreCompleto"] == "Marta Solís"
        assert cuerpo["representanteTelefono"] == "0987654321"

    def test_un_administrador_tambien_puede_consultarla(self, client, db_session):
        crear_entrenador(db_session)  # ocupa el id=1 que también usa el token de `client`
        representante = _crear_representante(db_session, cedula="1710034071")
        alumno = _crear_alumno_menor(db_session, representante, cedula="1710034072")

        resp = client.get(f"/api/v1/fichas-medicas/persona/{alumno.id}/emergencia")

        assert resp.status_code == 200

    def test_sin_rol_de_staff_no_puede_consultarla(self, client_sin_permisos):
        resp = client_sin_permisos.get("/api/v1/fichas-medicas/persona/1/emergencia")
        assert resp.status_code == 403


class TestCandado2LaFichaCompletaSigueCerrada:
    def test_entrenador_sigue_recibiendo_403_en_la_ficha_medica_completa(
        self, client_entrenador, db_session,
    ):
        # Sin esta fila, el representante creado abajo hereda el id=1 por
        # secuencia y `PoliticaAccesoPersona` lo confundiría con el propio
        # solicitante (persona_id=1 del token) -- un 403 que pasaría por la
        # razón equivocada.
        crear_entrenador(db_session)
        representante = _crear_representante(db_session, cedula="1710034073")
        alumno = _crear_alumno_menor(db_session, representante, cedula="1710034074")

        resp = client_entrenador.get(f"/api/v1/fichas-medicas/persona/{alumno.id}")

        assert resp.status_code == 403


class TestCandado3RespaldoDelRepresentanteSinFichaMedica:
    def test_alumno_sin_ficha_medica_devuelve_el_respaldo_del_representante(
        self, client_entrenador, db_session,
    ):
        crear_entrenador(db_session)
        representante = _crear_representante(db_session, cedula="1710034075")
        alumno = _crear_alumno_menor(db_session, representante, cedula="1710034076")

        resp = client_entrenador.get(f"/api/v1/fichas-medicas/persona/{alumno.id}/emergencia")

        assert resp.status_code == 200
        cuerpo = resp.json()
        assert cuerpo["tipoSangre"] is None
        assert cuerpo["alergias"] is None
        assert cuerpo["contactoEmergencia"] is None
        assert cuerpo["telefonoEmergencia"] is None
        assert cuerpo["representanteNombreCompleto"] == "Marta Solís"
        assert cuerpo["representanteTelefono"] == "0987654321"


class TestCandado4LaConsultaQuedaAuditada:
    def test_la_consulta_queda_registrada_con_quien_y_cuando(
        self, client_entrenador, db_session,
    ):
        crear_entrenador(db_session)
        representante = _crear_representante(db_session, cedula="1710034077")
        alumno = _crear_alumno_menor(db_session, representante, cedula="1710034078")

        resp = client_entrenador.get(f"/api/v1/fichas-medicas/persona/{alumno.id}/emergencia")
        assert resp.status_code == 200

        registros = (
            db_session.query(ConsultaFichaEmergencia)
            .filter(ConsultaFichaEmergencia.alumno_persona_id == alumno.id)
            .all()
        )
        assert len(registros) == 1
        # `client_entrenador` autentica con persona_id=1 (ver conftest.py).
        assert registros[0].consultante_persona_id == 1
        assert registros[0].consultada_en is not None

    def test_dos_consultas_del_mismo_alumno_son_dos_filas_no_una_sobrescrita(
        self, client_entrenador, db_session,
    ):
        crear_entrenador(db_session)
        representante = _crear_representante(db_session, cedula="1710034079")
        alumno = _crear_alumno_menor(db_session, representante, cedula="1710034080")

        client_entrenador.get(f"/api/v1/fichas-medicas/persona/{alumno.id}/emergencia")
        client_entrenador.get(f"/api/v1/fichas-medicas/persona/{alumno.id}/emergencia")

        registros = (
            db_session.query(ConsultaFichaEmergencia)
            .filter(ConsultaFichaEmergencia.alumno_persona_id == alumno.id)
            .all()
        )
        assert len(registros) == 2
