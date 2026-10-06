"""Días sin clase del club entero (issue #1665).

Solo el administrador crea, edita o borra (lo exige el router); cualquier
usuario autenticado los lee. Un día sin clase NO toca cobertura ni cuotas: solo
deja de contar como sesión programada.

Decisión de producto: el aviso (campana + correo) se emite UNA vez, al crear.
Editar o borrar no reenvía nada -- reenviar correo por cada retoque de un
texto gastaría el cupo diario de correo del plan gratuito.
"""
import logging
from datetime import date

from sqlalchemy import inspect as inspeccionar_orm
from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadNoEncontrada, RecursoEnUso, ServicioNoDisponible
from app.dominio.modelos import DiaSinClase
from app.infraestructura.repositorios.dia_sin_clase_repositorio import DiaSinClaseRepositorio
from app.soporte_transversal.tiempo import hoy_club
from app.servicios_negocio.dtos.dia_sin_clase_schemas import (
    DiaSinClaseCreateDTO,
    DiaSinClaseUpdateDTO,
)

logger = logging.getLogger("cataclub.dia_sin_clase")

TAREA_AVISO = "app.infraestructura.tareas.dia_sin_clase_tareas.avisar_dia_sin_clase"


class DiaSinClaseServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = DiaSinClaseRepositorio(db)

    def listar(self, desde: date | None = None, hasta: date | None = None) -> list[DiaSinClase]:
        return self.repo.listar(desde, hasta)

    def crear(self, datos: DiaSinClaseCreateDTO) -> tuple[DiaSinClase, bool]:
        """Devuelve el día y si el aviso quedó encolado: un broker caído no
        deshace el alta, pero el admin tiene que enterarse para reenviarlo."""
        dia = self.repo.crear(DiaSinClase(
            fecha_inicio=datos.fecha_inicio,
            fecha_fin=datos.fecha_fin,
            motivo=datos.motivo,
        ))
        self.db.commit()
        if inspeccionar_orm(dia).expired:
            self.db.refresh(dia)
        return dia, self._encolar_aviso(dia.id)

    def reenviar_aviso(self, dia_id: int) -> None:
        """Vuelve a encolar el aviso. La dedup de la tarea hace que solo
        alcance a las cuentas que nunca lo recibieron."""
        dia = self._obtener(dia_id)
        if dia.fecha_fin < hoy_club():
            raise RecursoEnUso("Ese día sin clase ya terminó: no se avisa de fechas pasadas.")
        if not self._encolar_aviso(dia.id):
            raise ServicioNoDisponible("No se pudo encolar el aviso. Intenta de nuevo en unos minutos.")

    def actualizar(self, dia_id: int, datos: DiaSinClaseUpdateDTO) -> DiaSinClase:
        dia = self._obtener(dia_id)
        dia.fecha_inicio = datos.fecha_inicio
        dia.fecha_fin = datos.fecha_fin
        dia.motivo = datos.motivo
        self.db.commit()
        if inspeccionar_orm(dia).expired:
            self.db.refresh(dia)
        return dia

    def eliminar(self, dia_id: int) -> None:
        self.repo.eliminar(self._obtener(dia_id))
        self.db.commit()

    def _obtener(self, dia_id: int) -> DiaSinClase:
        dia = self.repo.obtener_por_id(dia_id)
        if dia is None:
            raise EntidadNoEncontrada(f"Día sin clase con id {dia_id} no encontrado")
        return dia

    @staticmethod
    def _encolar_aviso(dia_id: int) -> bool:
        """Publica la tarea que avisa a los socios, DESPUÉS del commit. Un
        broker caído no propaga: el día ya quedó creado y el admin no debe
        reintentar un alta que sí ocurrió (mismo criterio que el comprobante
        de pago)."""
        from app.infraestructura.tareas.celery_app import celery_app

        try:
            celery_app.send_task(TAREA_AVISO, args=[dia_id])
            return True
        except Exception:
            logger.exception(
                "No se pudo encolar el aviso del día sin clase %s (¿broker caído?)", dia_id,
            )
            return False
