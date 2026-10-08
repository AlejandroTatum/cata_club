"""Reclamo con lease y backoff del outbox de verificación de correo.

La política es la compartida de `outbox_lease_repositorio` (issue #1710), la
misma que recuperación (#790): ahora también con el arreglo del #791 para el
lease vencido en el último intento, que esta copia no tenía.
"""
from app.dominio.modelos import VerificacionCorreoOutbox
from app.infraestructura.repositorios.outbox_lease_repositorio import (
    MAX_ATTEMPTS,
    ColaConLeaseRepositorio,
)

__all__ = ["MAX_ATTEMPTS", "VerificacionCorreoOutboxRepositorio"]


class VerificacionCorreoOutboxRepositorio(ColaConLeaseRepositorio):
    modelo = VerificacionCorreoOutbox
