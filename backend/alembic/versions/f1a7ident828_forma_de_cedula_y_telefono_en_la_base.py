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

POR QUÉ `persona.telefono` NO LLEVA CHECK Y LAS OTRAS TRES SÍ
------------------------------------------------------------
La asimetría es deliberada y tiene una causa concreta. Tres columnas
encodean la MISMA regla y una se comporta distinto; eso es peor que la
uniformidad en todo salvo en una cosa, que es la que manda acá: la opción
uniforme rompe datos vivos.

- `persona.cedula`: se pasaron las filas de staging y de QA por el
  `es_cedula_valida` real (no por una reimplementación en SQL). Cero fallas
  de forma, cero de provincia, cero de verificador. Un CHECK validado no
  puede abortar nada, así que va validado.
- `persona.telefono`: NO LLEVA CONSTRAINT EN LA BASE. Su única garantía es
  el `@validates` del ORM. Una fila de staging tiene `0000000000`, el
  default de bootstrap del `crear_primer_admin.py` anterior a este cambio:
  diez dígitos que no empiezan en `09`, así que no es ni celular ni fijo.
  Cualquier CHECK sobre esa columna -- validado o `NOT VALID`, da exactamente
  igual -- deja esa fila IMPOSIBLE DE ESCRIBIR. `NOT VALID` no es una salida:
  solo saltea el recorrido inicial de la tabla; Postgres reevalúa el CHECK
  contra la fila NUEVA COMPLETA en cada UPDATE. Con el constraint puesto,
  `UPDATE persona SET nombres = ...` sobre el administrador de bootstrap
  arrastra su `telefono` viejo a la revalidación y Postgres lo rechaza: la
  fila queda congelada contra todo cambio de nombre, de `activo` o de foto,
  y el error emerge como `IntegrityError` sin atrapar, o sea HTTP 500. El
  candado está en `test_migracion_identidad_forma.py::
  test_la_fila_legacy_sigue_siendo_editable_en_sus_otros_campos`.
  CÓMO SE CIERRA: esto es deuda de DATOS, no de código, y repararla es una
  decisión humana que no le toca a esta migración -- por eso acá no se
  reescribe ni se normaliza ningún valor. Cuando alguien aporte el teléfono
  real del administrador y esa fila se corrija a mano, una migración
  posterior puede agregar `ck_persona_telefono_forma` ya validado, y ahí
  recién las tres columnas de teléfono se comportan igual.
- `persona.telefono_contacto` y `ficha_medica.telefono_emergencia`: van
  VALIDADOS. Se inspeccionaron staging y QA en solo lectura:
  `telefono_contacto` tiene 0 filas no nulas en ambos (0/12 y 0/11);
  `telefono_emergencia` tiene 8 no nulas en staging, todas válidas, y 0 en
  QA. Validar no puede abortar el deploy ni congelar ninguna fila, y un
  constraint validado es una garantía más fuerte que uno `NOT VALID`, así
  que no hay razón para debilitarlos por simetría con una columna cuyo
  problema ellos no tienen.

Las dos columnas de teléfono que sí llevan constraint toleran la cadena
vacía (`''` = "sin teléfono", ver `_exigir_telefono_valido` en
`dominio/modelos.py`); la cédula no la tolera: es NOT NULL y única.
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

# (constraint, tabla, columna) para las columnas de teléfono que SÍ llevan
# constraint. `persona.telefono` NO está acá a propósito: su fila legacy de
# staging quedaría congelada (ver docstring). Ambas son nullable, de ahí el
# `IS NULL` de la plantilla.
_CHECKS_TELEFONO: tuple[tuple[str, str, str], ...] = (
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

    # Validados. Lo que lo permite no es que "validar sea seguro" en general
    # -- un CHECK validado aborta el deploy si alguna fila lo viola, y deja
    # congelada a cualquiera que lo viole -- sino que estas dos columnas no
    # tienen NINGUNA fila que pueda violarlo: cero no nulas en staging y QA
    # para `telefono_contacto`, y ocho en staging para `telefono_emergencia`,
    # todas válidas (ver docstring).
    for nombre, tabla, columna in _CHECKS_TELEFONO:
        op.execute(
            f"ALTER TABLE {tabla} ADD CONSTRAINT {nombre} CHECK ("
            f"{columna} IS NULL OR {columna} = '' "
            f"OR {columna} ~ '{_RE_TELEFONO_FORMA}'"
            ")"
        )


def downgrade() -> None:
    for nombre, tabla, _columna in reversed(_CHECKS_TELEFONO):
        op.execute(f"ALTER TABLE {tabla} DROP CONSTRAINT {nombre}")
    op.execute(f"ALTER TABLE persona DROP CONSTRAINT {_CK_CEDULA}")
