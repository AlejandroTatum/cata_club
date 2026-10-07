"""Migración `x1666coguardian` (issue #1666): tablas del segundo guardián.

Aditiva: no reescribe `persona.representante_id` ni el ledger de
representación existente. Cubre el tope de dos guardianes en la base, que el
segundo no sea el principal, el ledger append-only y un downgrade que retira
solo lo nuevo.
"""
import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError

from tests.arnes_migraciones import ArnesMigracion

REVISION_ANTERIOR = "y1tarifaperiodicidad"
REVISION_GUARDIAN = "x1666coguardian"
TABLAS = ("co_representante", "co_representante_invitacion", "co_representante_evento")

SQL_TABLA = (
    "SELECT count(*) FROM information_schema.tables "
    "WHERE table_schema = 'public' AND table_name = :tabla"
)


def _existe(arnes: ArnesMigracion, tabla: str) -> bool:
    return arnes.consultar(SQL_TABLA, tabla=tabla)[0][0] == 1


def _sembrar_familia(arnes: ArnesMigracion) -> None:
    """1 = principal, 2 = segundo candidato, 3 = otro adulto, 4 = menor."""
    for id_, cedula, nacimiento, rep in (
        (1, "1710034065", "1980-01-01", "NULL"),
        (2, "1710034073", "1981-01-01", "NULL"),
        (3, "1710034081", "1982-01-01", "NULL"),
        (4, "1710034099", "2015-01-01", "1"),
    ):
        arnes.ejecutar(
            "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento, "
            "telefono, fecha_registro, activo, representante_id) VALUES "
            f"({id_}, 'N{id_}', 'A{id_}', '{cedula}', DATE '{nacimiento}', '0991234567', "
            f"TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE, {rep})"
        )


def _insertar_vinculo(arnes: ArnesMigracion, persona: int, co: int) -> None:
    arnes.ejecutar(
        "INSERT INTO co_representante (persona_id, co_representante_id, creado_en, "
        "creado_por_persona_id) VALUES (:p, :c, now(), 1)", p=persona, c=co,
    )


def test_upgrade_agrega_las_tablas_y_conserva_la_representacion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_familia(arnes_migracion)
    assert not any(_existe(arnes_migracion, t) for t in TABLAS)

    arnes_migracion.migrar(REVISION_GUARDIAN)

    assert arnes_migracion.revision_actual() == REVISION_GUARDIAN
    assert all(_existe(arnes_migracion, t) for t in TABLAS)
    assert arnes_migracion.consultar(
        "SELECT id, representante_id FROM persona ORDER BY id"
    ) == [(1, None), (2, None), (3, None), (4, 1)]


def test_la_base_impone_a_lo_sumo_un_segundo_guardian_por_menor(arnes_migracion):
    arnes_migracion.preparar(REVISION_GUARDIAN)
    _sembrar_familia(arnes_migracion)
    _insertar_vinculo(arnes_migracion, 4, 2)

    with pytest.raises(IntegrityError):
        _insertar_vinculo(arnes_migracion, 4, 3)


def test_el_segundo_guardian_no_puede_ser_el_principal_ni_el_propio_menor(arnes_migracion):
    arnes_migracion.preparar(REVISION_GUARDIAN)
    _sembrar_familia(arnes_migracion)

    with pytest.raises(DBAPIError):
        _insertar_vinculo(arnes_migracion, 4, 1)  # el principal
    with pytest.raises(IntegrityError):
        _insertar_vinculo(arnes_migracion, 4, 4)  # el propio menor


def test_el_ledger_de_eventos_es_append_only(arnes_migracion):
    arnes_migracion.preparar(REVISION_GUARDIAN)
    _sembrar_familia(arnes_migracion)
    arnes_migracion.ejecutar(
        "INSERT INTO co_representante_evento (fecha, persona_id, co_representante_id, "
        "actor_persona_id, operacion, origen) VALUES (now(), 4, 2, 1, 'ALTA', 'REPRESENTANTE')"
    )

    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar("UPDATE co_representante_evento SET origen = 'ADMIN'")
    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar("DELETE FROM co_representante_evento")
    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar("TRUNCATE co_representante_evento")
    with pytest.raises(IntegrityError):
        arnes_migracion.ejecutar(
            "INSERT INTO co_representante_evento (fecha, persona_id, actor_persona_id, "
            "operacion, origen) VALUES (now(), 4, 1, 'INVENTADA', 'ADMIN')"
        )


def test_downgrade_retira_solo_lo_nuevo(arnes_migracion):
    arnes_migracion.preparar(REVISION_GUARDIAN)
    _sembrar_familia(arnes_migracion)
    _insertar_vinculo(arnes_migracion, 4, 2)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert not any(_existe(arnes_migracion, t) for t in TABLAS)
    assert arnes_migracion.consultar(
        "SELECT id, representante_id FROM persona ORDER BY id"
    ) == [(1, None), (2, None), (3, None), (4, 1)]
