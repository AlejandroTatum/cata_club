import logging
from datetime import date

from sqlalchemy.orm import Session

from app.dominio.enums import NivelTecnicoAlumno
from app.dominio.modelos import AntecedentesClub
from app.dominio.excepciones import EntidadNoEncontrada, EntidadDuplicada
from app.infraestructura.repositorios.antecedentes_club_repositorio import AntecedentesClubRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.servicios_negocio.dtos.persona_schemas import AntecedentesClubCreateDTO, AntecedentesClubUpdateDTO


logger = logging.getLogger("cataclub.servicios.antecedentes")


class AntecedentesClubServicio:
    """E01-RF008: datos técnicos del alumno (nivel técnico ya existía;
    mano_dominante se agregó en esta integración). No existía ningún
    endpoint para gestionar AntecedentesClub -- los DTOs estaban definidos
    pero sin router ni servicio detrás."""

    def __init__(self, db: Session):
        self.db = db
        self.repo = AntecedentesClubRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)

    def crear(self, datos: AntecedentesClubCreateDTO) -> AntecedentesClub:
        if not self.repo_persona.obtener_por_id(datos.persona_id):
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        if self.repo.obtener_por_persona(datos.persona_id):
            raise EntidadDuplicada("Esta persona ya tiene antecedentes de club registrados")
        antecedentes = AntecedentesClub(**datos.model_dump())
        resultado = self.repo.crear(antecedentes)
        self.db.commit()
        return resultado

    def obtener_por_persona(self, persona_id: int) -> AntecedentesClub:
        antecedentes = self.repo.obtener_por_persona(persona_id)
        if not antecedentes:
            raise EntidadNoEncontrada(
                f"La persona {persona_id} no tiene antecedentes de club registrados"
            )
        return antecedentes

    def actualizar(self, persona_id: int, datos: AntecedentesClubUpdateDTO) -> AntecedentesClub:
        antecedentes = self.obtener_por_persona(persona_id)
        for campo, valor in datos.model_dump(exclude_unset=True).items():
            setattr(antecedentes, campo, valor)
        resultado = self.repo.guardar_cambios(antecedentes)
        self.db.commit()
        return resultado

    def establecer_socio_desde(
        self, persona_id: int, fecha: date, actor_persona_id: int | None,
    ) -> AntecedentesClub:
        """Fija «socio desde» (QA ronda 2, L15), solo administración.

        Escribe únicamente `fecha_inicio_club`: ninguna columna de `Membresia`
        ni de `Pago` (estado, cobertura, deuda) se toca, y
        `Membresia.fecha_activacion` -- que ordena cuál es la membresía más
        reciente -- queda intacta. La fecha futura la rechaza el DTO.

        Si la persona aún no tiene antecedentes (típico de un miembro
        migrado) se crea la fila con el nivel técnico mínimo, que el admin
        puede ajustar luego por `PATCH .../antecedentes-club`; en una fila
        existente el nivel y la mano dominante no se modifican.

        Auditoría: el repo no tiene tabla de historial para esto (sin
        migración); queda registro estructurado en el log con el actor."""
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")
        antecedentes = self.repo.obtener_por_persona(persona_id)
        anterior = antecedentes.fecha_inicio_club if antecedentes else None
        if antecedentes is None:
            antecedentes = self.repo.crear(AntecedentesClub(
                persona_id=persona_id,
                fecha_inicio_club=fecha,
                nivel_tecnico_alumno=NivelTecnicoAlumno.NIVEL_1,
            ))
        else:
            antecedentes.fecha_inicio_club = fecha
            self.repo.guardar_cambios(antecedentes)
        self.db.commit()
        logger.info(
            "socio_desde persona=%s anterior=%s nuevo=%s actor=%s",
            persona_id, anterior, fecha, actor_persona_id,
        )
        return antecedentes
