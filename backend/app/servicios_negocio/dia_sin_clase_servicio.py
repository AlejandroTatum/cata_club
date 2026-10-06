"""Días sin clase del club entero (issue #1665).

Solo el administrador crea, edita o borra (lo exige el router); cualquier
usuario autenticado los lee. Un día sin clase NO toca cobertura ni cuotas: solo
deja de contar como sesión programada.

Decisión de producto: el aviso (campana + correo) se emite UNA vez, al crear.
Editar o borrar no reenvía nada -- reenviar correo por cada retoque de un
texto gastaría el cupo diario de correo del plan gratuito.
"""
from datetime import date

from sqlalchemy import inspect as inspeccionar_orm
from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadNoEncontrada
from app.dominio.modelos import DiaSinClase
from app.infraestructura.repositorios.dia_sin_clase_repositorio import DiaSinClaseRepositorio
from app.servicios_negocio.dtos.dia_sin_clase_schemas import (
    DiaSinClaseCreateDTO,
    DiaSinClaseUpdateDTO,
)


class DiaSinClaseServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = DiaSinClaseRepositorio(db)

    def listar(self, desde: date | None = None, hasta: date | None = None) -> list[DiaSinClase]:
        return self.repo.listar(desde, hasta)

    def crear(self, datos: DiaSinClaseCreateDTO) -> DiaSinClase:
        dia = self.repo.crear(DiaSinClase(
            fecha_inicio=datos.fecha_inicio,
            fecha_fin=datos.fecha_fin,
            motivo=datos.motivo,
        ))
        self.db.commit()
        if inspeccionar_orm(dia).expired:
            self.db.refresh(dia)
        return dia

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
