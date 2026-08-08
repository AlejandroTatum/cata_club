"""Siembra compartida de `categoria_horario`/`categoria_horario_dia` para
tests que ejecutan `seed_dev_base.main()` (o cualquier código que lea vía
`CategoriaRepositorio`) contra un motor en memoria creado con
`Base.metadata.create_all()` -- a diferencia de `alembic upgrade head`, eso
NO corre el data-seed de la migración `a4e7c2f9b1d8`.

Una constante más una función, no un fixture de pytest: nada acá necesita
la resolución de fixtures de pytest (sin `request`, sin scope), así que un
fixture en `conftest.py` solo agregaría indirección. Vive en su propio
módulo -- no en `conftest.py` -- para no mezclar datos de siembra con el
espacio de fixtures que pytest resuelve por magia (mismo criterio que
separó `arnes_migraciones.py` de `conftest.py`).
"""
from datetime import time

from app.dominio.enums import DiaSemana
from app.dominio.modelos import CategoriaHorario, CategoriaHorarioDia

LUN_VIE = (
    DiaSemana.LUNES, DiaSemana.MARTES, DiaSemana.MIERCOLES,
    DiaSemana.JUEVES, DiaSemana.VIERNES,
)
LUN_SAB = LUN_VIE + (DiaSemana.SABADO,)

# Misma copia literal que siembra `a4e7c2f9b1d8` -- ver esa migración para
# la fuente real en Postgres.
CATEGORIAS_SEED = [
    ("FORMATIVO", "Formativo", time(15, 0), time(16, 0), LUN_VIE),
    ("INFANTIL", "Infantil", time(16, 0), time(17, 0), LUN_VIE),
    ("JUVENIL", "Juvenil", time(17, 0), time(18, 0), LUN_VIE),
    ("COMPETITIVO", "Competitivo", time(18, 0), time(20, 0), LUN_SAB),
    ("ADULTOS", "Adultos", time(20, 0), time(21, 15), LUN_VIE),
]


def sembrar_categorias(session_factory) -> None:
    """Abre una sesión desde `session_factory` (el `sessionmaker` del motor
    en memoria), siembra las 5 categorías + sus días permitidos, y comitea."""
    with session_factory() as sesion:
        for codigo, label, hora_inicio, hora_fin, dias in CATEGORIAS_SEED:
            sesion.add(CategoriaHorario(
                codigo=codigo, label=label, hora_inicio=hora_inicio, hora_fin=hora_fin,
            ))
            for dia in dias:
                sesion.add(CategoriaHorarioDia(categoria_codigo=codigo, dia_semana=dia))
        sesion.commit()
