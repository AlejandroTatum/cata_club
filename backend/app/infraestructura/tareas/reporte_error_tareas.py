"""Retención automática de reportes sensibles (#1401)."""
from datetime import datetime, timedelta, timezone

from app.infraestructura.db import SessionLocal
from app.infraestructura.repositorios.reporte_error_repositorio import ReporteErrorRepositorio
from app.infraestructura.tareas.celery_app import celery_app


@celery_app.task(name="app.infraestructura.tareas.reporte_error_tareas.purgar_reportes_error")
def purgar_reportes_error() -> int:
    with SessionLocal() as db:
        borrados = ReporteErrorRepositorio(db).purgar_anteriores(
            datetime.now(timezone.utc) - timedelta(days=90)
        )
        db.commit()
        return borrados
