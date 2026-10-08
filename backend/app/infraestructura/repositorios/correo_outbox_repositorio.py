"""Reclamo con lease y backoff de la cola genérica de correos (issue #1710).

La política es la compartida de `outbox_lease_repositorio`.
"""
from app.dominio.modelos import CorreoOutbox
from app.infraestructura.repositorios.outbox_lease_repositorio import (
    MAX_ATTEMPTS,
    ColaConLeaseRepositorio,
)

__all__ = ["MAX_ATTEMPTS", "CorreoOutboxRepositorio"]


class CorreoOutboxRepositorio(ColaConLeaseRepositorio):
    modelo = CorreoOutbox
