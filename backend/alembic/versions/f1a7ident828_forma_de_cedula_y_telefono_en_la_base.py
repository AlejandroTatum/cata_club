"""forma de cédula y teléfono en la base (issue #828)

Revision ID: f1a7ident828
Revises: d4f8c2a6b0e3
Create Date: 2026-08-30

Segunda capa del invariante de identidad. La primera vive en el ORM
(`@validates` en `Persona` y `FichaMedica`, `dominio/modelos.py`) y cubre la
regla COMPLETA reusando `es_cedula_valida`/`es_telefono_valido`. Esta capa
cubre la FORMA en la base de datos, para que ni una escritura por SQL crudo
-- una corrección manual en producción, un script de migración de datos, un
`psql` apurado -- pueda dejar identidad con forma imposible.

QUÉ SE VALIDA Y QUÉ NO
----------------------
El dígito verificador de la cédula NO entra acá, deliberadamente.
Implementarlo exigiría una función PL/pgSQL con el algoritmo del módulo 10
escrito por segunda vez en otro lenguaje, y dos copias del mismo algoritmo
son exactamente el defecto que el carril de identidad (`dominio/cedula.py`)
existe para borrar: cualquier corrección futura tendría que acertarle a las
dos. Queda un hueco residual conocido y acotado: una escritura por SQL crudo
que esquive el ORM puede insertar una cédula con forma válida y verificador
roto. Ningún camino productivo escribe así, y el test
`test_persona_identidad_invariante.py::
test_sql_crudo_admite_cedula_con_forma_valida_y_verificador_roto` deja el
hueco escrito y en verde, para que el día que se cierre haya que romperlo a
propósito en vez de descubrirlo.

POR QUÉ EL TELÉFONO VA `NOT VALID` Y LA CÉDULA NO
-------------------------------------------------
No es una omisión ni un atajo: es lo que dicen los datos reales.

- `persona.cedula`: se pasaron las filas de staging y de QA por el
  `es_cedula_valida` real (no por una reimplementación en SQL). Cero fallas
  de forma, cero de provincia, cero de verificador. Un CHECK validado no
  puede abortar nada, así que va validado.
- `persona.telefono`: una fila de staging tiene `0000000000`, el default de
  bootstrap del `crear_primer_admin.py` anterior a este cambio. Diez dígitos
  que no empiezan en `09`: no es un celular ni un fijo. Un CHECK validado
  sobre esa columna haría que `alembic upgrade head` ABORTARA el deploy de
  staging al recorrer la tabla. `NOT VALID` deja esa fila histórica quieta y
  aun así Postgres aplica el constraint a TODO INSERT y UPDATE posterior,
  que es la garantía que este issue pide. La fila legacy queda como deuda de
  datos, no de código: se la corrige con el teléfono real del administrador
  cuando alguien lo tenga, y ahí recién se puede `VALIDATE CONSTRAINT`.
- `persona.telefono_contacto` y `ficha_medica.telefono_emergencia`: hoy no
  tienen ni una fila no nula en staging ni en QA, así que podrían ir
  validados. Van `NOT VALID` igual, por coherencia con `telefono`: las tres
  columnas encodean la MISMA regla, y que una se comporte distinto según
  cuántas filas había el día que se escribió esta migración es una trampa
  para el próximo que las lea.

Las cuatro toleran la cadena vacía (`''` = "sin teléfono", ver
`_exigir_telefono_valido` en `dominio/modelos.py`); la cédula no la tolera:
es NOT NULL y única.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f1a7ident828'
down_revision: Union[str, Sequence[str], None] = 'd4f8c2a6b0e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Misma regla que `es_cedula_valida` MENOS el dígito verificador: diez
# dígitos cuyos dos primeros son una provincia existente -- `01`-`24`, o `30`
# para personas registradas en el exterior. Debe mantenerse en sincronía con
# `_RE_CEDULA_FORMA` de `dominio/modelos.py`, verificado por
# `test_persona_identidad_invariante.py`.
_RE_CEDULA_FORMA = "^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$"
# Misma regla que `es_telefono_valido`: celular de 10 dígitos que empieza en
# `09`, o fijo de 9 dígitos que empieza en `0`.
_RE_TELEFONO_FORMA = "^(09[0-9]{8}|0[0-9]{8})$"

_CK_CEDULA = "ck_persona_cedula_forma"

# (constraint, tabla, columna) para las columnas de teléfono: las tres se
# crean con la misma plantilla y el mismo `NOT VALID`.
_CHECKS_TELEFONO: tuple[tuple[str, str, str], ...] = (
    ("ck_persona_telefono_forma", "persona", "telefono"),
    ("ck_persona_telefono_contacto_forma", "persona", "telefono_contacto"),
    (
        "ck_ficha_medica_telefono_emergencia_forma",
        "ficha_medica",
        "telefono_emergencia",
    ),
)


def upgrade() -> None:
    # Validado: 0 violaciones en staging y QA (ver docstring).
    op.execute(
        f"ALTER TABLE persona ADD CONSTRAINT {_CK_CEDULA} "
        f"CHECK (cedula ~ '{_RE_CEDULA_FORMA}')"
    )

    for nombre, tabla, columna in _CHECKS_TELEFONO:
        # `IS NULL` sobra en `persona.telefono` (es NOT NULL) pero no molesta,
        # y mantener una sola plantilla evita que las tres reglas se separen.
        op.execute(
            f"ALTER TABLE {tabla} ADD CONSTRAINT {nombre} CHECK ("
            f"{columna} IS NULL OR {columna} = '' "
            f"OR {columna} ~ '{_RE_TELEFONO_FORMA}'"
            ") NOT VALID"
        )


def downgrade() -> None:
    for nombre, tabla, _columna in reversed(_CHECKS_TELEFONO):
        op.execute(f"ALTER TABLE {tabla} DROP CONSTRAINT {nombre}")
    op.execute(f"ALTER TABLE persona DROP CONSTRAINT {_CK_CEDULA}")
