from typing import Optional
from sqlalchemy.orm import Session

from app.dominio.enums import TipoRol
from app.dominio.modelos import FichaMedica, Rol, Usuario


class FichaMedicaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, ficha: FichaMedica, *, commit: bool = True) -> FichaMedica:
        """`commit=False`: ver `PersonaRepositorio.crear` (issue #338)."""
        self.db.add(ficha)
        if commit:
            self.db.commit()
            self.db.refresh(ficha)
        else:
            self.db.flush()
        return ficha

    def guardar_cambios(self, ficha: FichaMedica) -> FichaMedica:
        self.db.add(ficha)
        self.db.commit()
        self.db.refresh(ficha)
        return ficha

    def listar_persona_ids_con_ficha(self, persona_ids: list[int]) -> set[int]:
        """Issue #362: existencia en bloque, no el contenido de la ficha. El
        admin `/members` necesita saber CUÁLES de N personas tienen ficha
        médica para marcar el hueco "sin datos de emergencia" -- una fila de
        `SELECT persona_id ... WHERE persona_id IN (...)`, nunca N consultas
        (ver el docstring del router para el N+1 que esto evita)."""
        if not persona_ids:
            return set()
        filas = (
            self.db.query(FichaMedica.persona_id)
            .filter(FichaMedica.persona_id.in_(persona_ids))
            .all()
        )
        return {fila[0] for fila in filas}


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

    def crear(self, usuario: Usuario, *, commit: bool = True) -> Usuario:
        """`commit=False`: ver `PersonaRepositorio.crear` (issue #338)."""
        self.db.add(usuario)
        if commit:
            self.db.commit()
            self.db.refresh(usuario)
        else:
            self.db.flush()
        return usuario
