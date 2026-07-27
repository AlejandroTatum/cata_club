"""
Servicio de creación de cuentas por el Administrador.

Orquesta la creación de Persona + Usuario + Rol en un solo request
transaccional. Soporta cuatro tipos de cuenta:
  - JUGADOR: adulto que juega (rol ALUMNO)
  - REPRESENTANTE: adulto que representa a un menor (rol REPRESENTANTE + ALUMNO)
  - MENOR: dependiente de un representante existente (rol ALUMNO)
  - ENTRENADOR: adulto que dicta los entrenamientos (rol ENTRENADOR)

ENTRENADOR es el único tipo que NO recibe ALUMNO: entrena al club, no se
matricula en él. Antes de existir este tipo, dar de alta a un entrenador
exigía crear la cuenta como JUGADOR y después corregir los roles a mano
desde el panel de miembros.
"""
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, FichaMedica, Enfermedades
from app.dominio.enums import TipoRol
from app.dominio.excepciones import EntidadDuplicada, EntidadNoEncontrada, OperacionInvalida
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import (
    UsuarioRepositorio, FichaMedicaRepositorio,
)
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.presentacion.schemas.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import (
    _calcular_edad, EDAD_MINIMA_ALUMNO, EDAD_MAXIMA_ALUMNO, EDAD_MAYORIA_EDAD,
)


# Tipos de cuenta que exigen mayoría de edad, con su plural en español para
# el mensaje de error (`tipo_cuenta.lower() + "s"` producía "jugadors").
TIPOS_CUENTA_ADULTA = {
    "JUGADOR": "jugadores",
    "REPRESENTANTE": "representantes",
    "ENTRENADOR": "entrenadores",
}

# Roles otorgados por tipo de cuenta. ENTRENADOR no recibe ALUMNO: dicta los
# entrenamientos, no se matricula.
ROLES_POR_TIPO_CUENTA = {
    "JUGADOR": (TipoRol.ALUMNO,),
    "REPRESENTANTE": (TipoRol.REPRESENTANTE, TipoRol.ALUMNO),
    "MENOR": (TipoRol.ALUMNO,),
    "ENTRENADOR": (TipoRol.ENTRENADOR,),
}


