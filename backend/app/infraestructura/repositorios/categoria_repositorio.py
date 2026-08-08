from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.dominio.modelos import CategoriaHorario


class CategoriaRepositorio:
    """Lee `categoria_horario` (+ sus `categoria_horario_dia`) -- la única
    fuente de la que `hora_inicio`/`hora_fin`/días permitidos se derivan.

    Solo lectura a propósito: este cambio no agrega un endpoint ni una
    pantalla para crear o editar categorías (es otra decisión, otro PR);
    hoy las filas las siembra la migración que creó la tabla."""

    def __init__(self, db: Session):
        self.db = db

    def listar(self) -> List[CategoriaHorario]:
        stmt = select(CategoriaHorario).options(joinedload(CategoriaHorario.dias_permitidos))
        return list(self.db.execute(stmt).unique().scalars().all())

    def obtener_por_codigo(self, codigo: str) -> Optional[CategoriaHorario]:
        stmt = (
            select(CategoriaHorario)
            .options(joinedload(CategoriaHorario.dias_permitidos))
            .where(CategoriaHorario.codigo == codigo)
        )
        return self.db.execute(stmt).unique().scalar_one_or_none()
