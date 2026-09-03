"""
Traducción de violaciones de integridad en DELETE a excepciones de dominio.

Sin esto, borrar una fila que otras referencian deja escapar el
`IntegrityError` crudo de SQLAlchemy: FastAPI no lo conoce, así que el cliente
recibe un 500 con traceback en el log en vez de un mensaje accionable.
`OperacionInvalida` ya está mapeada a HTTP 400 en `main.py`, así que no hace
falta un tipo de excepción nuevo.

El `rollback()` es obligatorio: tras un error, la sesión de SQLAlchemy queda
en estado "pending rollback" y CUALQUIER consulta posterior (por ejemplo el
`GET` que el frontend dispara para refrescar la lista, o el propio test que
verifica que la entidad sigue ahí) fallaría con `PendingRollbackError`.

Issue #831: solo `flush()`, nunca `commit()` -- quien decide la frontera de
la transacción es el caso de uso, no este helper. El `rollback()` del except
sigue siendo necesario (ver arriba) y, a diferencia de `CategoriaRepositorio`
(que sí dejó de atrapar y revertir, ver su docstring), acá el único llamador
(`HorarioRepositorio.eliminar`, desde `AsistenciaServicio.eliminar_horario`)
no tiene ningún otro repositorio escribiendo en la misma transacción todavía
sin comitear: revertir acá no le pisa trabajo a nadie más, y es exactamente
lo que hace atómica a `eliminar_horario` completa (issue #831, candado de
`test_transaccion_caso_de_uso_831.py`).
"""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.excepciones import OperacionInvalida


def eliminar_o_error_de_dominio(db: Session, entidad, mensaje: str) -> None:
    """Borra `entidad` (flush, sin comitear); si la BD rechaza el borrado por
    integridad referencial, revierte la sesión y lanza
    `OperacionInvalida(mensaje)`."""
    db.delete(entidad)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise OperacionInvalida(mensaje) from error