class AdminCuentaServicio:
    """Crea cuentas completas (Persona + Usuario + Rol) desde el panel admin."""

    def __init__(self, db: Session):
        self.db = db
        self.repo_persona = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_ficha = FichaMedicaRepositorio(db)
        self.repo_rol = RolRepositorio(db)

    def crear_cuenta(self, datos: AdminCrearCuentaDTO) -> dict:
        """
        Flujo completo de creación de cuenta admin.
        Retorna: { access_token, refresh_token, token_type, persona_id }
        """
        # 1. Validar que la cédula no exista
        if self.repo_persona.obtener_por_cedula(datos.cedula):
            raise EntidadDuplicada(
                f"Ya existe una persona con la cédula {datos.cedula}"
            )

        # 2. Validar que el correo no exista
        if self.repo_usuario.obtener_por_correo(datos.correo):
            raise EntidadDuplicada("El correo ya está en uso por otra cuenta")

        # 3. Validar edad según tipo de cuenta
        edad = _calcular_edad(datos.fecha_nacimiento)

        if datos.tipo_cuenta in TIPOS_CUENTA_ADULTA:
            if edad < EDAD_MAYORIA_EDAD:
                raise OperacionInvalida(
                    f"Los {TIPOS_CUENTA_ADULTA[datos.tipo_cuenta]} deben ser "
                    f"mayores de edad ({EDAD_MAYORIA_EDAD} años o más); la "
                    f"edad calculada es {edad} años."
                )

        if datos.tipo_cuenta == "MENOR":
            if edad >= EDAD_MAYORIA_EDAD:
                raise OperacionInvalida(
                    f"La persona es mayor de edad ({edad} años). "
                    f"Use tipo_cuenta JUGADOR o REPRESENTANTE."
                )
            if edad < EDAD_MINIMA_ALUMNO:
                raise OperacionInvalida(
                    f"La edad del alumno debe estar entre {EDAD_MINIMA_ALUMNO} y "
                    f"{EDAD_MAXIMA_ALUMNO} años (calculado: {edad})."
                )
            if not datos.representante_id:
                raise OperacionInvalida(
                    "El menor requiere un representante legal (representante_id)."
                )

        # 4. Validar representante si aplica
        if datos.representante_id:
            representante = self.repo_persona.obtener_por_id(datos.representante_id)
            if not representante:
                raise EntidadNoEncontrada(
                    f"Representante con id {datos.representante_id} no encontrado"
                )
            edad_rep = _calcular_edad(representante.fecha_nacimiento)
            if edad_rep < EDAD_MAYORIA_EDAD:
                raise OperacionInvalida(
                    f"El representante legal debe ser mayor de edad "
                    f"({EDAD_MAYORIA_EDAD} años o más); el representante indicado "
                    f"tiene {edad_rep} años."
                )

        # 5. Crear Persona
        persona = Persona(
            nombres=datos.nombres,
            apellidos=datos.apellidos,
            cedula=datos.cedula,
            fecha_nacimiento=datos.fecha_nacimiento,
            telefono=datos.telefono,
            telefono_contacto=datos.telefono_contacto,
            representante_id=datos.representante_id,
            direccion_id=datos.direccion_id,
            institucion_id=datos.institucion_id,
        )
        self.repo_persona.crear(persona)

        # 6. Crear Usuario (credenciales)
        hash_pw = GestorAutenticacion.obtener_hash_contrasenia(datos.contrasenia)
        usuario = Usuario(
            correo=datos.correo,
            contrasenia=hash_pw,
            persona_id=persona.id,
        )
        self.repo_usuario.crear(usuario)

        # 7. Asignar roles según tipo de cuenta
        for tipo_rol in ROLES_POR_TIPO_CUENTA.get(datos.tipo_cuenta, ()):
            self._asignar_rol(usuario, tipo_rol)

        # 8. Crear Ficha Médica si se proporcionó
        if datos.ficha_medica:
            ficha = FichaMedica(
                tipo_sangre=datos.ficha_medica.tipo_sangre,
                persona_id=persona.id,
                alergias=datos.ficha_medica.alergias,
                contacto_emergencia=datos.ficha_medica.contacto_emergencia,
                telefono_emergencia=datos.ficha_medica.telefono_emergencia,
            )
            for nombre in datos.ficha_medica.enfermedades:
                ficha.enfermedades.append(Enfermedades(nombre_enfermedad=nombre))
            self.repo_ficha.crear(ficha)

        # 9. Emitir tokens JWT para auto-login
        return self._emitir_tokens(usuario)

    def _asignar_rol(self, usuario: Usuario, tipo_rol: TipoRol) -> None:
        """Asigna un rol al usuario si aún no lo tiene (idempotente)."""
        if any(r.tipo_rol == tipo_rol for r in usuario.roles):
            return
        rol = self.repo_rol.obtener_o_crear(tipo_rol)
        usuario.roles.append(rol)
        self.db.commit()

    def _emitir_tokens(self, usuario: Usuario) -> dict:
        """Emite el par access + refresh tokens para auto-login."""
        roles = [rol.tipo_rol.value for rol in usuario.roles]
        claims = {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": roles}
        access = GestorAutenticacion.crear_token_acceso(claims, version_sesion=usuario.version_sesion)
        refresh_claims = {"sub": usuario.correo, "persona_id": usuario.persona_id}
        refresh = GestorAutenticacion.crear_token_refresco(refresh_claims, version_sesion=usuario.version_sesion)
        return {
            "access_token": access,
            "refresh_token": refresh,
            "token_type": "bearer",
            "persona_id": usuario.persona_id,
        }
