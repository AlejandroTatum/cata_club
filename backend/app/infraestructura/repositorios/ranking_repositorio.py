from typing import Optional
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import NivelRanking, Persona, Ranking, Notificacion


class NivelRankingRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, nivel_id: int) -> Optional[NivelRanking]:
        return self.db.get(NivelRanking, nivel_id)

    def obtener_por_numero(self, numero_nivel: int) -> Optional[NivelRanking]:
        return self.db.query(NivelRanking).filter(NivelRanking.numero_nivel == numero_nivel).first()

    def listar(self) -> list[NivelRanking]:
        return self.db.query(NivelRanking).order_by(NivelRanking.numero_nivel).all()

    def contar_personas_en_nivel(self, nivel_id: int) -> int:
        return (
            self.db.query(Ranking)
            .filter(Ranking.nivel_ranking_id == nivel_id, Ranking.esta_en_ranking.is_(True))
            .count()
        )

    def crear(self, nivel: NivelRanking) -> NivelRanking:
        self.db.add(nivel)
        self.db.commit()
        self.db.refresh(nivel)
        return nivel


class RankingRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, ranking_id: int) -> Optional[Ranking]:
        return self.db.get(Ranking, ranking_id)

    def obtener_por_persona(self, persona_id: int) -> Optional[Ranking]:
        return self.db.query(Ranking).filter(Ranking.persona_id == persona_id).first()

    def listar_todos(self, solo_activos: bool = True) -> list[Ranking]:
        stmt = (
            select(Ranking)
            .options(joinedload(Ranking.persona), joinedload(Ranking.nivel_ranking))
            # Baja lógica: listado OPERATIVO. Un ex-miembro no ocupa cupo de
            # nivel ni puede ser movido de nivel. `solo_activos` (más abajo)
            # es otra cosa: se refiere a `Ranking.esta_en_ranking`.
            .join(Persona, Persona.id == Ranking.persona_id)
            .where(Persona.activo.is_(True))
        )
        if solo_activos:
            stmt = stmt.where(Ranking.esta_en_ranking.is_(True))
        stmt = stmt.order_by(Ranking.persona_id)
        return list(self.db.execute(stmt).scalars().unique().all())

    def listar_por_nivel(self, nivel_id: int, solo_activos: bool = True) -> list[Ranking]:
        """Roster de un nivel. Ordena por `persona_id` (determinístico) --
        antes ordenaba por `posicion_actual`, pero ese campo quedó congelado
        en NULL para todas las filas desde que se removió `cerrar_mes()`
        (slice B2), así que el `ORDER BY` ya no discriminaba nada (equivalente
        a orden no determinístico dependiente del motor de DB). Ver slice E."""
        stmt = (
            select(Ranking)
            .options(joinedload(Ranking.persona))
            # Baja lógica: mismo criterio que `listar_todos` -- el roster de
            # un nivel es operativo (quién entrena y compite en él hoy).
            .join(Persona, Persona.id == Ranking.persona_id)
            .where(Ranking.nivel_ranking_id == nivel_id, Persona.activo.is_(True))
        )
        if solo_activos:
            stmt = stmt.where(Ranking.esta_en_ranking.is_(True))
        stmt = stmt.order_by(Ranking.persona_id.asc())
        return list(self.db.execute(stmt).scalars().all())

    def crear(self, ranking: Ranking) -> Ranking:
        self.db.add(ranking)
        self.db.commit()
        self.db.refresh(ranking)
        return ranking

    def guardar_cambios(self, ranking: Ranking) -> Ranking:
        self.db.commit()
        self.db.refresh(ranking)
        return ranking


class NotificacionRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, notificacion: Notificacion) -> Notificacion:
        self.db.add(notificacion)
        self.db.commit()
        self.db.refresh(notificacion)
        return notificacion

    def listar_por_persona(self, persona_id: int) -> list[Notificacion]:
        return (
            self.db.query(Notificacion)
            .filter(Notificacion.persona_id == persona_id)
            .order_by(Notificacion.fecha_creacion.desc())
            .all()
        )

    def marcar_leida(self, notificacion: Notificacion) -> Notificacion:
        notificacion.leida = True
        self.db.commit()
        self.db.refresh(notificacion)
        return notificacion
