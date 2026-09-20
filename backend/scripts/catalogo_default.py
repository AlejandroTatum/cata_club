"""Catálogo por defecto de `categoria_horario` (definición única, #1362).

Hasta acá esta data vivía COPIADA dos veces: una literal en la migración
`a4e7c2f9b1d8` (que la sembraba en toda base nueva) y otra en
`tests/_categoria_seed.py`, con el comentario "misma copia literal" como
única garantía de que no divergieran.

Decisión del dueño (2026-09-19, issue #1362): una instalación nueva arranca
con `categoria_horario` VACÍO -- las 5 categorías dejan de ser dato de
producto y pasan a ser SOLO un fixture de dev/test. La migración
`_retirar_catalogo_sembrado` (ver el archivo bajo `alembic/versions/` que
sigue al head de este cambio) retira esas filas en toda base donde ningún
`horario_entrenamiento` las referencia; producción (que sí las referencia)
pasa intacta.

Con la migración ya no sembrando el catálogo, hacía falta UN lugar que
siguiera describiéndolo para quien todavía lo necesita:
  - `backend/scripts/seed_dev_base.py`: el entorno de desarrollo/QA sigue
    queriendo los 26 horarios de siempre (ver `HORARIO_A`/`HORARIO_B` en los
    specs `*.live.spec.ts`), así que siembra el catálogo él mismo antes de
    derivar sesiones.
  - La suite de tests (`tests/conftest.py::esquema_migrado`): ~28 archivos
    asumen que `Categoria.FORMATIVO` etc. existen como filas reales; se
    siembran una vez por sesión de pytest, después de `alembic upgrade
    head`, para no reescribir esos archivos.
  - `tests/_categoria_seed.py` sigue existiendo como re-export delgado: dos
    tests (`test_seed_dev_base.py`, `test_seed_dev_bulk.py`) siembran un
    motor SQLite en memoria a mano (`Base.metadata.create_all()` no corre
    ningún data-seed) y ya importan desde ahí.

Vive en `scripts/`, no en `app/`, por el mismo motivo que `seed_guard.py`:
es dato de siembra/fixture, no un componente del dominio que la API sirva en
runtime -- y `scripts/` ya es importable tanto por los scripts de siembra
como por la suite (ver `test_seed_guard.py`, `test_reset_dev_db.py`, etc.,
que importan `from scripts.X import ...` directamente)."""
from datetime import time

from sqlalchemy.orm import Session

from app.dominio.enums import DiaSemana
from app.dominio.modelos import CategoriaHorario, CategoriaHorarioDia

LUN_VIE = (
    DiaSemana.LUNES, DiaSemana.MARTES, DiaSemana.MIERCOLES,
    DiaSemana.JUEVES, DiaSemana.VIERNES,
)
LUN_SAB = LUN_VIE + (DiaSemana.SABADO,)

# Copia literal de `a4e7c2f9b1d8` (código/label/horas/días) y `d4c7e1b09a35`
# (la etiqueta `edades`) -- ver esas migraciones (ya aplicadas, inmutables)
# para el origen histórico de estos valores. Mismo orden que ambas: el orden
# de inserción importa para `seed_dev_base.py` (ver docstring del módulo).
CATEGORIAS_SEED = [
    ("FORMATIVO", "Formativo", "5 a 10 años", time(15, 0), time(16, 0), LUN_VIE),
    ("INFANTIL", "Infantil", "8 a 12 años", time(16, 0), time(17, 0), LUN_VIE),
    ("JUVENIL", "Juvenil", "Mayores de 12 años", time(17, 0), time(18, 0), LUN_VIE),
    ("COMPETITIVO", "Competitivo", "Selección", time(18, 0), time(20, 0), LUN_SAB),
    ("ADULTOS", "Adultos", "Mayores de 18 años", time(20, 0), time(21, 15), LUN_VIE),
]


def sembrar_catalogo_por_defecto(db: Session) -> int:
    """Inserta en `db`, vía ORM, las categorías del catálogo por defecto que
    todavía no existan -- idempotente por `codigo`, mismo criterio que
    `seed_dev_base._obtener_o_crear`. No comitea: quien abre la sesión decide
    cuándo (mismo contrato que `CategoriaRepositorio`). Devuelve cuántas
    categorías creó."""
    creadas = 0
    for codigo, label, edades, hora_inicio, hora_fin, dias in CATEGORIAS_SEED:
        ya_existe = (
            db.query(CategoriaHorario).filter(CategoriaHorario.codigo == codigo).first()
        )
        if ya_existe:
            continue
        db.add(CategoriaHorario(
            codigo=codigo, label=label, edades=edades,
            hora_inicio=hora_inicio, hora_fin=hora_fin,
        ))
        for dia in dias:
            db.add(CategoriaHorarioDia(categoria_codigo=codigo, dia_semana=dia))
        creadas += 1
    db.flush()
    return creadas


def sembrar_categorias(session_factory) -> None:
    """Abre una sesión desde `session_factory` (p. ej. el `sessionmaker` de
    un motor en memoria), siembra el catálogo por defecto y comitea. Firma
    heredada de la `tests/_categoria_seed.py` original -- se conserva para no
    tocar los tests que ya la llaman así."""
    with session_factory() as sesion:
        sembrar_catalogo_por_defecto(sesion)
        sesion.commit()
