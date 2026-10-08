"""Reclamo con lease y backoff del outbox de recuperación de contraseña.

La política es la compartida de `outbox_lease_repositorio` (issue #1710).
"""
from app.dominio.modelos import RecuperacionOutbox
from app.infraestructura.repositorios.outbox_lease_repositorio import (
    MAX_ATTEMPTS,
    ColaConLeaseRepositorio,
)

__all__ = ["MAX_ATTEMPTS", "RecuperacionOutboxRepositorio"]


class RecuperacionOutboxRepositorio(ColaConLeaseRepositorio):
    modelo = RecuperacionOutbox
