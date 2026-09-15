"""Migración PostgreSQL del ledger de representación."""
import pytest
from sqlalchemy.exc import DBAPIError

from app.dominio.modelos import VinculacionRepresentante


REVISION_ANTERIOR = "g1139repmenor"
REVISION_NUEVA = "h1140rep_auditoria"


def _persona(arnes, persona_id: int, cedula: str) -> None:
    arnes.ejecutar(
        """INSERT INTO persona
           (id, nombres, apellidos, cedula, fecha_nacimiento, telefono,
            fecha_registro, activo)
           VALUES (:id, 'Ana', 'Torres', :cedula, DATE '1990-01-01',
                   '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', true)""",
        id=persona_id, cedula=cedula,
    )


def _evento(arnes, values: str) -> None:
    arnes.ejecutar(
        """INSERT INTO vinculacion_representante
           (persona_id, actor_persona_id, representante_anterior_id,
            representante_nuevo_id, operacion, origen, idempotency_key,
            request_fingerprint)
           VALUES """ + values
    )


def test_empty_to_head_creates_audit_contract(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    arnes_migracion.migrar(REVISION_NUEVA)
    assert arnes_migracion.revision_actual() == REVISION_NUEVA
    columns = arnes_migracion.consultar(
        """SELECT column_name, is_nullable FROM information_schema.columns
           WHERE table_name = 'vinculacion_representante'
           ORDER BY ordinal_position"""
    )
    assert ("representante_nuevo_id", "YES") in columns
    assert {name for name, nullable in columns if nullable == "NO"} >= {
        "actor_persona_id", "operacion", "origen",
    }
    indexes = {
        row[0] for row in arnes_migracion.consultar(
            """SELECT indexname FROM pg_indexes
               WHERE tablename = 'vinculacion_representante'"""
        )
    }
    assert {
        "ix_vinculacion_representante_persona_fecha_id",
        "ix_vinculacion_representante_actor_persona_id",
        "uq_vinculacion_representante_idempotency_key",
    } <= indexes
    # `information_schema.triggers` sigue el estándar SQL y no expone el
    # evento TRUNCATE: el catálogo de PostgreSQL sí lo lista.
    triggers = {
        fila[0] for fila in arnes_migracion.consultar(
            """SELECT tg.tgname FROM pg_trigger tg
               JOIN pg_class rel ON rel.oid = tg.tgrelid
               WHERE rel.relname = 'vinculacion_representante'
                 AND NOT tg.tgisinternal"""
        )
    }
    assert {
        "trg_vinculacion_representante_append_only",
        "trg_vinculacion_representante_truncate",
    } <= triggers

def test_legacy_rows_are_backfilled(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _persona(arnes_migracion, 1, "1710034065")
    _persona(arnes_migracion, 2, "1710034073")
    arnes_migracion.ejecutar(
        """INSERT INTO vinculacion_representante
           (persona_id, representante_anterior_id, representante_nuevo_id)
           VALUES (2, NULL, 1)"""
    )
    arnes_migracion.migrar(REVISION_NUEVA)
    assert arnes_migracion.consultar(
        "SELECT actor_persona_id, operacion, origen, representante_nuevo_id "
        "FROM vinculacion_representante"
    ) == [(1, "REASIGNACION", "AUTOSERVICIO_LEGADO", 1)]


def test_invalid_shape_duplicate_key_and_mutation_are_rejected(arnes_migracion):
    arnes_migracion.preparar("head")
    for persona_id in (1, 2, 3):
        _persona(arnes_migracion, persona_id, f"17100340{persona_id}5")
    _evento(arnes_migracion, "(2, 1, NULL, 1, 'CREACION', 'SESION_AUTENTICADA', 'key-1', repeat('a', 64))")
    with pytest.raises(DBAPIError):
        _evento(arnes_migracion, "(2, 1, 1, NULL, 'CREACION', 'ADMIN_PRESENCIAL', NULL, NULL)")
    with pytest.raises(DBAPIError):
        _evento(arnes_migracion, "(2, 1, NULL, 1, 'CREACION', 'SESION_AUTENTICADA', 'key-1', repeat('a', 64))")
    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar("UPDATE vinculacion_representante SET origen = 'ADMIN_PRESENCIAL'")
    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar("DELETE FROM vinculacion_representante")
    with pytest.raises(DBAPIError):
        _evento(arnes_migracion, "(3, 1, NULL, 1, 'CREACION', 'ORIGEN_INEXISTENTE', NULL, NULL)")
    with pytest.raises(DBAPIError):
        _evento(arnes_migracion, "(3, 1, NULL, 1, 'CREACION', 'SESION_AUTENTICADA', 'key-2', repeat('g', 63))")


def test_truncate_is_rejected_and_ledger_survives(arnes_migracion):
    arnes_migracion.preparar("head")
    for persona_id in (1, 2):
        _persona(arnes_migracion, persona_id, f"17100340{persona_id}5")
    _evento(arnes_migracion, "(2, 1, NULL, 1, 'CREACION', 'SESION_AUTENTICADA', 'key-1', repeat('a', 64))")
    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar("TRUNCATE vinculacion_representante")
    assert arnes_migracion.consultar(
        "SELECT count(*) FROM vinculacion_representante"
    ) == [(1,)]


def test_migrated_check_constraints_match_orm_metadata(arnes_migracion):
    arnes_migracion.preparar("head")
    checks_en_bd = {
        fila[0] for fila in arnes_migracion.consultar(
            """SELECT con.conname FROM pg_constraint con
               JOIN pg_class rel ON rel.oid = con.conrelid
               WHERE rel.relname = 'vinculacion_representante'
                 AND con.contype = 'c'"""
        )
    }
    checks_en_orm = {
        c.name for c in VinculacionRepresentante.__table__.constraints
        if c.name and c.name.startswith("ck_")
    }
    assert checks_en_orm == checks_en_bd

def test_database_accepts_reassignment_and_independence(arnes_migracion):
    arnes_migracion.preparar("head")
    for persona_id in (1, 2, 3):
        _persona(arnes_migracion, persona_id, f"17100340{persona_id}5")
    _evento(arnes_migracion, "(3, 1, 2, 1, 'REASIGNACION', 'ADMIN_PRESENCIAL', 'reassign-1', repeat('b', 64))")
    _evento(arnes_migracion, "(2, 1, 3, NULL, 'INDEPENDENCIA', 'ADMIN_PRESENCIAL', NULL, NULL)")
    assert arnes_migracion.consultar(
        "SELECT operacion, representante_nuevo_id FROM vinculacion_representante ORDER BY id"
    ) == [("REASIGNACION", 1), ("INDEPENDENCIA", None)]
