"""
Lectura agregada del portal del alumno (issue #1592).

Antes el BFF (`frontend/src/app/api/student/route.ts`) hacía ~4 llamadas por
perfil (persona, historial, membresías, representante) más 3 de catálogo. Acá
se resuelve todo con un número CONSTANTE de consultas, sin importar cuántos
representados tenga la cuenta.

Autorización: la decide el router con `exigir_acceso_directo` (titular o
ADMINISTRADOR) sobre la cuenta pedida. Todos los perfiles devueltos son esa
persona o sus representados activos, así que el llamador ya tiene sobre cada
uno el vínculo que exigen los endpoints por persona (dueño/representante/
admin). El ENTRENADOR queda fuera, igual que en `GET /personas/{id}/representados`.
"""
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.dominio.modelos import Asistencia, Membresia, Persona, TipoMembresia
from app.infraestructura.repositorios.asistencia_repositorio import AsistenciaRepositorio
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.servicios_negocio.dtos.asistencia_schemas import HorarioResponseDTO
from app.servicios_negocio.membresia_pago_servicio import MembresiaServicio
from app.servicios_negocio.persona_servicio import PersonaServicio

#: Tope de historial por perfil: el mismo `limit` máximo de
#: `GET /asistencias/persona/{id}`. El BFF pide su ventana vía `historial_limite`.
HISTORIAL_LIMITE_MAXIMO = 200


@dataclass
class PerfilPortal:
    persona: Persona
    representante: Persona | None
    historial: list[Asistencia]
    #: Filas del historial COMPLETO; `historial` es solo la ventana reciente.
    historial_total: int = 0
    membresias: list[Membresia] = field(default_factory=list)


@dataclass
class PortalAlumno:
    titular: PerfilPortal
    representados: list[PerfilPortal]
    horarios: list[HorarioResponseDTO]
    tipos: list[TipoMembresia]


class PortalServicio:
    def __init__(self, db: Session):
        self.db = db

    def obtener(
        self, persona_id: int, historial_limite: int = HISTORIAL_LIMITE_MAXIMO
    ) -> PortalAlumno:
        servicio_persona = PersonaServicio(self.db)
        titular = servicio_persona.obtener_persona(persona_id)
        representados = servicio_persona.listar_representados(persona_id)
        personas = [titular, *representados]
        ids = [p.id for p in personas]

        historiales = AsistenciaRepositorio(self.db).listar_recientes_por_personas(
            ids, historial_limite
        )
        totales = AsistenciaRepositorio(self.db).contar_por_personas(ids)
        membresias = MembresiaRepositorio(self.db).listar_por_personas(ids)
        representantes = PersonaRepositorio(self.db).listar_por_ids(
            sorted({p.representante_id for p in personas if p.representante_id})
        )
        perfiles = [
            PerfilPortal(
                persona=p,
                representante=representantes.get(p.representante_id),
                historial=historiales[p.id],
                historial_total=totales[p.id],
                membresias=membresias[p.id],
            )
            for p in personas
        ]
        return PortalAlumno(
            titular=perfiles[0],
            representados=perfiles[1:],
            horarios=AsistenciaServicio(self.db).listar_horarios(),
            tipos=MembresiaServicio(self.db).listar_tipos_membresia(),
        )
