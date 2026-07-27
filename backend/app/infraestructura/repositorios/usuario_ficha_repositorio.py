from typing import Optional
from sqlalchemy.orm import Session

from app.dominio.enums import TipoRol
from app.dominio.modelos import FichaMedica, Rol, Usuario


class FichaMedicaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, ficha: FichaMedica) -> FichaMedica:
        self.db.add(ficha)
        self.db.commit()
        self.db.refresh(ficha)
        return ficha

    def guardar_cambios(self, ficha: FichaMedica) -> FichaMedica:
        self.db.add(ficha)
        self.db.commit()
        self.db.refresh(ficha)
        return ficha


class UsuarioRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_correo(self, correo: str) -> Optional[Usuario]:
        return self.db.query(Usuario).filter(Usuario.correo == correo).first()

    def obtener_por_persona_id(self, persona_id: int) -> Optional[Usuario]:
        return self.db.query(Usuario).filter(Usuario.persona_id == persona_id).first()

    def contar_administradores_activos(self, excluir_usuario_id: Optional[int] = None) -> int:
        """Cuenta las cuentas ACTIVAS con rol ADMINISTRADOR, opcionalmente
        ignorando una de ellas.

        Solo cuentan las activas: una cuenta desactivada no puede iniciar
        sesión, así que no sirve para recuperar el sistema. `excluir_usuario_id`
        permite preguntar "¿queda algún otro administrador si toco a este?"
        antes de aplicar el cambio."""
        consulta = (
            self.db.query(Usuario)
            .join(Usuario.roles)
            .filter(Rol.tipo_rol == TipoRol.ADMINISTRADOR, Usuario.activo.is_(True))
        )
        if excluir_usuario_id is not None:
            consulta = consulta.filter(Usuario.id != excluir_usuario_id)
        return consulta.count()

    def crear(self, usuario: Usuario) -> Usuario:
        self.db.add(usuario)
        self.db.commit()
        self.db.refresh(usuario)
        return usuario
