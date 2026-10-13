"""Lecturas y escritura de la reconciliación estado <-> cobertura (#1762).

Capa de infraestructura: la tarea nocturna de vencimientos la usa directamente
(no puede importar `servicios_negocio`) y `PagoServicio` delega acá la
cobertura combinada, así hay UNA sola definición de "hasta cuándo está cubierta
una membresía". La regla de qué estado corresponde vive en
`app.dominio.cobertura_estado`.
"""
from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.cobertura_estado import estado_segun_cobertura, maximo_fecha_opcional
from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import Membresia
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio
from app.infraestructura.repositorios.pago_repositorio import (
    CoberturaBonificadaRepositorio, PagoRepositorio,
)
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio


class CoberturaEstadoRepositorio:
    def __init__(self, db: Session):
        self.db = db
        self.repo_pago = PagoRepositorio(db)
        self.repo_cobertura_bonificada = CoberturaBonificadaRepositorio(db)
        self.repo_membresia = MembresiaRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)

    def fecha_fin_maxima_combinada_bulk(self, membresia_ids: list[int]) -> dict[int, date | None]:
        """`fecha_fin` más lejana entre pagos aprobados y cobertura bonificada,
        por membresía (`None` si no tiene ninguna). UNA consulta agrupada por
        fuente, nunca una por membresía."""
        if not membresia_ids:
            return {}
        fin_pagos = self.repo_pago.fecha_fin_maxima_aprobada_bulk(membresia_ids)
        fin_cobertura = self.repo_cobertura_bonificada.fecha_fin_maxima_bulk(membresia_ids)
        return {
            membresia_id: maximo_fecha_opcional(fin_pagos.get(membresia_id), fin_cobertura.get(membresia_id))
            for membresia_id in membresia_ids
        }

    def estado_corresponde(self, membresia: Membresia, cubierto_hasta: date | None, hoy: date) -> EstadoMembresia:
        """`estado_segun_cobertura` con las guardas leídas de la base."""
        persona = self.repo_persona.obtener_por_id(membresia.persona_id)
        persona_activa = persona is not None and persona.activo
        hay_otra_operativa = any(
            otra.id != membresia.id
            and otra.estado in (EstadoMembresia.ACTIVA, EstadoMembresia.SUSPENDIDA)
            for otra in self.repo_membresia.listar_por_persona(membresia.persona_id)
        )
        return estado_segun_cobertura(
            membresia.estado, cubierto_hasta, hoy,
            persona_activa=persona_activa, hay_otra_operativa=hay_otra_operativa,
        )

    def levantar_vencida(self, membresia_id: int, hoy: date) -> bool:
        """VENCIDA -> ACTIVA cuando su cobertura combinada llega a `hoy`, en su
        propia transacción (`FOR UPDATE` sobre la membresía, commit al final).
        Sin avisos ni correos: es reconciliación, no una aprobación. Devuelve
        `False` (sin error) si otra transacción ya la movió o si una guarda lo
        impide, para que el lote siga con la siguiente."""
        membresia = self.repo_membresia.obtener_por_id_con_bloqueo(membresia_id)
        if membresia is None or membresia.estado != EstadoMembresia.VENCIDA:
            self.db.rollback()
            return False
        cubierto_hasta = self.fecha_fin_maxima_combinada_bulk([membresia_id])[membresia_id]
        if self.estado_corresponde(membresia, cubierto_hasta, hoy) != EstadoMembresia.ACTIVA:
            self.db.rollback()
            return False
        membresia.estado = EstadoMembresia.ACTIVA
        try:
            self.db.flush()
            self.db.commit()
        except IntegrityError:
            # Carrera contra otra activación de la misma persona
            # (`uq_membresia_activa_por_persona`): se deja como estaba.
            self.db.rollback()
            return False
        return True
