from sqlalchemy.orm import Session

from app.dominio.modelos import Usuario
from app.dominio.enums import TipoRol
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio


class RolServicio:
    """
    Cierra un gap real: NO existía en ningún lado del backend un endpoint
    para asignar un `TipoRol` a un `Usuario`. `POST /auth/registro` crea
    las credenciales sin roles ("se asignan por separado", decía el
    comentario) pero ese "por separado" nunca se construyó -- sin esto,
    ningún usuario podía pasar un `GestorPermisos` jamás.

    Este servicio maneja ALUMNO / ENTRENADOR / ADMINISTRADOR /
    REPRESENTANTE. El rol REPRESENTANTE se asigna automáticamente al
    representante legal durante la autoinscripción (enrollment_servicio),
    no mediante este endpoint admin.
    """

    def __init__(self, db: Session):
        self.db = db
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        self.repo_rol = RolRepositorio(db)

    def _obtener_usuario_de_persona(self, persona_id: int) -> Usuario:
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")
        usuario = self.repo_usuario.obtener_por_persona_id(persona_id)
        if not usuario:
            raise OperacionInvalida(
                "Esta persona todavía no registró sus credenciales "
                "(POST /auth/registro); no se le puede asignar un rol hasta que lo haga"
            )
        return usuario

    def obtener_roles(self, persona_id: int) -> Usuario:
        """Lectura pura: no muta nada, solo expone el estado actual de
        roles/activo. Usado por `GET /personas/{id}/roles` para que el
        frontend pueda pre-cargar el estado real antes de mostrar
        toggles/checkboxes (evita que el modal de edición asuma "sin
        roles" / "activo" por defecto)."""
        return self._obtener_usuario_de_persona(persona_id)

    def asignar_rol(self, persona_id: int, tipo_rol: TipoRol) -> Usuario:
        usuario = self._obtener_usuario_de_persona(persona_id)
        if any(r.tipo_rol == tipo_rol for r in usuario.roles):
            raise OperacionInvalida(f"Esta persona ya tiene el rol {tipo_rol.value}")
        rol = self.repo_rol.obtener_o_crear(tipo_rol)
        usuario.roles.append(rol)
        self.db.commit()
        self.db.refresh(usuario)
        return usuario

    def quitar_rol(self, persona_id: int, tipo_rol: TipoRol) -> Usuario:
        usuario = self._obtener_usuario_de_persona(persona_id)
        rol = next((r for r in usuario.roles if r.tipo_rol == tipo_rol), None)
        if not rol:
            raise EntidadNoEncontrada(f"Esta persona no tiene el rol {tipo_rol.value}")
        usuario.roles.remove(rol)
        self.db.commit()
        self.db.refresh(usuario)
        return usuario

    def asignar_alumno_si_corresponde(self, persona_id: int) -> None:
        """
        Asignación perezosa (principio de diseño ya acordado: el rol ALUMNO
        se otorga al matricularse, no al crear la cuenta). Se llama desde
        MembresiaServicio.crear_membresia. Es un "mejor esfuerzo": si la
        persona todavía no tiene Usuario (no se ha auto-registrado), no hace
        nada -- no es un error, simplemente no hay nada que asignar todavía.
        """
        usuario = self.repo_usuario.obtener_por_persona_id(persona_id)
        if not usuario:
            return None
        if any(r.tipo_rol == TipoRol.ALUMNO for r in usuario.roles):
            return None
        rol_alumno = self.repo_rol.obtener_o_crear(TipoRol.ALUMNO)
        usuario.roles.append(rol_alumno)
        self.db.commit()

    # --- E01-RF013: activar/desactivar cuenta sin borrar datos -------------
    def cambiar_estado_cuenta(self, persona_id: int, activo: bool) -> Usuario:
        usuario = self._obtener_usuario_de_persona(persona_id)
        usuario.activo = activo
        self.db.commit()
        self.db.refresh(usuario)
        return usuario
