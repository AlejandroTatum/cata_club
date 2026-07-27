from typing import Optional, List
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, Rol, usuario_rol
from app.dominio.enums import TipoRol
from app.infraestructura.repositorios.eliminacion_segura import eliminar_o_error_de_dominio


class PersonaRepositorio:
    """Encapsula todo el acceso a datos de Persona. Es la ÚNICA clase
    del proyecto que debe importar Session y ejecutar db.query/add/commit
    para esta entidad."""

    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, persona_id: int) -> Optional[Persona]:
        return self.db.get(Persona, persona_id)

    def obtener_por_cedula(self, cedula: str) -> Optional[Persona]:
        return self.db.query(Persona).filter(Persona.cedula == cedula).first()

    def listar(self, skip: int = 0, limit: int = 50) -> List[Persona]:
        return self.db.query(Persona).offset(skip).limit(limit).all()

    def contar(self) -> int:
        return self.db.query(Persona).count()

    def listar_por_rol(self, tipo_rol: TipoRol) -> List[Persona]:
        """Personas con un Usuario que tenga el `tipo_rol` dado (ej. listar
        entrenadores para un selector). Mismo criterio de "rol asignado" que
        `AsistenciaServicio._validar_entrenador` usa para validar."""
        return (
            self.db.query(Persona)
            .join(Usuario, Usuario.persona_id == Persona.id)
            .join(Usuario.roles)
            .filter(Rol.tipo_rol == tipo_rol)
            .all()
        )

    def crear(self, persona: Persona) -> Persona:
        self.db.add(persona)
        self.db.commit()
        self.db.refresh(persona)
        return persona

    def actualizar(self, persona: Persona, cambios: dict) -> Persona:
        for campo, valor in cambios.items():
            setattr(persona, campo, valor)
        self.db.commit()
        self.db.refresh(persona)
        return persona

    def eliminar(self, persona: Persona) -> None:
        eliminar_o_error_de_dominio(
            self.db, persona,
            "No se puede eliminar a esta persona porque tiene registros "
            "asociados (asistencias, pagos, membresías, ficha médica u "
            "horarios a cargo). Elimina o reasigna esos registros primero.",
        )

    # --- Reportes (E04-RF014) --------------------------------------------------
    def listar_nuevas_por_periodo(self, fecha_inicio, fecha_fin) -> List[Persona]:
        """E04-RF014: alumnos nuevos registrados en un rango de fechas."""
        return (
            self.db.query(Persona)
            .filter(Persona.fecha_registro >= fecha_inicio, Persona.fecha_registro <= fecha_fin)
            .order_by(Persona.fecha_registro.asc())
            .all()
        )

    def buscar_por_nombre(
        self, q: str, rol: Optional[str] = None, skip: int = 0, limit: int = 20
    ) -> List[Persona]:
        """Búsqueda de personas por nombre/apellido con filtro opcional por rol."""
        stmt = select(Persona)
        if rol:
            stmt = (
                stmt.join(Usuario, Usuario.persona_id == Persona.id)
                .join(usuario_rol, usuario_rol.c.usuario_id == Usuario.id)
                .join(Rol, Rol.id == usuario_rol.c.rol_id)
                .where(Rol.tipo_rol == rol)
            )
        filtro = f"%{q}%"
        stmt = stmt.where(
            (Persona.nombres.ilike(filtro)) | (Persona.apellidos.ilike(filtro))
        )
        return list(self.db.execute(stmt).scalars().all())
