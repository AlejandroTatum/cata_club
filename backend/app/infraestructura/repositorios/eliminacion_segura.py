"""
Traducción de violaciones de integridad en DELETE a excepciones de dominio.

Sin esto, borrar una fila que otras referencian deja escapar el
`IntegrityError` crudo de SQLAlchemy: FastAPI no lo conoce, así que el cliente
recibe un 500 con traceback en el log en vez de un mensaje accionable.
`OperacionInvalida` ya está mapeada a HTTP 400 en `main.py`, así que no hace
falta un tipo de excepción nuevo.

El `rollback()` es obligatorio: tras un error, la sesión de SQLAlchemy queda
en estado "pending rollback" y CUALQUIER consulta posterior (por ejemplo el
`GET` que el frontend dispara para refrescar la lista) fallaría con
`PendingRollbackError`.
"""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.excepciones import OperacionInvalida


def eliminar_o_error_de_dominio(db: Session, entidad, mensaje: str) -> None:
    """Borra `entidad` y confirma; si la BD rechaza el borrado por integridad
    referencial, revierte la sesión y lanza `OperacionInvalida(mensaje)`."""
    db.delete(entidad)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise OperacionInvalida(mensaje) from error
