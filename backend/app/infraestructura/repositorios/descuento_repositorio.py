from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dominio.modelos import AsignacionDescuento, Descuento


class DescuentoRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, descuento_id: int) -> Optional[Descuento]:
        return self.db.get(Descuento, descuento_id)

    def obtener_por_nombre(self, nombre: str) -> Optional[Descuento]:
        stmt = select(Descuento).where(Descuento.nombre == nombre)
        return self.db.execute(stmt).scalars().first()

    def listar(self, skip: int = 0, limit: Optional[int] = None) -> List[Descuento]:
        """Catálogo completo, INCLUIDOS los inactivos: el listado es del
        administrador, que necesita ver (y poder reactivar) la historia.

        Orden por `id`, SIN cambios (D4): a diferencia de geografía, este
        catálogo tiene un consumidor real (`frontend/src/app/discounts/
        page.tsx`) y reordenarlo sería un cambio de comportamiento visible
        sobre un endpoint ya consumido. `id` ya es un orden TOTAL, así que
        la paginación sobre él ya es determinística sin desempate extra."""
        stmt = select(Descuento).order_by(Descuento.id).offset(skip)
        if limit is not None:          # None = sin tope: preserva a los
            stmt = stmt.limit(limit)   # llamadores actuales, que piden todo
        return list(self.db.execute(stmt).scalars().all())

    def contar(self) -> int:
        stmt = select(func.count()).select_from(Descuento)
        return self.db.execute(stmt).scalar_one()

    def crear(self, descuento: Descuento) -> Descuento:
        self.db.add(descuento)
        self.db.flush()
        return descuento

    def guardar_cambios(self, descuento: Descuento) -> Descuento:
        self.db.flush()
        return descuento


class AsignacionDescuentoRepositorio:
    """Acceso a datos de `AsignacionDescuento` (issue #398). Deliberadamente
    fino: la decisión de qué constituye "vigente", quién puede asignar/
    retirar, y la traducción del `IntegrityError` de la carrera al error de
    dominio amigable viven en `BeneficioServicio`, no acá -- mismo reparto de
    responsabilidades que `DescuentoRepositorio`/`MembresiaServicio` arriba."""

    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, asignacion_id: int) -> Optional[AsignacionDescuento]:
        """A diferencia de `obtener_activa_por_persona`, no filtra por
        vigencia: `CoberturaBonificadaResponseDTO` (issue #400/4d) enlaza
        permanentemente a la asignación que la originó, y ese vínculo debe
        seguir resolviendo aunque la asignación se haya retirado después."""
        return self.db.get(AsignacionDescuento, asignacion_id)

    def obtener_activa_por_persona(self, persona_id: int) -> Optional[AsignacionDescuento]:
        """La asignación VIGENTE de una persona, si tiene una. "Vigente" es
        `retirado_en IS NULL` -- el mismo criterio que el índice único
        parcial `uq_asignacion_descuento_activa_por_persona` (ver su
        docstring en `modelos.py`), así esta lectura y la red de seguridad de
        la base nunca pueden divergir sobre qué cuenta como "activa"."""
        stmt = select(AsignacionDescuento).where(
            AsignacionDescuento.persona_id == persona_id,
            AsignacionDescuento.retirado_en.is_(None),
        )
        return self.db.execute(stmt).scalars().first()

    def crear(self, asignacion: AsignacionDescuento) -> AsignacionDescuento:
        self.db.add(asignacion)
        self.db.flush()
        return asignacion

    def guardar_cambios(self, asignacion: AsignacionDescuento) -> AsignacionDescuento:
        self.db.flush()
        return asignacion
