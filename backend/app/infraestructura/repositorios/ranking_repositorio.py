from typing import Optional
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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
            .filter(Ranking.nivel_ranking_id == nivel_id)
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

    def listar_todos(self) -> list[Ranking]:
        stmt = (
            select(Ranking)
            .options(joinedload(Ranking.persona), joinedload(Ranking.nivel_ranking))
            # Baja lógica: listado OPERATIVO. Un ex-miembro no ocupa cupo de
            # nivel ni puede ser movido de nivel.
            .join(Persona, Persona.id == Ranking.persona_id)
            .where(Persona.activo.is_(True))
            .order_by(Ranking.persona_id)
        )
        return list(self.db.execute(stmt).scalars().unique().all())

    def listar_por_nivel(self, nivel_id: int) -> list[Ranking]:
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
            .order_by(Ranking.persona_id.asc())
        )
        return list(self.db.execute(stmt).scalars().all())

    def crear(self, ranking: Ranking) -> Ranking:
        self.db.add(ranking)
        self.db.commit()
        self.db.refresh(ranking)
        return ranking

    def crear_o_recuperar_por_persona(self, ranking: Ranking) -> Ranking:
        """INSERT que tolera perder la carrera contra otra transacción.

        `Ranking.persona_id` es UNIQUE, así que dos peticiones simultáneas
        para la misma persona sin fila previa leen las dos `None` e insertan
        las dos: la perdedora choca contra el índice único. Sin esto, ese
        choque sale como `IntegrityError` crudo -- que `main.py` no mapea a
        ningún código -- y el cliente recibe un 500, justo en la operación
        que anuncia ser idempotente.

        El `rollback()` NO es opcional: un flush fallido deja la sesión en
        estado inválido y cualquier consulta posterior sobre ella explota
        (`PendingRollbackError`). Recién después de deshacer se puede releer,
        y la relectura abre una transacción nueva que, en READ COMMITTED, ya
        ve la fila que la ganadora commiteó.

        Si tras el rollback la fila sigue sin existir, la violación no era la
        carrera que este método cubre (por ejemplo una FK colgante), así que
        se re-lanza sin disfrazarla.
        """
        try:
            self.db.add(ranking)
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            existente = self.obtener_por_persona(ranking.persona_id)
            if existente is None:
                raise
            return existente
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
