"""Persistencia de intentos de autoinscripción idempotentes."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.dominio.modelos import InscripcionIdempotencia


ESTADO_PENDIENTE = "PENDIENTE"
ESTADO_COMPLETADA = "COMPLETADA"
TTL_HORAS = 24


def _ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


class InscripcionIdempotenciaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_clave(self, idempotency_key: str) -> Optional[InscripcionIdempotencia]:
        return self.db.get(InscripcionIdempotencia, idempotency_key)

    def crear_pendiente(
        self,
        idempotency_key: str,
        request_fingerprint: str,
        *,
        vence_en: Optional[datetime] = None,
    ) -> InscripcionIdempotencia:
        """Añade el intento a la transacción actual y fuerza la PK."""
        ahora = _ahora_utc()
        registro = InscripcionIdempotencia(
            idempotency_key=idempotency_key,
            request_fingerprint=request_fingerprint,
            estado=ESTADO_PENDIENTE,
            created_at=ahora,
            vence_en=vence_en or ahora + timedelta(hours=TTL_HORAS),
        )
        self.db.add(registro)
        self.db.flush()
        return registro

    def marcar_completada(self, registro: InscripcionIdempotencia, persona_id: int) -> None:
        registro.estado = ESTADO_COMPLETADA
        registro.persona_id = persona_id
        registro.completed_at = _ahora_utc()
        self.db.commit()

    def eliminar(self, registro: InscripcionIdempotencia) -> None:
        self.db.delete(registro)
        self.db.flush()

    def eliminar_expiradas(self, *, limite: Optional[datetime] = None) -> int:
        """Sin caller en producción hoy -- solo `flush()` (issue #831): la
        futura tarea de limpieza que lo agende es quien debe comitear."""
        limite = limite if limite is not None else _ahora_utc()
        resultado = self.db.execute(
            delete(InscripcionIdempotencia).where(
                InscripcionIdempotencia.vence_en < limite
            )
        )
        self.db.flush()
        return resultado.rowcount
