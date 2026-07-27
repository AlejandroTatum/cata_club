"""
Servicio de autoinscripción pública (Escenario 2, Opción B).

Orquesta la creación de Persona, Usuario, FichaMedica y AntecedentesClub
en un solo request transaccional. Endpoint público (sin auth), rate-limited.

  Flujo:
  1. Validar edad del alumno (5-74 años).
  2. Si hay representante: crear Persona del representante + Usuario (credenciales)
     + asignar roles REPRESENTANTE y ALUMNO al representante.
  3. Crear Persona del alumno (con representante_id si aplica).
  4. Crear FichaMedica (si se proporcionó).
  5. Crear AntecedentesClub (si se proporcionó y tiene nivel_tecnico_alumno).
  6. Emitir tokens JWT para auto-login del representante (o del alumno adulto).
"""
from datetime import date
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, FichaMedica, Enfermedades, AntecedentesClub, Notificacion
from app.dominio.enums import TipoRol, TipoNotificacion
from app.dominio.excepciones import EntidadDuplicada, OperacionInvalida
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import (
    UsuarioRepositorio, FichaMedicaRepositorio,
)
from app.infraestructura.repositorios.antecedentes_club_repositorio import AntecedentesClubRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.infraestructura.repositorios.ranking_repositorio import NotificacionRepositorio
from app.presentacion.schemas.enrollment_schemas import EnrollmentAlumnoDTO, EnrollmentCreateDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import (
    _calcular_edad, EDAD_MINIMA_ALUMNO, EDAD_MAXIMA_ALUMNO, EDAD_MAYORIA_EDAD,
)


