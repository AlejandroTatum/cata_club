"""Días sin clase del club entero (issue #1665).

Solo el administrador crea, edita o borra (lo exige el router); cualquier
usuario autenticado los lee. Un día sin clase NO toca cobertura ni cuotas: solo
deja de contar como sesión programada.

Decisión de producto: la campana se emite UNA vez, al crear, y el correo la
víspera del inicio (issue #1709, ver `dia_sin_clase_tareas`). Editar o borrar
no reenvía nada en el momento -- reenviar por cada retoque de un texto
gastaría el cupo diario de correo del plan gratuito --; mover las fechas sí
borra las marcas del correo y vuelve a publicar el aviso: la tarea decide si
el correo sale ya (la víspera de la fecha nueva ya pasó) o la víspera.
"""
import logging
from datetime import date

from sqlalchemy import delete
from sqlalchemy import inspect as inspeccionar_orm
from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadNoEncontrada, RecursoEnUso, ServicioNoDisponible
from app.dominio.modelos import DiaSinClase, DiaSinClaseCorreo
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
        """Vuelve a encolar la campana, sin correo (#1709): el correo lo manda
        la víspera. La dedup de la tarea hace que solo alcance a las cuentas
        que nunca la recibieron."""
        dia = self._obtener(dia_id)
        if dia.fecha_fin < hoy_club():
            raise RecursoEnUso("Ese día sin clase ya terminó: no se avisa de fechas pasadas.")
        if not self._encolar_aviso(dia.id, con_correo=False):
            raise ServicioNoDisponible("No se pudo encolar el aviso. Intenta de nuevo en unos minutos.")

    def actualizar(self, dia_id: int, datos: DiaSinClaseUpdateDTO) -> DiaSinClase:
        dia = self._obtener(dia_id)
        mueve_fechas = (dia.fecha_inicio, dia.fecha_fin) != (datos.fecha_inicio, datos.fecha_fin)
        if mueve_fechas:
            self.db.execute(
                delete(DiaSinClaseCorreo).where(DiaSinClaseCorreo.dia_sin_clase_id == dia.id)
            )
        dia.fecha_inicio = datos.fecha_inicio
        dia.fecha_fin = datos.fecha_fin
        dia.motivo = datos.motivo
        self.db.commit()
        if inspeccionar_orm(dia).expired:
            self.db.refresh(dia)
        if mueve_fechas:
            # Si la fecha nueva es hoy, o mañana pasadas las 08:00, la víspera
            # ya no va a correr para ella: la tarea manda el correo ya. Si no,
            # solo completa campanas y el correo queda para la víspera.
            self._encolar_aviso(dia.id)
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
    def _encolar_aviso(dia_id: int, con_correo: bool = True) -> bool:
        """Publica la tarea que avisa a los socios, DESPUÉS del commit. Un
        broker caído no propaga: el día ya quedó creado y el admin no debe
        reintentar un alta que sí ocurrió (mismo criterio que el comprobante
        de pago)."""
        from app.infraestructura.tareas.celery_app import celery_app

        try:
            if con_correo:
                celery_app.send_task(TAREA_AVISO, args=[dia_id])
            else:
                celery_app.send_task(TAREA_AVISO, args=[dia_id], kwargs={"con_correo": False})
            return True
        except Exception:
            logger.exception(
                "No se pudo encolar el aviso del día sin clase %s (¿broker caído?)", dia_id,
            )
            return False
