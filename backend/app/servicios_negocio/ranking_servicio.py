"""
Servicio de negocio del módulo de Ranking (E03).

Decisiones de diseño registradas aquí porque son las que se acordaron
explícitamente con el equipo durante la integración (para que quien lea el
código no tenga que reconstruir el razonamiento desde cero):

1. "Nivel de Ranking" = grupo de entrenamiento (confirmado con el equipo):
   no existen como conceptos separados. NivelRanking es a la vez el
   agrupador de horarios de entrenamiento y el nivel competitivo.

2. Notificaciones in-app únicamente (no email/push).

Nota (limpieza cierre mensual + limpieza por inactividad + remoción del
ranking competitivo): el cierre mensual manual (RF004/RF005/RF007/RF009 --
cálculo de puntos y posiciones, sugerencias de ascenso/descenso, eliminación
automática por 2 meses consecutivos sin justificar) fue derogado por decisión
de producto y removido de este servicio. La tarea Celery Beat
`limpiar_ranking_por_inactividad`, que dependía del mismo dato huérfano
(`Ranking.ultimo_combate_o_asistencia`, ya no escrito por nadie tras el
cierre mensual), fue removida por la misma razón (falso positivo masivo: sin
escritor, todos quedaban "inactivos"). Hoy no existe ningún mecanismo
automático que ponga `esta_en_ranking = False`; la baja es
administrativa/manual. Los resultados mensuales, justificativos, reingreso y
selección oficial (funcionalidad competitiva) fueron removidos por completo;
lo que queda de este módulo es exclusivamente la asignación de alumnos a
niveles/grupos de entrenamiento.
"""
from sqlalchemy.orm import Session

from app.dominio.modelos import NivelRanking, Ranking, Notificacion
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida, PermisosInsuficientes, EntidadDuplicada
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.ranking_repositorio import (
    NivelRankingRepositorio, RankingRepositorio, NotificacionRepositorio,
)
from app.presentacion.schemas.ranking_schemas import (
    NivelRankingCreateDTO, AsignarNivelInicialDTO,
    NivelRankingConOcupacionDTO, TablaRankingItemDTO, PerfilRankingAlumnoDTO,
    AsignacionRankingResponseDTO, AlumnoConNivelDTO,
)


class NivelRankingServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = NivelRankingRepositorio(db)

    def crear_nivel(self, datos: NivelRankingCreateDTO) -> NivelRanking:
        if self.repo.obtener_por_numero(datos.numero_nivel):
            raise EntidadDuplicada(f"Ya existe un nivel de ranking número {datos.numero_nivel}")
        nivel = NivelRanking(numero_nivel=datos.numero_nivel, nombre=datos.nombre)
        return self.repo.crear(nivel)

    def obtener_nivel(self, nivel_id: int) -> NivelRanking:
        nivel = self.repo.obtener_por_id(nivel_id)
        if not nivel:
            raise EntidadNoEncontrada(f"Nivel de ranking con id {nivel_id} no encontrado")
        return nivel

    def listar_niveles_con_ocupacion(self) -> list[NivelRankingConOcupacionDTO]:
        niveles = self.repo.listar()
        resultado = []
        for nivel in niveles:
            actuales = self.repo.contar_personas_en_nivel(nivel.id)
            resultado.append(
                NivelRankingConOcupacionDTO(
                    id=nivel.id,
                    numero_nivel=nivel.numero_nivel,
                    nombre=nivel.nombre,
                    capacidad_minima=nivel.capacidad_minima,
                    capacidad_maxima=nivel.capacidad_maxima,
                    personas_actuales=actuales,
                    cupos_disponibles=max(nivel.capacidad_maxima - actuales, 0),
                    necesita_revision=actuales < nivel.capacidad_minima,
                )
            )
        return resultado

    def _validar_capacidad_disponible(self, nivel_id: int) -> None:
        """E03-RF001: máximo 10 por nivel, se bloquea de forma dura. El
        mínimo de 6 NO se bloquea aquí (ver docstring de NivelRanking en
        modelos.py) -- se informa vía listar_niveles_con_ocupacion."""
        nivel = self.obtener_nivel(nivel_id)
        actuales = self.repo.contar_personas_en_nivel(nivel_id)
        if actuales >= nivel.capacidad_maxima:
            raise OperacionInvalida(
                f"El nivel de ranking '{nivel.nombre or nivel.numero_nivel}' ya "
                f"alcanzó su capacidad máxima ({nivel.capacidad_maxima} deportistas)"
            )


class RankingServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = RankingRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)

    # --- Listados para frontend -----------------------------------------------
    def listar_asignaciones(self) -> list[AsignacionRankingResponseDTO]:
        rankings = self.repo.listar_todos(solo_activos=True)
        resultado = []
        for r in rankings:
            nivel = r.nivel_ranking
            resultado.append(
                AsignacionRankingResponseDTO(
                    persona_id=r.persona_id,
                    persona_nombre_completo=f"{r.persona.nombres} {r.persona.apellidos}",
                    nivel_ranking_id=r.nivel_ranking_id,
                    nivel_ranking_nombre=nivel.nombre if nivel else None,
                    nivel_ranking_numero=nivel.numero_nivel if nivel else 0,
                    esta_en_ranking=r.esta_en_ranking,
                )
            )
        return resultado

    def listar_alumnos_con_nivel(self) -> list[AlumnoConNivelDTO]:
        """Lista todos los alumnos (rol ALUMNO) con su nivel_ranking_id actual.
        Si no tienen Ranking creado, `nivel_ranking_id` es null. Accesible para
        ADMINISTRADOR y ENTRENADOR — reemplaza la dependencia con /personas/."""
        from app.dominio.enums import TipoRol
        alumnos = PersonaRepositorio(self.db).listar_por_rol(TipoRol.ALUMNO)
        resultado: list[AlumnoConNivelDTO] = []
        for alumno in alumnos:
            ranking = self.repo.obtener_por_persona(alumno.id)
            nivel_id = None
            if ranking is not None and ranking.esta_en_ranking:
                nivel_id = ranking.nivel_ranking_id
            resultado.append(
                AlumnoConNivelDTO(
                    persona_id=alumno.id,
                    nombres=alumno.nombres,
                    apellidos=alumno.apellidos,
                    nivel_ranking_id=nivel_id,
                )
            )
        return resultado

    # --- E03-RF002: asignación de nivel inicial -----------------------------
    def asignar_nivel_inicial(self, datos: AsignarNivelInicialDTO) -> Ranking:
        persona = self.repo_persona.obtener_por_id(datos.persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")

        nivel_servicio = NivelRankingServicio(self.db)
        nivel_servicio.obtener_nivel(datos.nivel_ranking_id)  # 404 si no existe
        nivel_servicio._validar_capacidad_disponible(datos.nivel_ranking_id)

        ranking = self.repo.obtener_por_persona(datos.persona_id)
        if ranking is None:
            ranking = Ranking(persona_id=datos.persona_id, nivel_ranking_id=datos.nivel_ranking_id)
            return self.repo.crear(ranking)

        if ranking.esta_en_ranking and ranking.nivel_ranking_id is not None:
            raise OperacionInvalida(
                "Esta persona ya tiene un nivel de ranking asignado; use el "
                "endpoint de movimiento para reasignarla"
            )
        ranking.nivel_ranking_id = datos.nivel_ranking_id
        ranking.esta_en_ranking = True
        return self.repo.guardar_cambios(ranking)

    def mover_de_nivel(self, persona_id: int, nuevo_nivel_id: int) -> Ranking:
        """Aplica manualmente un ascenso/descenso decidido por el
        Entrenador/Administrador."""
        ranking = self.repo.obtener_por_persona(persona_id)
        if not ranking:
            raise EntidadNoEncontrada(f"No existe ranking para la persona {persona_id}")

        nivel_servicio = NivelRankingServicio(self.db)
        nivel_servicio.obtener_nivel(nuevo_nivel_id)
        nivel_servicio._validar_capacidad_disponible(nuevo_nivel_id)

        ranking.nivel_ranking_id = nuevo_nivel_id
        return self.repo.guardar_cambios(ranking)

    def obtener_tabla_de_nivel(self, nivel_id: int) -> list[TablaRankingItemDTO]:
        """Roster de un nivel (persona_id + nombre + esta_en_ranking).

        Ex-E03-RF010 ("tabla de posiciones"): ya no ordena ni expone
        posición/puntaje (ver `TablaRankingItemDTO`). Se mantiene porque el
        roster de asistencia del entrenador y el mapeo de `/api/members` en
        el frontend lo consumen para obtener "quién pertenece a este nivel"
        (ver apply-progress de `limpieza-asistencia-y-nivel-entrenador`
        slice E)."""
        NivelRankingServicio(self.db).obtener_nivel(nivel_id)  # 404 si no existe
        rankings = self.repo.listar_por_nivel(nivel_id, solo_activos=True)
        return [
            TablaRankingItemDTO(
                persona_id=r.persona_id,
                persona_nombre_completo=f"{r.persona.nombres} {r.persona.apellidos}",
                esta_en_ranking=r.esta_en_ranking,
            )
            for r in rankings
        ]

    # --- E04-RF012: perfil privado del alumno -----------------------------
    def obtener_perfil_alumno(self, persona_id: int) -> PerfilRankingAlumnoDTO:
        ranking = self.repo.obtener_por_persona(persona_id)
        if not ranking:
            return PerfilRankingAlumnoDTO(
                persona_id=persona_id,
                nivel_ranking_id=None,
                nivel_ranking_nombre=None,
                esta_en_ranking=False,
            )
        nivel = ranking.nivel_ranking
        return PerfilRankingAlumnoDTO(
            persona_id=persona_id,
            nivel_ranking_id=ranking.nivel_ranking_id,
            nivel_ranking_nombre=(nivel.nombre if nivel else None),
            esta_en_ranking=ranking.esta_en_ranking,
        )


class NotificacionServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = NotificacionRepositorio(db)

    def listar_propias(self, persona_id: int) -> list[Notificacion]:
        return self.repo.listar_por_persona(persona_id)

    def listar_para_persona_y_hijos(self, persona_id: int) -> list[Notificacion]:
        """Para representantes: incluye notificaciones propias y de sus hijos."""
        from app.dominio.modelos import Persona
        persona = self.db.get(Persona, persona_id)
        if not persona:
            return []
        hijos_ids = [h.id for h in persona.representados]
        todos_ids = [persona_id] + hijos_ids
        return (
            self.db.query(Notificacion)
            .filter(Notificacion.persona_id.in_(todos_ids))
            .order_by(Notificacion.fecha_creacion.desc())
            .all()
        )

    def marcar_leida(self, notificacion_id: int, persona_id: int) -> Notificacion:
        notificacion = self.db.get(Notificacion, notificacion_id)
        if notificacion is None:
            raise EntidadNoEncontrada(f"Notificación con id {notificacion_id} no encontrada")
        if notificacion.persona_id != persona_id:
            raise PermisosInsuficientes("No puede marcar como leída una notificación ajena")
        return self.repo.marcar_leida(notificacion)
