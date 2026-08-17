"""
Servicio de autoinscripción pública (Escenario 2, Opción B).

Orquesta la creación de Persona, Usuario, FichaMedica y AntecedentesClub
en un solo request transaccional. Endpoint público (sin auth), rate-limited.

  Flujo (issue #338 -- todo o nada, validado antes de escribir):
  1. Validar edad del alumno (5-74 años) y, si hay representante, su cédula,
     correo y edad; validar cédula del alumno, la regla de menores y el
     correo de cualquier cuenta propia (menor o adulto). Nada de esto
     escribe todavía.
  2. Dentro de una única transacción: crear Persona del representante (si
     aplica) + Usuario (credenciales) + roles REPRESENTANTE y ALUMNO; crear
     Persona del alumno (con representante_id si aplica); crear FichaMedica
     y AntecedentesClub si se proporcionaron; crear Usuario del alumno
     (menor con cuenta propia, o adulto autoinscrito) + rol ALUMNO.
  3. Un solo `commit()` al final del flujo feliz. Cualquier excepción hace
     `rollback()` de TODO lo escrito en el intento.
  4. Emitir tokens JWT para auto-login del representante (o del alumno adulto).
"""
import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, FichaMedica, Enfermedades, AntecedentesClub, Notificacion
from app.dominio.enums import TipoRol, TipoNotificacion
from app.soporte_transversal.tiempo import hoy_club
from app.dominio.excepciones import EntidadDuplicada, OperacionInvalida
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import (
    UsuarioRepositorio, FichaMedicaRepositorio,
)
from app.infraestructura.repositorios.antecedentes_club_repositorio import AntecedentesClubRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.infraestructura.repositorios.notificacion_repositorio import NotificacionRepositorio
from app.presentacion.schemas.enrollment_schemas import EnrollmentAlumnoDTO, EnrollmentCreateDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.notificacion_servicio import acortar_nombre_para_notificacion
from app.servicios_negocio.persona_servicio import (
    _calcular_edad, EDAD_MINIMA_ALUMNO, EDAD_MAXIMA_ALUMNO, EDAD_MAYORIA_EDAD,
)

