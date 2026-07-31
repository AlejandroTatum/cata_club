from typing import Optional
from sqlalchemy.orm import Session

from app.dominio.modelos import Rol
from app.dominio.enums import TipoRol


class RolRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_tipo(self, tipo_rol: TipoRol) -> Optional[Rol]:
        return self.db.query(Rol).filter(Rol.tipo_rol == tipo_rol).first()

    def bloquear_por_tipo(self, tipo_rol: TipoRol) -> Optional[Rol]:
        """`SELECT ... FOR UPDATE` sobre la fila del catálogo `rol` (issue #8).

        La fila funciona como mutex del invariante "queda al menos un
        administrador activo": ese invariante tiene forma de CONTEO sobre un
        JOIN (`usuario` x `usuario_rol`), donde bloquear las filas contadas no
        alcanza -- quitar un rol borra en `usuario_rol` sin tocar la fila de
        `usuario`, así que un `FOR UPDATE` sobre `usuario` ni siquiera
        detectaría al competidor. Bloquear la fila única del catálogo
        serializa la sección completa contar-y-escribir: el segundo espera el
        commit del primero y su conteo posterior (sentencia nueva, snapshot
        nuevo bajo READ COMMITTED) ya ve el cambio. El lock se libera con el
        commit de la propia operación."""
        return (
            self.db.query(Rol)
            .filter(Rol.tipo_rol == tipo_rol)
            .with_for_update()
            .first()
        )

    def obtener_o_crear(self, tipo_rol: TipoRol) -> Rol:
        """Los `Rol` son, en la práctica, un catálogo fijo (uno por
        `TipoRol`). No hay un endpoint de "crear rol" porque no tiene
        sentido de negocio -- se garantiza que exista la fila la primera vez
        que se necesita, en vez de depender de un seed manual de BD."""
        rol = self.obtener_por_tipo(tipo_rol)
        if rol:
            return rol
        rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value.capitalize())
        self.db.add(rol)
        self.db.commit()
        self.db.refresh(rol)
        return rol