class EnrollmentServicio:
    """Endpoint público de autoinscripción. No requiere autenticación."""

    def __init__(self, db: Session):
        self.db = db
        self.repo_persona = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_ficha = FichaMedicaRepositorio(db)
        self.repo_antecedentes = AntecedentesClubRepositorio(db)
        self.repo_rol = RolRepositorio(db)

    def enroll(self, datos: EnrollmentCreateDTO) -> dict:
        """
        Flujo completo de autoinscripción.
        Retorna: { access_token, refresh_token, token_type, persona_id }
        """
        # 1. Validar edad del alumno
        edad = _calcular_edad(datos.alumno.fecha_nacimiento)
        if edad < EDAD_MINIMA_ALUMNO or edad > EDAD_MAXIMA_ALUMNO:
            raise OperacionInvalida(
                f"La edad del alumno debe estar entre {EDAD_MINIMA_ALUMNO} "
                f"y {EDAD_MAXIMA_ALUMNO} años (calculado: {edad})."
            )

        # 2. Crear representante (si aplica — inscripción de hijo)
        representante_id = None
        correo_login_rep = None
        if datos.representante:
            # Validar cédula única del representante
            if self.repo_persona.obtener_por_cedula(datos.representante.cedula):
                raise EntidadDuplicada(
                    f"Ya existe una persona con la cédula {datos.representante.cedula}"
                )
            # Validar correo único
            if self.repo_usuario.obtener_por_correo(datos.representante.correo):
                raise EntidadDuplicada("El correo del representante ya está en uso")

            # Validar que el representante sea mayor de edad
            edad_rep = _calcular_edad(datos.representante.fecha_nacimiento)
            if edad_rep < EDAD_MAYORIA_EDAD:
                raise OperacionInvalida(
                    f"El representante legal debe ser mayor de edad "
                    f"({EDAD_MAYORIA_EDAD} años o más); la edad calculada "
                    f"es {edad_rep} años."
                )

            # Crear Persona del representante
            rep = Persona(
                nombres=datos.representante.nombres,
                apellidos=datos.representante.apellidos,
                cedula=datos.representante.cedula,
                fecha_nacimiento=datos.representante.fecha_nacimiento,
                telefono=datos.representante.telefono,
            )
            self.repo_persona.crear(rep)
            representante_id = rep.id
            correo_login_rep = datos.representante.correo

        # 3. Validar cédula única del alumno
        if self.repo_persona.obtener_por_cedula(datos.alumno.cedula):
            raise EntidadDuplicada(
                f"Ya existe una persona con la cédula {datos.alumno.cedula}"
            )

        # 4. Validar regla de menores
        if EDAD_MINIMA_ALUMNO <= edad < EDAD_MAYORIA_EDAD and not representante_id:
            raise OperacionInvalida(
                "El alumno es menor de edad y requiere un representante legal."
            )

        # 5. Crear Persona del alumno
        alumno = Persona(
            nombres=datos.alumno.nombres,
            apellidos=datos.alumno.apellidos,
            cedula=datos.alumno.cedula,
            fecha_nacimiento=datos.alumno.fecha_nacimiento,
            telefono=datos.alumno.telefono,
            representante_id=representante_id,
            institucion_id=datos.alumno.institucion_id,
        )
        self.repo_persona.crear(alumno)

        # 6. Crear Ficha Médica (si se proporcionó)
        if datos.ficha_medica:
            ficha = FichaMedica(
                tipo_sangre=datos.ficha_medica.tipo_sangre,
                persona_id=alumno.id,
                alergias=datos.ficha_medica.alergias,
                contacto_emergencia=datos.ficha_medica.contacto_emergencia,
                telefono_emergencia=datos.ficha_medica.telefono_emergencia,
            )
            for nombre in datos.ficha_medica.enfermedades:
                ficha.enfermedades.append(Enfermedades(nombre_enfermedad=nombre))
            self.repo_ficha.crear(ficha)

        # 7. Crear Antecedentes del Club (si se proporcionó con nivel)
        if datos.antecedentes and datos.antecedentes.nivel_tecnico_alumno:
            ant = AntecedentesClub(
                persona_id=alumno.id,
                fecha_inicio_club=datos.antecedentes.fecha_inicio_club or date.today(),
                nivel_tecnico_alumno=datos.antecedentes.nivel_tecnico_alumno,
                mano_dominante=datos.antecedentes.mano_dominante,
            )
            self.repo_antecedentes.crear(ant)

        # 8. Crear Usuario (credenciales) y emitir tokens

        # 8a. Representante se registra con sus credenciales
        if correo_login_rep:
            # Representante se registra con sus credenciales
            hash_pw = GestorAutenticacion.obtener_hash_contrasenia(
                datos.representante.contrasenia
            )
            usuario = Usuario(
                correo=correo_login_rep,
                contrasenia=hash_pw,
                persona_id=representante_id,
            )
            self.repo_usuario.crear(usuario)
            self._asignar_rol(usuario, TipoRol.REPRESENTANTE)
            self._asignar_rol(usuario, TipoRol.ALUMNO)

            # Si el menor tiene credenciales propias, crear cuenta también
            if datos.alumno.correo and datos.alumno.contrasenia:
                self._crear_usuario_alumno(datos.alumno, alumno.id)

            self._notificar_nueva_inscripcion(alumno)
            return self._emitir_tokens(usuario)

        if datos.credenciales_alumno:
            # Autoinscripción sin representante (adulto)
            if self.repo_usuario.obtener_por_correo(datos.credenciales_alumno.correo):
                raise EntidadDuplicada("El correo ya está en uso")
            hash_pw = GestorAutenticacion.obtener_hash_contrasenia(
                datos.credenciales_alumno.contrasenia
            )
            usuario = Usuario(
                correo=datos.credenciales_alumno.correo,
                contrasenia=hash_pw,
                persona_id=alumno.id,
            )
            self.repo_usuario.crear(usuario)
            # Autoinscripción de un adulto jugador: solo ALUMNO (sin representante
            # involucrado, no hereda el rol REPRESENTANTE del flujo de menor).
            self._asignar_rol(usuario, TipoRol.ALUMNO)
            self._notificar_nueva_inscripcion(alumno)
            return self._emitir_tokens(usuario)

        # Sin credenciales (caso admin que registra sin auto-login)
        self._notificar_nueva_inscripcion(alumno)
        return {
            "persona_id": alumno.id,
            "mensaje": "Alumno registrado exitosamente. Las credenciales de acceso se crearán posteriormente.",
        }

    def _asignar_rol(self, usuario: Usuario, tipo_rol: TipoRol) -> None:
        """Asigna un rol al usuario si aún no lo tiene (idempotente)."""
        if any(r.tipo_rol == tipo_rol for r in usuario.roles):
            return
        rol = self.repo_rol.obtener_o_crear(tipo_rol)
        usuario.roles.append(rol)
        self.db.commit()

    def _crear_usuario_alumno(self, alumno_data: EnrollmentAlumnoDTO, persona_id: int) -> Usuario:
        """Crea Usuario + ALUMNO para un menor con credenciales propias."""
        if self.repo_usuario.obtener_por_correo(alumno_data.correo):
            raise EntidadDuplicada("El correo del alumno ya está en uso")
        hash_pw = GestorAutenticacion.obtener_hash_contrasenia(alumno_data.contrasenia)
        usuario = Usuario(
            correo=alumno_data.correo,
            contrasenia=hash_pw,
            persona_id=persona_id,
        )
        self.repo_usuario.crear(usuario)
        self._asignar_rol(usuario, TipoRol.ALUMNO)
        return usuario

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

    def _notificar_nueva_inscripcion(self, alumno: Persona) -> None:
        """Notifica a todos los administradores sobre una nueva inscripción."""
        repo_notif = NotificacionRepositorio(self.db)
        rol_admin = self.repo_rol.obtener_por_tipo(TipoRol.ADMINISTRADOR)
        if not rol_admin:
            return
        admins = [u.persona for u in rol_admin.usuarios if u.persona]
        nombre_alumno = f"{alumno.nombres} {alumno.apellidos}"
        for admin in admins:
            notif = Notificacion(
                tipo=TipoNotificacion.NUEVA_INSCRIPCION,
                mensaje=f"Nuevo alumno inscrito: {nombre_alumno} (cédula: {alumno.cedula}).",
                persona_id=admin.id,
                entidad_relacionada_id=alumno.id,
            )
            repo_notif.crear(notif)
