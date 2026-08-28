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
import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, FichaMedica, Enfermedades, AntecedentesClub
from app.servicios_negocio.consentimiento_legal_servicio import (
    ConsentimientoLegalServicio, DOCUMENTOS_LEGALES, VERSION_LEGAL_VIGENTE,
    TEXTOS_LEGALES_VIGENTES,
)
from app.dominio.enums import TipoRol
from app.soporte_transversal.tiempo import hoy_club
from app.dominio.excepciones import EntidadDuplicada, ErrorDominio, OperacionInvalida
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import (
    UsuarioRepositorio, FichaMedicaRepositorio,
)
from app.infraestructura.repositorios.antecedentes_club_repositorio import AntecedentesClubRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.infraestructura.repositorios.enrollment_notificacion_outbox_repositorio import EnrollmentNotificacionOutboxRepositorio
from app.infraestructura.repositorios.inscripcion_idempotencia_repositorio import (
    ESTADO_PENDIENTE,
    InscripcionIdempotenciaRepositorio,
)
from app.presentacion.schemas.enrollment_schemas import EnrollmentAlumnoDTO, EnrollmentCreateDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.notificacion_servicio import acortar_nombre_para_notificacion
from app.servicios_negocio.persona_servicio import (
    _calcular_edad, EDAD_MINIMA_ALUMNO, EDAD_MAXIMA_ALUMNO, EDAD_MAYORIA_EDAD,
)


# --- Idempotencia de la autoinscripción (enrollment-idempotency) -------------
# `ConflictoIdempotencia` vive acá (no en `excepciones.py`) porque es un error
# de ESTE flujo: el router de autoinscripción lo traduce a HTTP 409 / 425 +
# `Retry-After` (ver `enrollment_router.py`).
MENSAJE_IDEMPOTENCIA_EN_VUELO = (
    "La inscripción ya está en proceso. Espere unos segundos e intente nuevamente."
)
MENSAJE_IDEMPOTENCIA_REUTILIZADA = (
    "Esta solicitud de inscripción ya fue utilizada. Reinicie la inscripción "
    "e intente nuevamente."
)
# Ventana que el cliente debe esperar antes de reintentar un intento en vuelo
# (PENDIENTE). Segundos, HTTP `Retry-After`.
REINTENTO_SEGUNDOS_EN_VUELO = 2


class ConflictoIdempotencia(ErrorDominio):
    """La clave de idempotencia está en vuelo (PENDIENTE) o ya fue consumida por
    otro payload. `retry_after` no es None solo para el caso en vuelo: ahí el
    reintento es legítimo y el router debe mandar `Retry-After`."""

    def __init__(self, mensaje, *, retry_after=None, detalle_tecnico=None):
        super().__init__(mensaje, detalle_tecnico)
        self.retry_after = retry_after


def _huella_de_cedula(cedula: str) -> str:
    """Hash estable (sha256) de la cédula del alumno: identifica el intento sin
    guardar el número — misma disciplina de no-oráculo que
    `dominio/mensajes.py` (las respuestas públicas nunca confirman identidades)."""
    return hashlib.sha256(cedula.encode("utf-8")).hexdigest()


def _ahora_utc() -> datetime:
    """Instante actual aware en UTC, mismo reloj que el default del modelo."""
    return datetime.now(timezone.utc)


