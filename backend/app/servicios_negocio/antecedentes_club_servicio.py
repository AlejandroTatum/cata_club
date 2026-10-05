from sqlalchemy.orm import Session

from app.dominio.modelos import AntecedentesClub
from app.dominio.excepciones import EntidadNoEncontrada, EntidadDuplicada
from app.infraestructura.repositorios.antecedentes_club_repositorio import AntecedentesClubRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.servicios_negocio.dtos.persona_schemas import AntecedentesClubCreateDTO, AntecedentesClubUpdateDTO


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