logger = logging.getLogger("cataclub.servicios.enrollment")


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

        Todo o nada (issue #338): las DOS fases de abajo están separadas a
        propósito. La primera solo LEE y no puede dejar nada a medio
        escribir. La segunda es la única que escribe, dentro de una única
        transacción -- cualquier excepción (de negocio o `IntegrityError` por
        una condición de carrera) hace `rollback()` de TODO lo escrito en
        este intento antes de propagar. Antes, cada `Repositorio.crear`
        comiteaba por separado: una falla tardía (p. ej. el correo del menor,
        que solo se validaba en el último paso) dejaba al representante -- y
        a veces también al alumno -- persistidos con un 400 en la respuesta.
        """
        # === Fase 1: validar TODO antes de escribir una sola fila =========
        edad = _calcular_edad(datos.alumno.fecha_nacimiento)
        if edad < EDAD_MINIMA_ALUMNO or edad > EDAD_MAXIMA_ALUMNO:
            raise OperacionInvalida(
                f"La edad del alumno debe estar entre {EDAD_MINIMA_ALUMNO} "
                f"y {EDAD_MAXIMA_ALUMNO} años (calculado: {edad})."
            )

        hay_representante = datos.representante is not None
        if datos.representante:
            # Validar cédula única del representante
            if self.repo_persona.obtener_por_cedula(datos.representante.cedula):
                raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)
            # Validar correo único
            if self.repo_usuario.obtener_por_correo(datos.representante.correo):
                raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

            # Validar que el representante sea mayor de edad. El piso
            # (EDAD_MAYORIA_EDAD) ya se validaba; el techo no -- una fecha de
            # nacimiento implausible (patrón auditado: año 1800) pasaba en
            # silencio porque el cálculo de edad del lado del cliente
            # devolvía NaN fuera de un rango arbitrario y `NaN < 18` es
            # `false`. La edad del alumno, arriba, ya valida ambas cotas
            # (EDAD_MINIMA_ALUMNO/EDAD_MAXIMA_ALUMNO); esta usa el mismo
            # patrón, reusando EDAD_MAXIMA_ALUMNO como el único techo que
            # define el sistema.
            edad_rep = _calcular_edad(datos.representante.fecha_nacimiento)
            if edad_rep < EDAD_MAYORIA_EDAD:
                raise OperacionInvalida(
                    f"El representante legal debe ser mayor de edad "
                    f"({EDAD_MAYORIA_EDAD} años o más); la edad calculada "
                    f"es {edad_rep} años."
                )
            if edad_rep > EDAD_MAXIMA_ALUMNO:
                raise OperacionInvalida(
                    f"El representante legal debe tener como máximo "
                    f"{EDAD_MAXIMA_ALUMNO} años (calculado: {edad_rep})."
                )

        # Validar cédula única del alumno. Antes corría DESPUÉS de crear la
        # Persona del representante (issue #338): una cédula de alumno
        # duplicada dejaba al representante huérfano en la base.
        if self.repo_persona.obtener_por_cedula(datos.alumno.cedula):
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        # Validar regla de menores
        if EDAD_MINIMA_ALUMNO <= edad < EDAD_MAYORIA_EDAD and not hay_representante:
            raise OperacionInvalida(
                "El alumno es menor de edad y requiere un representante legal."
            )

        # Validar correo único del menor con cuenta propia. Antes corría
        # dentro de `_crear_usuario_alumno`, el ÚLTIMO paso del flujo (issue
        # #338, el caso reportado): para entonces representante y alumno ya
        # estaban commiteados.
        if hay_representante and datos.alumno.correo and datos.alumno.contrasenia:
            if self.repo_usuario.obtener_por_correo(datos.alumno.correo):
                raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        # Validar correo único de la autoinscripción sin representante
        # (adulto). Antes corría DESPUÉS de crear la Persona del alumno
        # (issue #338): dejaba al alumno huérfano en la base.
        if not hay_representante and datos.credenciales_alumno:
            if self.repo_usuario.obtener_por_correo(datos.credenciales_alumno.correo):
                raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        # === Fase 2: escritura atómica -- todo o nada =======================
        try:
            representante_id = None
            correo_login_rep = None
            if datos.representante:
                rep = Persona(
                    nombres=datos.representante.nombres,
                    apellidos=datos.representante.apellidos,
                    cedula=datos.representante.cedula,
                    fecha_nacimiento=datos.representante.fecha_nacimiento,
                    telefono=datos.representante.telefono,
                )
                self.repo_persona.crear(rep, commit=False)
                representante_id = rep.id
                correo_login_rep = datos.representante.correo

            alumno = Persona(
                nombres=datos.alumno.nombres,
                apellidos=datos.alumno.apellidos,
                cedula=datos.alumno.cedula,
                fecha_nacimiento=datos.alumno.fecha_nacimiento,
                telefono=datos.alumno.telefono,
                representante_id=representante_id,
                institucion_id=datos.alumno.institucion_id,
            )
            self.repo_persona.crear(alumno, commit=False)

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
                self.repo_ficha.crear(ficha, commit=False)

            if datos.antecedentes and datos.antecedentes.nivel_tecnico_alumno:
                ant = AntecedentesClub(
                    persona_id=alumno.id,
                    # Día del CLUB: "el día que este alumno empezó en el club" es
                    # una fecha de calendario local. Quien se inscribe a las 20:00
                    # hora del club debe quedar registrado ESE día, no el siguiente.
                    fecha_inicio_club=datos.antecedentes.fecha_inicio_club or hoy_club(),
                    nivel_tecnico_alumno=datos.antecedentes.nivel_tecnico_alumno,
                    mano_dominante=datos.antecedentes.mano_dominante,
                )
                self.repo_antecedentes.crear(ant, commit=False)

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
                self.repo_usuario.crear(usuario, commit=False)
                self._asignar_rol(usuario, TipoRol.REPRESENTANTE)
                self._asignar_rol(usuario, TipoRol.ALUMNO)

                # Si el menor tiene credenciales propias, crear cuenta también
                if datos.alumno.correo and datos.alumno.contrasenia:
                    self._crear_usuario_alumno(datos.alumno, alumno.id)
            elif datos.credenciales_alumno:
                # Autoinscripción sin representante (adulto)
                hash_pw = GestorAutenticacion.obtener_hash_contrasenia(
                    datos.credenciales_alumno.contrasenia
                )
                usuario = Usuario(
                    correo=datos.credenciales_alumno.correo,
                    contrasenia=hash_pw,
                    persona_id=alumno.id,
                )
                self.repo_usuario.crear(usuario, commit=False)
                # Autoinscripción de un adulto jugador: solo ALUMNO (sin
                # representante involucrado, no hereda el rol REPRESENTANTE
                # del flujo de menor).
                self._asignar_rol(usuario, TipoRol.ALUMNO)
            else:
                # Inalcanzable en la práctica: `EnrollmentCreateDTO` exige
                # `representante` o `credenciales_alumno` (issue #275). Se
                # conserva el `rollback()` explícito como red de seguridad.
                self.db.rollback()
                return None

            self.db.commit()
        except IntegrityError as error:
            # Condición de carrera: dos requests concurrentes pasaron la
            # validación de la Fase 1 para la misma cédula/correo y
            # solo uno gana la restricción UNIQUE de la base. Mismo patrón
            # que `MembresiaPagoServicio.registrar_pago`.
            self.db.rollback()
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA) from error
        except Exception:
            self.db.rollback()
            raise

        self._notificar_nueva_inscripcion(alumno)
        return self._emitir_tokens(usuario)

    def _asignar_rol(self, usuario: Usuario, tipo_rol: TipoRol) -> None:
        """Asigna un rol al usuario si aún no lo tiene (idempotente).

        Solo `flush()`: forma parte de la transacción atómica de `enroll`
        (issue #338), que hace el único `commit()` al final del flujo feliz.
        """
        if any(r.tipo_rol == tipo_rol for r in usuario.roles):
            return
        rol = self.repo_rol.obtener_o_crear(tipo_rol)
        usuario.roles.append(rol)
        self.db.flush()

    def _crear_usuario_alumno(self, alumno_data: EnrollmentAlumnoDTO, persona_id: int) -> Usuario:
        """Crea Usuario + ALUMNO para un menor con credenciales propias.

        La unicidad del correo ya se validó en la Fase 1 de `enroll`; este
        `commit=False` es lo que la hace parte de la misma transacción
        atómica en vez de comitear por separado."""
        hash_pw = GestorAutenticacion.obtener_hash_contrasenia(alumno_data.contrasenia)
        usuario = Usuario(
            correo=alumno_data.correo,
            contrasenia=hash_pw,
            persona_id=persona_id,
        )
        self.repo_usuario.crear(usuario, commit=False)
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
        """Notifica a todos los administradores sobre una nueva inscripción.

        La inscripción en sí YA está commiteada cuando esto corre (es el
        último paso de los dos call sites que lo invocan), así que un
        fallo al avisar a UN administrador se loguea y no interrumpe el
        aviso a los demás ni tira la respuesta del endpoint público de
        autoinscripción."""
        repo_notif = NotificacionRepositorio(self.db)
        rol_admin = self.repo_rol.obtener_por_tipo(TipoRol.ADMINISTRADOR)
        if not rol_admin:
            return
        admins = [u.persona for u in rol_admin.usuarios if u.persona]
        nombre_alumno = acortar_nombre_para_notificacion(f"{alumno.nombres} {alumno.apellidos}")
        for admin in admins:
            try:
                notif = Notificacion(
                    tipo=TipoNotificacion.NUEVA_INSCRIPCION,
                    mensaje=f"Nuevo alumno inscrito: {nombre_alumno} (cédula: {alumno.cedula}).",
                    persona_id=admin.id,
                    entidad_relacionada_id=alumno.id,
                )
                repo_notif.crear(notif)
            except Exception:
                self.db.rollback()
                logger.exception(
                    "No se pudo avisar al administrador persona_id=%s de la nueva "
                    "inscripción de persona_id=%s. La inscripción YA está commiteada.",
                    admin.id, alumno.id,
                )