class EnrollmentServicio:
    """Endpoint público de autoinscripción. No requiere autenticación."""

    def __init__(self, db: Session):
        self.db = db
        self.repo_persona = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_ficha = FichaMedicaRepositorio(db)
        self.repo_antecedentes = AntecedentesClubRepositorio(db)
        self.repo_rol = RolRepositorio(db)
        self.repo_idempotencia = InscripcionIdempotenciaRepositorio(db)

    def enroll(self, datos: EnrollmentCreateDTO, idempotency_key: str | None = None) -> dict:
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
        # === Idempotencia: clave del intento y su historia ====================
        # La clave la acuña el cliente (header `Idempotency-Key`); si no llega,
        # el backend acuña una propia para que el endpoint público siga siendo
        # robusto. La huella es un hash de la cédula del alumno (identidad
        # estable del intento sin guardar el número).
        clave = idempotency_key or uuid.uuid4().hex
        huella = _huella_de_cedula(datos.alumno.cedula)
        registro_previo = self.repo_idempotencia.obtener_por_clave(clave)
        if registro_previo is not None:
            # REPLAY / conflicto / expirada: solo devuelve algo cuando el intento
            # YA está resuelto (o hay que responder un conflicto).
            resultado = self._gestionar_intento_existente(registro_previo, huella, clave)
            if resultado is not None:
                return resultado

        # === Fase 1: validar TODO antes de escribir una sola fila =========
        if datos.acepta_consentimientos is not True:
            raise OperacionInvalida("Debe aceptar los consentimientos legales para continuar.")

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
            # El intento entra PENDIENTE en LA MISMA transacción que los
            # creates (issue #338): si algo falla, el rollback lo borra y la
            # clave queda libre; si dos requests concurrentes usan la misma
            # clave, solo uno gana la PK y el otro recibe 425 + Retry-After.
            registro = self.repo_idempotencia.crear_pendiente(clave, huella)
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

            ConsentimientoLegalServicio(self.db).registrar_aceptacion_grupal(
                cuenta_id=usuario.id,
                documentos=DOCUMENTOS_LEGALES,
                version=VERSION_LEGAL_VIGENTE,
                texto_por_documento=TEXTOS_LEGALES_VIGENTES,
                representado_persona_id=alumno.id if datos.representante else None,
                commit=False,
            )
            self._notificar_nueva_inscripcion(alumno)
            self.db.commit()
        except IntegrityError as error:
            # Condición de carrera: dos requests concurrentes pasaron la
            # validación de la Fase 1 para la misma cédula/correo y solo uno
            # gana la restricción UNIQUE de la base. Mismo patrón que
            # `MembresiaPagoServicio.registrar_pago`.
            self.db.rollback()
            if self._es_conflicto_de_clave_idempotencia(error):
                # La carrera fue por la PK de inscripcion_idempotencia: el
                # otro request ganó la clave y probablemente sigue en vuelo.
                # Reintentar sin cambiar nada suele alcanzar.
                raise ConflictoIdempotencia(
                    MENSAJE_IDEMPOTENCIA_EN_VUELO,
                    retry_after=REINTENTO_SEGUNDOS_EN_VUELO,
                    detalle_tecnico=(
                        f"Clave de idempotencia {clave} ganada por otro request "
                        "concurrente (PK inscripcion_idempotencia)."
                    ),
                ) from error
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA) from error
        except Exception:
            self.db.rollback()
            raise

        # La entrega NO ocurre acá: las filas del outbox ya quedaron
        # commiteadas arriba y el beat `despachar-inscripcion-notificaciones`
        # (cada minuto) las reclama y entrega. Mismo trato que
        # `AuthServicio.solicitar_recuperacion`, que también registra el evento
        # y devuelve sin despachar nada. Ver issue #703: este endpoint es
        # PÚBLICO y sin auth, y drenar el outbox acá le hacía pagar a un
        # visitante la entrega de TODAS las notificaciones pendientes del club.
        respuesta = self._emitir_tokens(usuario)
        # El intento queda COMPLETADA con la persona de la cuenta que recibió
        # los tokens (la misma que devuelve la respuesta): un replay con la
        # misma clave repone tokens SIN escribir nada nuevo.
        self.repo_idempotencia.marcar_completada(registro, respuesta["persona_id"])
        return respuesta

    def _gestionar_intento_existente(
        self, registro, huella: str, clave: str
    ) -> dict | None:
        """Resuelve qué hacer cuando la clave de idempotencia ya existe.

        Retorna el dict de tokens SOLO en el REPLAY (misma clave, misma huella,
        intento COMPLETADA y sin vencer): se reemiten tokens para la misma
        cuenta sin escribir ninguna fila nueva. En cualquier otro caso lanza
        `ConflictoIdempotencia` (clave en vuelo -> 425 + Retry-After; clave
        reciclada hacia otro alumno -> 409) o devuelve None (clave vencida:
        la fila se elimina y el intento se trata como fresco)."""
        if registro.vence_en <= _ahora_utc():
            # TTL de 24h vencido: la clave se reutiliza como intento fresco.
            # La fila se borra dentro de la transacción del intento que la
            # reemplaza (misma clave, así no puede chocar con su propia PK).
            self.repo_idempotencia.eliminar(registro)
            return None

        if registro.estado == ESTADO_PENDIENTE:
            raise ConflictoIdempotencia(
                MENSAJE_IDEMPOTENCIA_EN_VUELO,
                retry_after=REINTENTO_SEGUNDOS_EN_VUELO,
                detalle_tecnico=(
                    f"Clave de idempotencia {clave} aún en vuelo (PENDIENTE)."
                ),
            )

        if registro.request_fingerprint != huella:
            raise ConflictoIdempotencia(
                MENSAJE_IDEMPOTENCIA_REUTILIZADA,
                detalle_tecnico=(
                    f"Clave de idempotencia {clave} reutilizada con la cédula de "
                    "otro alumno (la huella no coincide)."
                ),
            )

        # COMPLETADA, sin vencer, misma huella: REPLAY del intento original.
        usuario = self.repo_usuario.obtener_por_persona_id(registro.persona_id)
        if usuario is None:
            # Caso límite: la cuenta original desapareció (borrado directo en
            # base). La clave no se puede reponer ni reutilizar; se trata como
            # reciclada para que el visitante reinicie la inscripción.
            raise ConflictoIdempotencia(
                MENSAJE_IDEMPOTENCIA_REUTILIZADA,
                detalle_tecnico=(
                    f"Clave {clave} COMPLETADA sin usuario para persona_id="
                    f"{registro.persona_id}; no se pueden reponer los tokens."
                ),
            )
        return self._emitir_tokens(usuario)

    @staticmethod
    def _es_conflicto_de_clave_idempotencia(error: IntegrityError) -> bool:
        """True si el `IntegrityError` viene de la PK de inscripcion_idempotencia
        (la clave la ganó otro request concurrente) y no del UNIQUE de
        cédula/correo. El nombre exacto lo pone Postgres en `error.orig.diag`;
        el chequeo textual es solo el último recurso (otros drivers)."""
        origen = getattr(error, "orig", None)
        diag = getattr(origen, "diag", None)
        if diag is not None and diag.constraint_name:
            return diag.constraint_name == "inscripcion_idempotencia_pkey"
        return "inscripcion_idempotencia" in str(error)

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
        """Encola en el outbox un aviso por cada administrador.

        Solo ESCRIBE las filas: se commitean junto con la inscripción (misma
        transacción), y de ahí en adelante son del worker. Esa durabilidad es
        la garantía del PR #633 -- si el worker está caído en el momento de la
        inscripción, la fila sigue PENDIENTE y el beat la entrega cuando
        vuelva."""
        repo_outbox = EnrollmentNotificacionOutboxRepositorio(self.db)
        rol_admin = self.repo_rol.obtener_por_tipo(TipoRol.ADMINISTRADOR)
        if not rol_admin:
            return
        admins = [u.persona for u in rol_admin.usuarios if u.persona]
        nombre_alumno = acortar_nombre_para_notificacion(f"{alumno.nombres} {alumno.apellidos}")
        for admin in admins:
            repo_outbox.crear(
                admin.id,
                alumno.id,
                f"Nuevo alumno inscrito: {nombre_alumno} (cédula: {alumno.cedula}).",
            )
