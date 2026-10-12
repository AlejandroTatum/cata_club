import hashlib
import logging
import math
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

import jwt
from sqlalchemy import case, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.invitacion_co_representante import PROPOSITO_INVITACION_CO_REPRESENTANTE
from app.dominio.invitacion_entrenador import (
    PROPOSITO_INVITACION_ENTRENADOR, invitacion_pendiente,
)
from app.infraestructura.repositorios.co_representante_repositorio import CoRepresentanteRepositorio
from app.dominio.modelos import (
    Persona, RecuperacionOutbox, Sesion, Usuario, VerificacionCorreoOutbox,
)
from app.dominio.excepciones import (
    ContraseniaIncorrecta, CredencialesInvalidas, EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida,
    PermisosInsuficientes, ServicioNoDisponible,
)
from app.dominio.mensajes import (
    MENSAJE_IDENTIDAD_DUPLICADA, MENSAJE_REPRESENTADO_SIN_CREDENCIALES_PROPIAS,
    MENSAJE_VERIFICACION_ENVIADA,
)
from app.infraestructura import actividad, redis_intentos_login
from app.infraestructura.metricas import contar_login
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.tareas.outbox_despacho import encolar_despacho_tras_commit
from app.infraestructura.repositorios.restricciones_identidad import identidad_en_conflicto
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.servicios_negocio.dtos.auth_schemas import RegistroUsuarioDTO, ActualizarPerfilPropioDTO
from app.seguridad import reautenticacion
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.consentimiento_legal_servicio import (
    ConsentimientoLegalServicio, TEXTOS_LEGALES_VIGENTES, VERSION_LEGAL_VIGENTE,
)
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.dispositivo import describir_dispositivo
from app.soporte_transversal.firma_archivos import es_firma_valida

_log = logging.getLogger(__name__)

# --- TRA-4 (issue #111): freno progresivo de login por cuenta --------------
# Contador de intentos fallidos CONSECUTIVOS por correo (normalizado, ver
# `login`). Vive en Redis (`infraestructura/redis_intentos_login`, #1653 S6):
# un hash por cuenta con TTL, compartido entre workers y réplicas y que
# sobrevive a un reinicio. Antes era un dict por proceso, y con varios
# workers (PERF-12) cada uno llevaba su propia cuenta y su propio
# enfriamiento. Esa política de almacenamiento (qué se guarda, cómo expira,
# qué pasa si Redis no responde) está documentada en el módulo de Redis;
# acá queda la POLÍTICA de negocio:
#
# Issue #733 (DoS sin autenticar): la clave es el input CRUDO del atacante,
# y un correo nunca visto solo se borra con un login exitoso en esa clave
# exacta, que nunca pasa para un string al azar. Dos mitades: `auth_router`
# acota el largo del username en la capa de FORM (422 antes de convertirse
# en clave), y el almacén acota lo demás con un TTL en CADA escritura (más
# la clave hasheada, de largo fijo). El TTL es DESLIZANTE -- se renueva en
# cada fallo -- así que una cuenta bajo ataque activo nunca se resetea
# (incluso escalado al techo de 8 s entre intentos hay mucho menos de 15 min
# de silencio), y solo se pierde el conteo de una clave que quedó IDLE 15
# minutos: basura de un atacante que dejó de insistir o un usuario real que
# tipeó mal y recién vuelve; en ambos casos perderlo es deseable.
_TTL_INTENTOS_LOGIN_SEGUNDOS = 15 * 60
_UMBRAL_RETRASO_INTENTOS = 3
# QA4 REG-02: el techo era 60 s, pero la interfaz corta a los 10 s y culpaba a
# la conexión. 8 s deja margen bajo ese corte. Acota SOLO el sleep: el
# contador sigue creciendo y se resetea igual, y cada intento sigue pagando
# ese retraso (con el rate limiter de 60/min por IP encima).
_TECHO_RETRASO_SEGUNDOS = 8

# QA4 REG-02 (decisión del dueño: «freno después de 10 intentos»): el techo de
# 8 s acota la espera de CADA intento, así que solo no frena a quien insiste.
# Lo compensa un enfriamiento por cuenta: al 10.º fallo consecutivo (el mismo
# contador, que el techo no resetea) la cuenta rechaza TODO intento durante 15
# minutos -- también el de la contraseña correcta -- de inmediato y sin correr
# bcrypt. El hash guarda `intentos` y `enfriada_hasta`.
#
# Al entrar en enfriamiento el TTL de la clave se estira hasta 15 min DESPUÉS
# del fin del enfriamiento: así el contador sobrevive al enfriamiento. Eso es
# lo que hace que, vencido, el siguiente fallo (el 11.º) reentre al
# enfriamiento de inmediato; solo un éxito (o el restablecimiento de
# contraseña) o 15 min sin tocar la cuenta lo resetean. Los intentos
# rechazados durante el enfriamiento NO tocan el hash: no lo prolongan ni
# alargan la espera de nadie.
_UMBRAL_ENFRIAMIENTO_INTENTOS = 10
_ENFRIAMIENTO_LOGIN_SEGUNDOS = 15 * 60
MENSAJE_LOGIN_ENFRIAMIENTO = (
    "Demasiados intentos fallidos. Por seguridad, espera 15 minutos o "
    "restablece tu contraseña."
)


class LoginEnEnfriamiento(Exception):
    """La cuenta está en el enfriamiento de 15 minutos (-> HTTP 429 con
    `Retry-After`, ver `auth_router.login`).

    NO es un `ErrorDominio`: el router la traduce a mano, así no entra al mapa
    global de `main.py`. Se lanza ANTES de buscar el usuario, igual para una
    cuenta real que para una inexistente (anti-enumeración)."""

    def __init__(self, segundos_restantes: int):
        self.segundos_restantes = segundos_restantes
        super().__init__(MENSAJE_LOGIN_ENFRIAMIENTO)


# REG-10: lo que lee quien intenta entrar con una cuenta dada de baja o
# suspendida. Espejo verbatim del texto que el frontend muestra para
# `account_inactive` (`frontend/src/app/login/page.tsx`).
MENSAJE_CUENTA_INACTIVA = (
    "Tu cuenta está inactiva. Comunícate con el club para reactivarla."
)


class CuentaInactiva(PermisosInsuficientes):
    """Las credenciales son correctas pero la cuenta (o la persona) está
    inactiva (-> HTTP 403, por herencia de `PermisosInsuficientes`).

    Distinta de `CredencialesInvalidas` a propósito: solo se lanza DESPUÉS de
    verificar la contraseña, así que decirlo no es un oráculo -- únicamente lo
    lee quien ya conoce la contraseña de esa cuenta. Quien se equivoca de
    contraseña sigue recibiendo el mismo 401 que una cuenta inexistente."""


def _registrar_intento_fallido(clave: str, ahora: float | None = None) -> int:
    """Suma un fallo a `clave` en Redis y devuelve el nuevo total. Al llegar
    a `_UMBRAL_ENFRIAMIENTO_INTENTOS` (y en cada fallo posterior) arranca el
    enfriamiento de la cuenta. Separado de
    `AuthServicio._penalizar_intento_fallido` para poder probarlo directo, sin
    DB ni sleep. Con Redis caído devuelve 0 (fail-open, ver el módulo de
    Redis): sin conteo no hay retraso ni enfriamiento."""
    if ahora is None:
        ahora = time.time()
    intentos = redis_intentos_login.incrementar(clave, _TTL_INTENTOS_LOGIN_SEGUNDOS)
    if intentos >= _UMBRAL_ENFRIAMIENTO_INTENTOS:
        redis_intentos_login.marcar_enfriamiento(
            clave,
            hasta=ahora + _ENFRIAMIENTO_LOGIN_SEGUNDOS,
            ttl_s=_ENFRIAMIENTO_LOGIN_SEGUNDOS + _TTL_INTENTOS_LOGIN_SEGUNDOS,
        )
    return intentos


def _segundos_de_enfriamiento(clave: str, ahora: float) -> int:
    """Segundos que le faltan al enfriamiento de `clave`; 0 si no está
    enfriada, ya venció o Redis no responde. Solo lee."""
    hasta = redis_intentos_login.enfriada_hasta(clave)
    if hasta is None or ahora >= hasta:
        return 0
    return math.ceil(hasta - ahora)


# Cuántas sesiones devuelve `listar_sesiones`. La tarjeta del perfil responde
# "¿desde dónde entré últimamente?", no "dame la bitácora completa". Es un
# corte de LECTURA: la tabla conserva todo.
LIMITE_SESIONES_LISTADAS = 10

# GAP-01: tiempo mínimo entre dos correos del mismo tipo (recuperación o
# verificación) para una misma cuenta. Protege el cupo diario del proveedor.
ENFRIAMIENTO_REENVIO_CORREO = timedelta(minutes=2)
MENSAJE_INVITACION_SIN_TERMINOS = (
    "Para activar tu cuenta debes aceptar los términos de uso y el aviso de privacidad."
)
MENSAJE_RECUPERACION_ENVIADA = "Si el correo está registrado, se envió un enlace de recuperación"


@dataclass(frozen=True)
class SesionVista:
    """Una fila de `sesion` ya resuelta contra el epoch del usuario.

    Existe para que `vigente` y `actual` -- que son DERIVADOS, no columnas--
    no se calculen en el router ni, peor, se persistan: `vigente` compone el
    epoch con `revocada_en` (ver el docstring de `Sesion`) y se recalcula en
    cada lectura.
    """

    id: int
    usuario_id: int
    dispositivo: str
    iniciada_en: datetime
    vigente: bool
    actual: bool


def _calcular_retraso_login(intentos_fallidos: int) -> int:
    """Decisión de negocio (docs/product/decisiones-de-negocio-2026-08-11.md, sección
    3): sin retraso antes del 3er intento fallido; 1s al 3ro, duplicando en
    cada intento siguiente, con techo de 8s (REG-02). Nunca bloqueo duro -- eso
    regala un ataque nuevo (dejar a un socio afuera sin saber ninguna
    contraseña)."""
    if intentos_fallidos < _UMBRAL_RETRASO_INTENTOS:
        return 0
    exponente = intentos_fallidos - _UMBRAL_RETRASO_INTENTOS
    return min(2 ** exponente, _TECHO_RETRASO_SEGUNDOS)


class AuthServicio:
    def __init__(
        self,
        db: Session,
        dormir: Callable[[float], None] = time.sleep,
        reloj: Callable[[], float] = time.time,
    ):
        self.db = db
        self.repo = UsuarioRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        # Inyectable para tests (BRIEF.md: ningún test hace un sleep real de
        # varios segundos). El router de producción no pasa `dormir`, así que
        # usa el `time.sleep` real.
        self._dormir = dormir
        # Inyectable por lo mismo: los tests del enfriamiento de 15 min avanzan
        # un reloj falso en vez de esperar. De pared y no monotónico: el fin del
        # enfriamiento lo lee cualquier worker (ver `redis_intentos_login`).
        self._reloj = reloj

    # --- Login ---------------------------------------------------------------
    def login(self, correo: str, contrasenia: str, user_agent: str | None = None) -> dict:
        """
        Devuelve el shape estandarizado `{access_token, refresh_token, token_type}`
        para el auto-login tras autenticarse (y para reutilizarlo tras registro).

        TRA-4: aplica el freno progresivo (contador en Redis) sobre
        el correo NORMALIZADO (trim + minúsculas), contra el string tal cual
        llega -- ANTES y con total independencia de si existe un Usuario con
        ese correo. Es lo que hace indistinguible por timing una cuenta real
        con contraseña incorrecta de una cuenta inexistente (ver
        `test_auth_freno_login.py::test_cuenta_inexistente_sigue_la_misma_
        curva_de_retraso_que_una_real`): ambas incrementan el MISMO tipo de
        contador y sufren el MISMO retraso, sin importar qué rama de
        `_verificar_credenciales` fue la que falló.

        `user_agent` es opcional y solo alimenta el registro observacional de
        sesiones: un cliente que no lo manda abre una sesión igual, con la
        etiqueta diciendo que no se sabe qué dispositivo es.
        """
        clave = correo.strip().lower()
        # REG-02: antes de buscar al usuario y de correr bcrypt, y con total
        # independencia de que la cuenta exista -- misma respuesta, mismo
        # costo y mismo texto para una real y una inexistente.
        segundos_restantes = _segundos_de_enfriamiento(clave, self._reloj())
        if segundos_restantes:
            contar_login(ok=False)
            raise LoginEnEnfriamiento(segundos_restantes)
        try:
            usuario = self._verificar_credenciales(correo, contrasenia)
        except CuentaInactiva:
            # La contraseña era correcta: no es un intento de adivinarla, así
            # que no suma al freno progresivo, pero tampoco es un login exitoso.
            contar_login(ok=False)
            raise
        except CredencialesInvalidas:
            contar_login(ok=False)
            self._penalizar_intento_fallido(clave)
            raise

        contar_login(ok=True)
        redis_intentos_login.olvidar(clave)
        sesion = self._registrar_sesion(usuario, user_agent)
        tokens = self._emitir_par_tokens(usuario, sesion)
        # Issue #1314: último, y sin poder fallar el login (ver `actividad`).
        actividad.registrar_sin_fallar(self.db, usuario.id)
        return tokens

    # --- Step-up de contraseña (#1653, S5) ------------------------------------
    def reautenticar(self, correo: str, sid: object, contrasenia: str) -> dict:
        """POST /auth/reautenticar: verifica la contraseña del titular y marca
        su sesión `sid` con `reautenticada_en` (ver `app.seguridad.reautenticacion`).

        Comparte el freno de login: usa el MISMO contador y enfriamiento por
        correo normalizado que `login`, así que quien tenga un access token
        robado no puede adivinar la contraseña por esta vía sin pagar el mismo
        retraso y el mismo enfriamiento de 15 minutos (que también frena el
        login legítimo de esa cuenta: es la política vigente, no una nueva).
        """
        clave = correo.strip().lower()
        segundos_restantes = _segundos_de_enfriamiento(clave, self._reloj())
        if segundos_restantes:
            contar_login(ok=False)
            raise LoginEnEnfriamiento(segundos_restantes)
        usuario = self.obtener_usuario_actual(correo)
        # El step-up se ata a una sesión: un token sin `sid` (anterior a la
        # rotación) no tiene fila donde guardarlo.
        sesion = (
            self.db.get(Sesion, sid)
            if isinstance(sid, int) and not isinstance(sid, bool) else None
        )
        if sesion is None or sesion.usuario_id != usuario.id or sesion.revocada_en is not None:
            raise OperacionInvalida(
                "Tu sesión es anterior a esta función. Cierra sesión y vuelve a entrar.",
                seguro_mostrar=True,
            )
        if not GestorAutenticacion.verificar_contrasenia(contrasenia, usuario.contrasenia):
            contar_login(ok=False)
            self._penalizar_intento_fallido(clave)
            raise ContraseniaIncorrecta("Contraseña incorrecta")

        _INTENTOS_FALLIDOS_LOGIN.pop(clave, None)
        ahora = reautenticacion.ahora_utc()
        sesion.reautenticada_en = ahora
        self.db.commit()
        return {"reautenticado_hasta": ahora + reautenticacion.VENTANA_REAUTENTICACION}

    def _registrar_sesion(
        self, usuario: Usuario, user_agent: str | None, iniciada_en: datetime | None = None,
        legacy_huella: str | None = None, rotado_en: datetime | None = None,
    ) -> Sesion:
        """Abre la sesión de un par de tokens: la fila nace con el `jti` del
        primer refresh y su actividad en este instante (ver `Sesion`).

        Va DESPUÉS de `_verificar_credenciales` a propósito: ese método
        rechaza también la cuenta suspendida y la persona dada de baja, que
        son los dos casos donde un registro mal ubicado dejaría la fila de una
        sesión que nunca llegó a existir.

        La fila guarda el epoch vigente (`version_sesion`) para que después se
        pueda DERIVAR si sigue viva. Nada se limpia acá: revocar todas las
        sesiones bombea el epoch y no toca esta tabla.

        `iniciada_en`, `legacy_huella` y `rotado_en` solo los pasa la adopción
        de un refresh legacy sin `sid` (ver `_sesion_de_legacy_sin_sid`).
        """
        sesion = Sesion(
            usuario_id=usuario.id,
            dispositivo=describir_dispositivo(user_agent),
            version_sesion=usuario.version_sesion,
            refresh_jti=uuid.uuid4().hex,
            ultimo_uso_en=datetime.now(timezone.utc),
        )
        if iniciada_en is not None:
            sesion.iniciada_en = iniciada_en
        sesion.legacy_huella = legacy_huella
        sesion.rotado_en = rotado_en
        self.db.add(sesion)
        self.db.commit()
        self.db.refresh(sesion)
        return sesion

    def _verificar_credenciales(self, correo: str, contrasenia: str) -> Usuario:
        usuario = self.repo.obtener_por_correo(correo)
        if not usuario or not GestorAutenticacion.verificar_contrasenia(contrasenia, usuario.contrasenia):
            raise CredencialesInvalidas("Correo o contraseña incorrectos")
        # E01-RF013: una cuenta suspendida por el Administrador no puede
        # loguearse, aunque la contraseña sea correcta. REG-10: llegados acá la
        # contraseña YA fue verificada, así que decir que la cuenta está
        # inactiva no revela nada a un tercero -- solo lo lee quien la conoce --
        # y le da una salida (escribir al club) en lugar de un "Correo o
        # contraseña incorrectos" que lo mandaba en círculo.
        if not usuario.activo:
            raise CuentaInactiva(MENSAJE_CUENTA_INACTIVA, seguro_mostrar=True)
        # Baja lógica de la PERSONA: quien ya no es miembro del club no entra,
        # aunque su cuenta figure como activa. No es redundante con el chequeo
        # de arriba: dar de baja a una persona desactiva su `Usuario`, pero
        # reactivar la cuenta (`PATCH /personas/{id}/cuenta/estado`) es una
        # operación independiente que no reincorpora a nadie al club. Sin esta
        # línea, ese camino le devolvería el acceso a un ex-miembro.
        if not usuario.persona.activo:
            raise CuentaInactiva(MENSAJE_CUENTA_INACTIVA, seguro_mostrar=True)
        return usuario

    def _penalizar_intento_fallido(self, clave: str) -> None:
        intentos = _registrar_intento_fallido(clave, self._reloj())
        retraso = _calcular_retraso_login(intentos)
        if retraso:
            self._dormir(retraso)

    # --- Registro de usuario para una Persona ya existente -------------------
    def registrar_usuario(self, datos: RegistroUsuarioDTO) -> dict:
        """
        Solo ADMINISTRADOR (`POST /auth/registro` exige
        `GestorPermisos(["ADMINISTRADOR"])`, ver `auth_router.py`): crea el
        `Usuario` (credenciales) para una `Persona` que YA existe (dada de
        alta antes por un ADMINISTRADOR vía POST /personas). NO crea Persona.
        Sin roles asignados (coherente con la asignación perezosa de roles ya
        implementada, los roles se asignan por separado).

        Devuelve { persona_id, usuario_id, correo }. Issue #1015: NO emite
        tokens de acceso/refresco -- el llamador es el ADMINISTRADOR
        autenticado que hace el registro, nunca la persona recién
        registrada, así que un par de tokens acá sería un par de
        credenciales vivas y sin dueño en su navegador.
        """
        persona = self.repo_persona.obtener_por_cedula(datos.cedula)
        if not persona:
            raise EntidadNoEncontrada(
                "No existe una persona registrada con esa cédula. "
                "Contacta al administrador del club."
            )

        # Issue #1137, invariante (B): una Persona con `representante_id`
        # nunca puede tener `Usuario` propio. Este endpoint no tenía este
        # candado -- solo comprobaba "existe" y "no tiene ya una cuenta" --
        # así que un ADMINISTRADOR podía acuñar credenciales para un menor
        # representado pasando su cédula.
        if persona.representante_id is not None:
            raise OperacionInvalida(MENSAJE_REPRESENTADO_SIN_CREDENCIALES_PROPIAS)

        # Endpoint ADMINISTRADOR-only (ver docstring arriba): los dos casos
        # de abajo comparten el mismo texto a propósito -- no por el motivo
        # anti-enumeración de `MENSAJE_IDENTIDAD_DUPLICADA` en un endpoint
        # público (este no lo es), sino porque el mensaje ya es el texto
        # estándar del producto para "cédula o correo ya en uso" y no hay
        # razón para inventar uno distinto acá.
        if persona.usuario is not None:
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        if self.repo.obtener_por_correo(datos.correo) is not None:
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        hash_contrasenia = GestorAutenticacion.obtener_hash_contrasenia(datos.contrasenia)
        nuevo_usuario = Usuario(
            correo=datos.correo,
            contrasenia=hash_contrasenia,
            persona_id=persona.id,
            # Issue #790: nace verificada, mismo criterio que
            # `AdminCuentaServicio.crear_cuenta`. Este endpoint dejó de ser
            # público hace tiempo (exige ADMINISTRADOR, ver `auth_router.py`),
            # así que no es la vía que ese issue cierra, y dejarla sin
            # verificar solo trabaría al administrador que está dando de alta
            # a alguien que tiene enfrente.
            correo_verificado=True,
        )
        try:
            nuevo_usuario = self.repo.crear(nuevo_usuario)
            self.db.commit()
        except IntegrityError as error:
            # Carrera (issue #1016, ADR-3): dos altas casi simultáneas para
            # la misma persona/correo pasan las dos el pre-check de arriba.
            # Mismo mensaje genérico que ese pre-check -- no divulgar cuál
            # de los dos campos chocó (ver `MENSAJE_IDENTIDAD_DUPLICADA`).
            self.db.rollback()
            # `None` es una restricción que NO es de identidad: se re-lanza
            # para que la trate el handler de `main.py`, en vez de anunciar
            # un duplicado que no ocurrió. `INDETERMINADA` (el driver no
            # expuso el nombre) conserva la traducción: el mensaje es el
            # mismo para cédula y para correo, así que no puede atribuirle
            # el choque al campo equivocado.
            if identidad_en_conflicto(error) is None:
                raise
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA) from error
        return {
            "persona_id": nuevo_usuario.persona_id,
            "usuario_id": nuevo_usuario.id,
            "correo": nuevo_usuario.correo,
        }

    # --- Núcleo presencial (#1137): credenciales de una Persona existente ----
    def establecer_credenciales_persona_existente(
        self, persona: Persona, correo: str, contrasenia: str
    ) -> Usuario:
        """Crea o actualiza las credenciales de una Persona YA existente y
        BLOQUEADA, sin comitear y sin emitir token.

        Es el núcleo de credenciales compartido de los comandos presenciales:
        el administrador tiene a la persona enfrente, verificó su identidad y
        su correo ACTUAL en el mostrador -- por eso la cuenta nace (o queda)
        con `correo_verificado=True` sin ningún clic en ningún buzón. La
        verificación de identidad ES el trámite presencial, no un email.

        - No crea `Persona`: opera sobre el `persona_id` recibido, que no
          cambia jamás.
        - La unicidad del correo se chequea NORMALIZADA (`lower(btrim)`,
          el mismo predicado de `obtener_por_correo` y del índice único
          `ix_usuario_correo_lower`): si la dirección pertenece a OTRA
          persona, el comando completo se rechaza sin desvincular nada.
        - Solo `flush()`: credenciales, capacidad, vínculo, auditoría y
          epoch comitean JUNTOS o no comitean. Quien llama hace el único
          `commit()`.

        Devuelve el `Usuario` establecido."""
        correo_normalizado = correo.strip().lower()
        cuenta_con_ese_correo = self.repo.obtener_por_correo(correo_normalizado)
        if cuenta_con_ese_correo is not None and cuenta_con_ese_correo.persona_id != persona.id:
            raise EntidadDuplicada(
                "Ese correo ya pertenece a otra persona. Pídele al titular "
                "otra dirección actual y vuelve a intentarlo.",
                detalle_tecnico=(
                    f"correo normalizado ya usado por persona_id="
                    f"{cuenta_con_ese_correo.persona_id}; pedido para "
                    f"persona_id={persona.id}"
                ),
            )

        usuario = self.repo.obtener_por_persona_id(persona.id)
        hash_contrasenia = GestorAutenticacion.obtener_hash_contrasenia(contrasenia)
        if usuario is None:
            usuario = Usuario(
                correo=correo_normalizado,
                contrasenia=hash_contrasenia,
                persona_id=persona.id,
                # La verificación la hizo el personal en persona: nace
                # verificada a propósito (mismo criterio documentado de
                # `registrar_usuario`, con evidencia presencial de por medio).
                correo_verificado=True,
            )
            self.repo.crear(usuario)
            return usuario

        usuario.correo = correo_normalizado
        usuario.contrasenia = hash_contrasenia
        usuario.correo_verificado = True
        self.db.flush()
        return usuario

    # --- Perfil del usuario autenticado -------------------------------------
    def obtener_usuario_actual(self, correo: str) -> Usuario:
        usuario = self.repo.obtener_por_correo(correo)
        if not usuario:
            raise CredencialesInvalidas("Token válido pero el usuario ya no existe")
        return usuario

    # --- Issue #36: perfil propio (self-service) ----------------------------
    def actualizar_perfil_propio(self, correo_actual: str, cambios: ActualizarPerfilPropioDTO) -> dict:
        """
        Actualiza el teléfono del USUARIO AUTENTICADO (resuelto vía el `sub`
        del JWT, jamás vía un identificador recibido en el request: así un
        usuario nunca puede editar el registro de otro).

        Correo deliberadamente no es editable aquí -- es el `sub` del JWT
        (`ActualizarPerfilPropioDTO` ni siquiera acepta el campo), evitando
        el riesgo de que un cambio de correo desloguee silenciosamente al
        usuario o requiera reemisión de tokens.

        `exclude_unset=True`: solo se toca `telefono` si vino en el payload
        (edición parcial).
        """
        usuario = self.obtener_usuario_actual(correo_actual)
        if not usuario.activo:
            raise CredencialesInvalidas("La cuenta está desactivada")
        datos = cambios.model_dump(exclude_unset=True)

        telefono_nuevo = datos.get("telefono")
        if telefono_nuevo is not None:
            self.repo_persona.actualizar(usuario.persona, {"telefono": telefono_nuevo})

        self.db.commit()
        self.db.refresh(usuario)

        return {
            "correo": usuario.correo,
            "persona_id": usuario.persona_id,
            "nombres": usuario.persona.nombres,
            "apellidos": usuario.persona.apellidos,
            "roles": [rol.tipo_rol.value for rol in usuario.roles],
            "telefono": usuario.persona.telefono,
            "fecha_creacion": usuario.fecha_creacion,
            "foto_url": usuario.persona.foto_url,
        }

    # --- Foto de perfil (self-service, POST /auth/me/foto) -------------------
    TIPOS_MIME_PERMITIDOS_FOTO_PERFIL = {"image/jpeg", "image/png"}
    TAMANO_MAXIMO_FOTO_PERFIL_BYTES = 5 * 1024 * 1024  # 5 MB, mismo límite que el voucher de pago

    def actualizar_foto_perfil(self, correo_actual: str, contenido: bytes, content_type: str) -> dict:
        """
        Sube y persiste la foto de perfil del USUARIO AUTENTICADO (resuelto vía
        el `sub` del JWT, igual que `actualizar_perfil_propio`: nunca vía un
        identificador recibido en el request, así un usuario nunca puede
        reemplazar la foto de otro).

        Valida tipo MIME y tamaño ANTES de tocar Cloudinary (falla rápido y
        barato, sin gastar la llamada externa en un archivo que de todos modos
        se va a rechazar). El `public_id` se deriva del `persona_id` del
        caller para que una foto nueva SOBRESCRIBA la anterior en Cloudinary
        en vez de acumular recursos huérfanos (mismo criterio que el voucher
        de pago).
        """
        usuario = self.obtener_usuario_actual(correo_actual)
        if not usuario.activo:
            raise CredencialesInvalidas("La cuenta está desactivada")

        if content_type not in self.TIPOS_MIME_PERMITIDOS_FOTO_PERFIL:
            raise OperacionInvalida("Formato de archivo no permitido. Usa JPG o PNG")
        # La firma binaria real debe coincidir con el tipo declarado: el
        # Content-Type que manda el cliente no prueba nada sobre el
        # contenido real (decisión de diseño 2.3, sdd/production-readiness).
        if not es_firma_valida(contenido, content_type):
            if not contenido:
                raise OperacionInvalida("La imagen está vacía o dañada. Elige otra foto JPG o PNG.")
            raise OperacionInvalida(
                "Ese archivo no es una imagen válida. Elige una foto JPG o PNG."
            )
        # Defensa en profundidad: el router ya acota la lectura vía
        # `leer_con_limite` antes de llegar acá.
        if len(contenido) > self.TAMANO_MAXIMO_FOTO_PERFIL_BYTES:
            raise OperacionInvalida("La imagen pesa más de 5 MB. Elige una más liviana.")

        from app.infraestructura.cloudinary_cliente import (
            componer_valor_foto_perfil,
            limpiar_foto_perfil_huerfana,
            public_id_con_extension,
            subir_foto_perfil,
        )

        # Issue #553 (Problema 2): la URL que devuelve el SDK al subir NO es una
        # URL de entrega válida (`type="authenticated"`). Se persiste el
        # `public_id` y la URL firmada se resuelve al serializar la respuesta
        # (`ActualizarFotoPerfilResponseDTO`, mismo patrón que el voucher).
        # Issue #1072: el `public_id` REAL de un recurso `raw` lleva la
        # extensión (`perfil_31.jpg`), así que se aplica acá -- con el MISMO
        # valor que sube `subir_foto_perfil` -- antes de persistirlo, para que
        # el que se firma al leer coincida (issue #480).
        # Issue #662: `public_id` es determinístico y el upload sobrescribe en
        # el mismo lugar, así que se compone el `version` de ESTA subida en el
        # valor persistido (continuidad del shape ya escrito en producción; la
        # entrega de un `raw` ya cambia sola en cada firma).
        public_id = public_id_con_extension(f"perfil_{usuario.persona_id}", content_type)
        # R3-001 (#1072): se captura el valor ANTERIOR a persistir la subida,
        # porque `public_id` ahora depende del formato (jpg vs png) y
        # `overwrite=True` deja de garantizar un solo asset vivo.
        foto_anterior = usuario.persona.foto_url
        version = subir_foto_perfil(
            contenido=contenido,
            nombre_publico=public_id,
            content_type=content_type,
            persona_id=usuario.persona_id,
        )

        self.repo_persona.actualizar(
            usuario.persona,
            {"foto_url": componer_valor_foto_perfil(public_id, version)},
        )
        self.db.commit()
        self.db.refresh(usuario)

        limpiar_foto_perfil_huerfana(foto_anterior, public_id)

        return {
            "correo": usuario.correo,
            "persona_id": usuario.persona_id,
            "nombres": usuario.persona.nombres,
            "apellidos": usuario.persona.apellidos,
            "roles": [rol.tipo_rol.value for rol in usuario.roles],
            "telefono": usuario.persona.telefono,
            "fecha_creacion": usuario.fecha_creacion,
            "foto_url": usuario.persona.foto_url,
        }

    # --- Refresh con rotación a partir de un refresh token ------------------
    def refrescar_sesion(self, refresh_token: str) -> dict:
        """Valida un refresh token y devuelve un par NUEVO (access + refresh)
        con los roles ACTUALES del usuario. Cada uso ROTA el refresh (#1653).

        Orden de las reglas:
          1) firma, `type=refresh`, usuario existente y `sesion_vigente`
             (epoch + cuenta activa), como siempre.
          2) con `jti`: la fila `sesion` de `sid` debe ser del usuario y no
             estar revocada; pasado el tope absoluto (`jwt_refresh_expira_dias`
             desde `iniciada_en`) o la ventana inactiva
             (`sesion_inactividad_horas` desde `ultimo_uso_en`) se REVOCA y se
             rechaza.
          3) `jti` == `refresh_jti`: se rota (el actual pasa a `_anterior`).
             `jti` == `refresh_jti_anterior` dentro de
             `sesion_gracia_rotacion_segundos` del `rotado_en`: es la carrera
             de dos refresh concurrentes del mismo cliente (el BFF) -- se
             reemite un par con el `jti` VIGENTE, sin rotar de nuevo. Cualquier
             otro `jti` es REUSO de un token ya rotado: se revoca la sesión.
          4) sin `jti` (refresh anterior a la rotación, S3): se acepta UNA vez.
             Con `sid` cuya fila aún no tiene `refresh_jti` se adopta (se omite
             la ventana inactiva esa vez, porque la fila no tiene
             `ultimo_uso_en`). Si la fila YA fue adoptada (`refresh_jti` fijo,
             `refresh_jti_anterior` nulo y `rotado_en` dentro de la gracia) es
             la misma carrera benigna del BFF con la misma cookie legacy: se
             reemite un par con el `jti` VIGENTE, sin rotar de nuevo, para que
             el deploy no desloguee a nadie. Fuera de la gracia, o sobre una
             fila nacida de un login (`rotado_en` nulo), es reuso y revoca.
             Sin `sid`, el primer uso abre una sesión con la huella del token
             (índice único) y los siguientes caen en esa fila con las mismas
             reglas de adopción: gracia o reuso (`_sesion_de_legacy_sin_sid`).

        La fila se bloquea (`FOR UPDATE`) mientras se decide: dos refresh
        simultáneos con el mismo `jti` se serializan y el segundo ve el estado
        ya rotado, cae en la gracia y no en el reuso.

        E01 -- invalidación de sesión (epoch compartido, ver `epoch_valido`):
        el `sver` del refresh se valida y no es opcional. Sin ese chequeo un
        refresh capturado reemitiría un access compatible con el epoch actual
        -- un bypass total de "cerrar mis otras sesiones".
        """
        try:
            payload = jwt.decode(
                refresh_token,
                settings.jwt_secret_key,
                algorithms=[settings.jwt_algoritmo],
            )
        except jwt.PyJWTError:
            raise CredencialesInvalidas("Refresh token inválido o expirado")

        if payload.get("type") != "refresh":
            # Protección: si mandan un access token al endpoint de refresh, se
            # rechaza. Reusa la misma excepción de dominio -> HTTP 401 vía
            # main.py (coherente con el login fallido).
            raise CredencialesInvalidas(
                "El token proporcionado no es un refresh token válido"
            )

        correo = payload.get("sub")
        if not isinstance(correo, str):
            raise CredencialesInvalidas("Refresh token inválido o expirado")

        usuario = self.repo.obtener_por_correo(correo)
        if not usuario:
            raise CredencialesInvalidas("El usuario del refresh token ya no existe")

        if not GestorAutenticacion.sesion_vigente(payload.get("sver"), usuario):
            raise CredencialesInvalidas("Refresh token inválido o expirado")

        ahora = datetime.now(timezone.utc)
        sid = payload.get("sid")
        jti = payload.get("jti")
        recien_abierta = False
        if sid is None and jti is None:
            sesion, recien_abierta = self._sesion_de_legacy_sin_sid(usuario, refresh_token, payload, ahora)
        else:
            sesion = self._sesion_bloqueada(usuario, sid)
        if not recien_abierta:
            if sesion is None or sesion.revocada_en is not None:
                raise CredencialesInvalidas("Refresh token inválido o expirado")
            if ahora - sesion.iniciada_en > timedelta(days=settings.jwt_refresh_expira_dias):
                self._revocar_sesion(sesion, ahora)
                raise CredencialesInvalidas("Refresh token inválido o expirado")
            if jti is None:
                self._adoptar_legacy(sesion, ahora)
            else:
                self._rotar_o_rechazar(sesion, jti, ahora)

        tokens = self._armar_par_tokens(usuario, sesion.id, sesion.refresh_jti)
        actividad.registrar_sin_fallar(self.db, usuario.id)
        return tokens

    def _sesion_de_legacy_sin_sid(
        self, usuario: Usuario, refresh_token: str, payload: dict, ahora: datetime,
    ) -> tuple[Sesion, bool]:
        """S3, refresh legacy SIN `sid`: la fila de su primer uso guarda la
        huella del token (índice único); un uso posterior cae en ella y sigue
        `_adoptar_legacy` (gracia o reuso), y un primer uso simultáneo que
        choca en el índice lee la del ganador. Sin `iat`, el inicio se deriva
        del `exp`, así el tope absoluto cuenta desde el login original."""
        huella = hashlib.sha256(refresh_token.encode()).hexdigest()
        existente = self._sesion_legacy_bloqueada(usuario, huella)
        if existente is not None:
            return existente, False
        exp = payload.get("exp")
        if not isinstance(exp, (int, float)) or isinstance(exp, bool):
            raise CredencialesInvalidas("Refresh token inválido o expirado")
        emitido_en = datetime.fromtimestamp(exp, tz=timezone.utc) - timedelta(
            days=settings.jwt_refresh_expira_dias
        )
        try:
            sesion = self._registrar_sesion(
                usuario, None, iniciada_en=min(emitido_en, ahora), legacy_huella=huella, rotado_en=ahora,
            )
        except IntegrityError:
            self.db.rollback()
            ganadora = self._sesion_legacy_bloqueada(usuario, huella)
            if ganadora is None:
                raise
            return ganadora, False
        return sesion, True

    def _sesion_legacy_bloqueada(self, usuario: Usuario, huella: str) -> Sesion | None:
        return (
            self.db.query(Sesion)
            .filter(Sesion.legacy_huella == huella, Sesion.usuario_id == usuario.id)
            .with_for_update()
            .one_or_none()
        )

    def _sesion_bloqueada(self, usuario: Usuario, sid: object) -> Sesion | None:
        """La fila `sesion` de `sid`, bloqueada, solo si es de `usuario`."""
        if not isinstance(sid, int) or isinstance(sid, bool):
            return None
        return (
            self.db.query(Sesion)
            .filter(Sesion.id == sid, Sesion.usuario_id == usuario.id)
            .with_for_update()
            .one_or_none()
        )

    def _revocar_sesion(self, sesion: Sesion, ahora: datetime) -> None:
        """Revoca la sesión Y persiste: quien llama rechaza enseguida, y un
        rechazo no puede deshacer la revocación que lo causó."""
        sesion.revocada_en = ahora
        self.db.commit()

    def _adoptar_legacy(self, sesion: Sesion, ahora: datetime) -> None:
        """S3: primer uso de un refresh sin `jti` sobre una fila anterior a la
        rotación. Si la fila ya tiene `refresh_jti`, el token ya se usó: dentro
        de la gracia de una adopción es la carrera benigna (no se rota), y en
        cualquier otro caso es reuso."""
        if sesion.refresh_jti is not None:
            adoptada_en_gracia = (
                sesion.refresh_jti_anterior is None
                and sesion.rotado_en is not None
                and ahora - sesion.rotado_en <= timedelta(seconds=settings.sesion_gracia_rotacion_segundos)
            )
            if adoptada_en_gracia:
                return
            self._revocar_sesion(sesion, ahora)
            raise CredencialesInvalidas("Refresh token inválido o expirado")
        sesion.refresh_jti = uuid.uuid4().hex
        sesion.rotado_en = ahora
        sesion.ultimo_uso_en = ahora
        self.db.commit()

    def _rotar_o_rechazar(self, sesion: Sesion, jti: str, ahora: datetime) -> None:
        """Reglas de un refresh CON `jti` sobre una sesión viva (ver
        `refrescar_sesion`, puntos 2 y 3)."""
        ultimo_uso = sesion.ultimo_uso_en or sesion.iniciada_en
        if ahora - ultimo_uso > timedelta(hours=settings.sesion_inactividad_horas):
            self._revocar_sesion(sesion, ahora)
            raise CredencialesInvalidas("Refresh token inválido o expirado")
        if jti == sesion.refresh_jti:
            sesion.refresh_jti_anterior = sesion.refresh_jti
            sesion.refresh_jti = uuid.uuid4().hex
            sesion.rotado_en = ahora
            sesion.ultimo_uso_en = ahora
            self.db.commit()
            return
        en_gracia = (
            jti == sesion.refresh_jti_anterior
            and sesion.rotado_en is not None
            and ahora - sesion.rotado_en <= timedelta(seconds=settings.sesion_gracia_rotacion_segundos)
        )
        if en_gracia:
            # El bloqueo de fila lo suelta el rollback/commit de la petición.
            return
        self._revocar_sesion(sesion, ahora)
        raise CredencialesInvalidas("Refresh token inválido o expirado")

    # --- E01: invalidación de sesión (primitiva compartida) -----------------
    def _bombear_epoch_sesion(self, correo: str) -> Usuario:
        """Bombea `version_sesion` del usuario autenticado (resuelto vía el
        `sub` del JWT) y persiste el cambio. NO reemite tokens -- eso queda a
        criterio de cada caller, ver `invalidar_otras_sesiones` (sí reemite).

        El bump del epoch invalida de inmediato TODO token previo -- access y
        refresh, ver `GestorAutenticacion.epoch_valido` -- incluido el que se
        usó para autenticar esta misma llamada.
        """
        usuario = self.obtener_usuario_actual(correo)
        usuario.revocar_sesiones()
        self.db.commit()
        self.db.refresh(usuario)
        return usuario

    def invalidar_otras_sesiones(self, correo: str, user_agent: str | None = None) -> dict:
        """POST /auth/sesiones/invalidar: bombea el epoch y le reemite un par
        de tokens nuevo EN LA MISMA respuesta. El re-issue es lo que
        convierte esto en "cerrar mis OTRAS sesiones" en vez de "cerrar
        también la mía": el caller sigue autenticado con el par nuevo, que ya
        lleva el `sver` vigente.

        Reemitir tokens ES abrir una sesión, así que se registra como tal. Sin
        esta fila el usuario tocaría el botón y quedaría mirando una lista
        vacía mientras sigue perfectamente logueado: todas las filas previas
        nacieron bajo el epoch anterior y acaban de morir, incluida la suya.
        """
        usuario = self._bombear_epoch_sesion(correo)
        sesion = self._registrar_sesion(usuario, user_agent)
        tokens = self._emitir_par_tokens(usuario, sesion)
        # Issue #1314: último, y sin poder fallar el login (ver `actividad`).
        actividad.registrar_sin_fallar(self.db, usuario.id)
        return tokens

    # --- TRA-10 / #1653 S4: POST /auth/logout --------------------------------
    def cerrar_sesion(self, correo: str, sid: object = None) -> dict:
        """Cierra la sesión del caller y NO reemite tokens -- a diferencia de
        `invalidar_otras_sesiones`, acá el caller debe quedar deslogueado.

        Revoca SOLO la sesión actual: marca `revocada_en` en la fila `sid`, y
        con eso mueren su access (`decodificar_token`) y su refresh
        (`refrescar_sesion`) sin tocar los demás dispositivos. Es idempotente:
        una fila ya revocada conserva su marca original y una `sid` que no es
        de este usuario (o no existe) no hace nada, sin error.

        Un token sin `sid` (access emitido antes de la rotación, <= 60 min) no
        dice de qué dispositivo es, así que no se puede cerrar "solo este":
        cae al comportamiento anterior y bombea el epoch, que es el lado seguro
        (mueren todas, nunca queda viva la que el usuario quiso cerrar).
        """
        if sid is None:
            self._bombear_epoch_sesion(correo)
            return {"mensaje": "Sesión finalizada"}
        usuario = self.obtener_usuario_actual(correo)
        sesion = self._sesion_bloqueada(usuario, sid)
        # Ya revocada o ajena: nada que hacer (el bloqueo de fila lo suelta el
        # cierre de la petición, igual que en `_rotar_o_rechazar`).
        if sesion is not None and sesion.revocada_en is None:
            self._revocar_sesion(sesion, datetime.now(timezone.utc))
        return {"mensaje": "Sesión finalizada"}

    # --- Privado: emisión del par access + refresh -------------------------
    def _emitir_par_tokens(self, usuario: Usuario, sesion: Sesion) -> dict:
        """Emite el par de una sesión RECIÉN abierta (`_registrar_sesion`):
        todo emisor abre su fila, así que los únicos refresh sin `jti` son los
        anteriores a la rotación."""
        return self._armar_par_tokens(usuario, sesion.id, sesion.refresh_jti)

    def _armar_par_tokens(self, usuario: Usuario, sesion_id: int, jti: str) -> dict:
        """Firma el par de la sesión `sesion_id`: ambos llevan `sid` y el
        refresh lleva además el `jti` que la fila tiene por vigente.

        `sid` sirve a `GET /auth/me/sesiones` para marcar el equipo actual y a
        `decodificar_token`/`refrescar_sesion` para exigir que su fila siga
        viva (revocación por sesión, ver `Sesion`). Los roles se releen del
        usuario en cada emisión.
        """
        claims = GestorAutenticacion.claims_estandar(self.db, usuario)
        # El refresh token no necesita roles (solo sirve para pedir un nuevo
        # par; los roles se releen del usuario en cada refresh), pero sí lleva
        # el estado para que el guard de borde pueda reconocer una cuenta
        # pendiente sin validar el JWT en Edge.
        refresh_claims = {
            "sub": claims["sub"],
            "persona_id": claims["persona_id"],
            "activacion_completa": claims["activacion_completa"],
            "sid": sesion_id,
        }
        claims["sid"] = sesion_id

        access_token = GestorAutenticacion.crear_token_acceso(claims, version_sesion=usuario.version_sesion)
        refresh_token = GestorAutenticacion.crear_token_refresco(
            refresh_claims, version_sesion=usuario.version_sesion, jti=jti,
        )
        return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}

    # --- Issue #1318: reemisión para un cambio de rol de OTRO servicio ------
    def reemitir_tokens_para(self, usuario: Usuario) -> dict:
        """Abre una sesión y emite su par, para un caller de otra capa de
        negocio (`PersonaServicio.crear_representado_propio`, la inscripción)
        que necesita un par sin reimplementar `claims_estandar` ni la
        apertura de la fila `sesion`.

        Mismo motivo que `cambiar_correo_no_verificado`: los roles viajan
        embebidos en el JWT, así que un token emitido antes de la mutación
        sigue leyendo el rol viejo hasta su expiración natural -- sin
        reemisión, quien acaba de pasar a ser REPRESENTANTE seguiría viendo
        su sesión como ALUMNO hasta el próximo login."""
        sesion = self._registrar_sesion(usuario, None)
        return self._emitir_par_tokens(usuario, sesion)

    # --- Listado de sesiones propias ----------------------------------------
    def listar_sesiones(
        self,
        correo: str,
        sesion_actual_id: int | None,
        limite: int | None = None,
        desplazamiento: int = 0,
    ) -> list[SesionVista]:
        """Las sesiones del usuario autenticado, la más reciente primero.

        `vigente` se DERIVA comparando el epoch de cada fila contra
        `usuario.version_sesion`. Es una lectura del mecanismo autoritativo, no
        una segunda fuente de verdad: por eso revocar no escribe acá, y por eso
        una fila nunca se actualiza ni se borra al morir.

        El corte en `LIMITE_SESIONES_LISTADAS` es de LECTURA. Cada login agrega
        una fila para siempre y la tarjeta del perfil muestra las últimas, no
        una bitácora de auditoría -- pero borrar el resto sería tirar historial
        para ahorrar en una consulta que ya está indexada.

        Con `limite` el listado se PAGINA en la consulta (LIMIT/OFFSET): la
        sesión actual va primera y después las más recientes, para que la
        primera página sea "este equipo" + lo último. Sin `limite` nada cambia:
        orden por recencia y corte en `LIMITE_SESIONES_LISTADAS`. Quien pagina
        pide `limite + 1` para saber si hay más, sin sobre ni encabezado.
        """
        usuario = self.obtener_usuario_actual(correo)
        consulta = self.db.query(Sesion).filter(Sesion.usuario_id == usuario.id)
        if limite is None:
            consulta = consulta.order_by(Sesion.iniciada_en.desc(), Sesion.id.desc()).limit(
                LIMITE_SESIONES_LISTADAS
            )
        else:
            if sesion_actual_id is not None:
                consulta = consulta.order_by(case((Sesion.id == sesion_actual_id, 0), else_=1))
            consulta = (
                consulta.order_by(Sesion.iniciada_en.desc(), Sesion.id.desc())
                .offset(desplazamiento)
                .limit(limite)
            )
        filas = consulta.all()
        return [
            SesionVista(
                id=fila.id,
                usuario_id=fila.usuario_id,
                dispositivo=fila.dispositivo,
                iniciada_en=fila.iniciada_en,
                vigente=fila.version_sesion == usuario.version_sesion and fila.revocada_en is None,
                actual=sesion_actual_id is not None and fila.id == sesion_actual_id,
            )
            for fila in filas
        ]

    # --- E01-RF003: recuperación de contraseña -------------------------------
    def _en_enfriamiento(self, modelo, usuario_id: int) -> bool:
        """GAP-01: ¿esta cuenta ya recibió (o tiene recién encolado) un correo
        de este tipo hace menos de `ENFRIAMIENTO_REENVIO_CORREO`?

        Se mide contra la fila más reciente de CUALQUIER estado: el índice
        parcial único solo cubre las activas, así que una fila ya `ENVIADO`
        no frenaría nada por sí sola. Quien llama responde exactamente igual
        que en el camino normal: el enfriamiento no puede delatar si la
        cuenta existe."""
        limite = datetime.now(timezone.utc) - ENFRIAMIENTO_REENVIO_CORREO
        return self.db.query(
            self.db.query(modelo)
            .filter(
                modelo.usuario_id == usuario_id,
                or_(modelo.created_at >= limite, modelo.sent_at >= limite),
            )
            .exists()
        ).scalar()

    def _encolar_recuperacion(self, usuario, *, respetar_enfriamiento: bool) -> bool:
        """Deja en el outbox (SIN commit) el envío del enlace de la cuenta.

        Devuelve `False` cuando el enfriamiento lo frena y no se encoló nada.
        `respetar_enfriamiento=False` es para el reenvío explícito de un
        administrador (issue #1575): una acción de personal autenticada, no
        un formulario público que haya que proteger del abuso."""
        evento = (
            self.db.query(RecuperacionOutbox)
            .filter(
                RecuperacionOutbox.usuario_id == usuario.id,
                RecuperacionOutbox.status.in_(("PENDIENTE", "ENVIANDO")),
            )
            .first()
        )
        if evento is None:
            if respetar_enfriamiento and self._en_enfriamiento(RecuperacionOutbox, usuario.id):
                return False
            self.db.add(
                RecuperacionOutbox(
                    usuario_id=usuario.id,
                    expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
                )
            )
        elif evento.status == "PENDIENTE":
            # El dedupe reusa la fila activa -- el índice parcial único
            # `uq_recuperacion_outbox_usuario_activo` lo exige -- pero
            # reusarla SIN adelantarla convertía "Enviar otro enlace" en un
            # 200 que no hace nada: tras un fallo de envío el backoff empuja
            # `next_attempt_at` hasta 16 minutos adelante y el despachador no
            # vuelve a mirar la fila hasta entonces (issue #764).
            #
            # El backoff existe para no castigar al proveedor SMTP por un
            # fallo NUESTRO; una petición explícita del usuario es
            # información nueva y vale reintentar ya. `min` porque esto solo
            # puede adelantar, nunca posponer, y no se tocan los `attempts`
            # gastados: el tope de MAX_ATTEMPTS sigue acotando cuántas veces
            # se intenta en total. Una fila `ENVIANDO` no se toca: está
            # reclamada por un worker y su lease manda.
            evento.next_attempt_at = min(
                evento.next_attempt_at, datetime.now(timezone.utc)
            )
        if evento is None or evento.status == "PENDIENTE":
            encolar_despacho_tras_commit(
                self.db, "app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes"
            )
        return True

    def solicitar_recuperacion(self, correo: str) -> dict:
        """Registra la solicitud localmente; el worker enviará el enlace.

        El token se genera al enviar y nunca se persiste. El commit del outbox
        precede cualquier intento de hablar con Redis, por lo que una caída del
        broker no pierde una solicitud aceptada por PostgreSQL.
        """
        usuario = self.repo.obtener_por_correo(correo)
        if usuario:
            if not self._encolar_recuperacion(usuario, respetar_enfriamiento=True):
                return {"mensaje": MENSAJE_RECUPERACION_ENVIADA}
            try:
                self.db.commit()
            except Exception:
                self.db.rollback()
                _log.exception("No se pudo registrar la recuperación de contraseña")
                raise ServicioNoDisponible(
                    "No se pudo procesar la solicitud. Intenta nuevamente más tarde"
                )
        return {"mensaje": MENSAJE_RECUPERACION_ENVIADA}

    def restablecer_contrasenia(
        self, token: str, nueva_contrasenia: str, acepta_terminos: bool = False,
    ) -> None:
        """Fija la contraseña con el enlace de recuperación.

        Con el enlace de la INVITACIÓN de un entrenador (issue #1575) este es
        además su primer ingreso: exige aceptar los términos vigentes, deja el
        mismo registro `ConsentimientoLegal` que la inscripción pública y
        marca el correo como verificado. Una recuperación común no cambia."""
        payload = GestorAutenticacion.decodificar_token_recuperacion(token)
        correo = payload["sub"]
        version_token = payload.get("ver")
        if not isinstance(version_token, int):
            raise CredencialesInvalidas("El enlace de recuperación es inválido o expiró")

        usuario = self.repo.obtener_por_correo(correo)
        if not usuario or usuario.version_contrasenia != version_token:
            raise CredencialesInvalidas("El enlace de recuperación es inválido o expiró")

        # Una cuenta suspendida (o cuya persona fue dada de baja del club) no
        # debe recuperar acceso vía restablecimiento: mismos estados que
        # bloquean el login. Mismo mensaje genérico que un token inválido,
        # para no revelar el estado de la cuenta a quien tenga el enlace.
        if not usuario.activo or not usuario.persona.activo:
            raise CredencialesInvalidas("El enlace de recuperación es inválido o expiró")

        es_invitacion_entrenador = (
            payload.get("prp") == PROPOSITO_INVITACION_ENTRENADOR
            and invitacion_pendiente(usuario)
        )
        # Issue #1666: el segundo guardián al que la invitación le creó la
        # cuenta. Mismo token y mismo mecanismo; fijar la contraseña con ese
        # enlace prueba el correo y ACEPTA la invitación.
        invitaciones_co_representante = (
            CoRepresentanteRepositorio(self.db).listar_pendientes_de_cuenta(usuario.persona_id)
            if payload.get("prp") == PROPOSITO_INVITACION_CO_REPRESENTANTE
            and not usuario.correo_verificado
            else []
        )
        es_invitacion = es_invitacion_entrenador or bool(invitaciones_co_representante)
        if es_invitacion and not acepta_terminos:
            raise OperacionInvalida(MENSAJE_INVITACION_SIN_TERMINOS)

        if GestorAutenticacion.verificar_contrasenia(nueva_contrasenia, usuario.contrasenia):
            raise OperacionInvalida("La nueva contraseña debe ser distinta de la actual.")

        usuario.contrasenia = GestorAutenticacion.obtener_hash_contrasenia(nueva_contrasenia)
        usuario.version_contrasenia += 1
        if es_invitacion:
            usuario.correo_verificado = True
            if invitaciones_co_representante:
                from app.servicios_negocio.co_representante_servicio import CoRepresentanteServicio
                CoRepresentanteServicio(self.db).aceptar_invitaciones(usuario)
            documentos = ("TERMINOS", "PRIVACIDAD")
            ConsentimientoLegalServicio(self.db)._registrar_aceptacion_grupal_nucleo(
                cuenta_id=usuario.id,
                documentos=documentos,
                version=VERSION_LEGAL_VIGENTE,
                texto_por_documento=TEXTOS_LEGALES_VIGENTES,
            )
        # Criterio unificado (issue #4): restablecer la contraseña RETIRA el
        # acceso previo. Quien restablece suele hacerlo porque sospecha que su
        # cuenta está comprometida: un access/refresh token robado no debe
        # sobrevivir al reset.
        usuario.revocar_sesiones()
        self.db.commit()
        # REG-02: quien restablece recupera la cuenta, así que se limpia el
        # contador y el enfriamiento (si no, seguiría bloqueado con la clave
        # nueva en la mano).
        redis_intentos_login.olvidar(usuario.correo.strip().lower())

    def cambiar_contrasenia(
        self, correo: str, contrasenia_actual: str, nueva_contrasenia: str,
        user_agent: str | None = None,
    ) -> dict:
        """POST /auth/contrasenia/cambiar (FAM-17): cambio desde el perfil.

        Exige la contraseña actual y rechaza una nueva igual a ella. Igual que
        el restablecimiento, retira el acceso previo (bombea el epoch); como
        quien cambia la clave sigue en su equipo, se le reemite un par nuevo
        -- mismo mecanismo que `invalidar_otras_sesiones`. Las demás sesiones
        mueren porque nacieron bajo el epoch anterior.
        """
        usuario = self.obtener_usuario_actual(correo)
        if not GestorAutenticacion.verificar_contrasenia(contrasenia_actual, usuario.contrasenia):
            raise OperacionInvalida("La contraseña actual es incorrecta.")
        if GestorAutenticacion.verificar_contrasenia(nueva_contrasenia, usuario.contrasenia):
            raise OperacionInvalida("La nueva contraseña debe ser distinta de la actual.")

        usuario.contrasenia = GestorAutenticacion.obtener_hash_contrasenia(nueva_contrasenia)
        usuario.version_contrasenia += 1
        usuario.revocar_sesiones()
        self.db.commit()
        self.db.refresh(usuario)

        sesion = self._registrar_sesion(usuario, user_agent)
        tokens = self._emitir_par_tokens(usuario, sesion)
        actividad.registrar_sin_fallar(self.db, usuario.id)
        return tokens

    # --- Issue #790: verificación de la dirección de correo ------------------
    def solicitar_verificacion_correo(self, correo: str) -> dict:
        """Registra la solicitud localmente; el worker enviará el enlace.

        Copia deliberada de la forma de `solicitar_recuperacion`, incluida su
        disciplina anti-enumeración: TODO el trabajo vive dentro del `if`, y
        una dirección desconocida cae directo al mismo `return`. Una cuenta ya
        verificada tampoco encola nada -- sería trabajo inútil -- pero
        responde exactamente igual, porque la respuesta no puede delatar en
        qué estado está una cuenta que sí existe.
        """
        usuario = self.repo.obtener_por_correo(correo)
        if usuario and not usuario.correo_verificado:
            evento = (
                self.db.query(VerificacionCorreoOutbox)
                .filter(
                    VerificacionCorreoOutbox.usuario_id == usuario.id,
                    VerificacionCorreoOutbox.status.in_(("PENDIENTE", "ENVIANDO")),
                )
                .first()
            )
            if evento is None:
                if self._en_enfriamiento(VerificacionCorreoOutbox, usuario.id):
                    return {"mensaje": MENSAJE_VERIFICACION_ENVIADA}
                self.db.add(
                    VerificacionCorreoOutbox(
                        usuario_id=usuario.id,
                        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
                    )
                )
            elif evento.status == "PENDIENTE":
                # El índice parcial único obliga a reusar la fila activa;
                # reusarla sin adelantar `next_attempt_at` convertiría
                # "reenviar" en un 200 que no hace nada mientras el backoff
                # empuja el reintento hasta 16 minutos adelante (issue #764).
                # `min` porque esto solo puede adelantar, nunca posponer, y no
                # se tocan los `attempts` gastados. Una fila `ENVIANDO` no se
                # toca: está reclamada por un worker y su lease manda.
                evento.next_attempt_at = min(
                    evento.next_attempt_at, datetime.now(timezone.utc)
                )
            if evento is None or evento.status == "PENDIENTE":
                encolar_despacho_tras_commit(
                    self.db, "app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes"
                )
            try:
                self.db.commit()
            except Exception:
                self.db.rollback()
                _log.exception("No se pudo registrar la verificación de correo")
                raise ServicioNoDisponible(
                    "No se pudo procesar la solicitud. Intenta nuevamente más tarde"
                )
        return {"mensaje": MENSAJE_VERIFICACION_ENVIADA}

    def confirmar_verificacion_correo(self, token: str) -> None:
        """Marca la dirección como probada.

        Idempotente a propósito: reabrir el enlace es lo que hace cualquiera
        que no está seguro de haber hecho clic, y responder distinto la segunda
        vez convertiría el endpoint en un oráculo de qué direcciones ya se
        verificaron. Todos los caminos de fallo comparten el MISMO mensaje,
        igual que `restablecer_contrasenia`: un token corrupto, uno de una
        cuenta inexistente y uno de una cuenta suspendida son indistinguibles
        desde afuera.
        """
        payload = GestorAutenticacion.decodificar_token_verificacion_correo(token)
        usuario = self.repo.obtener_por_correo(payload["sub"])
        if not usuario:
            raise CredencialesInvalidas("El enlace de verificación es inválido o expiró")

        # Mismos estados que bloquean el login: una cuenta suspendida (o cuya
        # persona fue dada de baja del club) no debe poder ganar capacidades.
        if not usuario.activo or not usuario.persona.activo:
            raise CredencialesInvalidas("El enlace de verificación es inválido o expiró")

        if usuario.correo_verificado:
            return

        usuario.correo_verificado = True
        self.db.commit()

    # --- Issue #1245: corregir el correo de una cuenta sin verificar --------
    def cambiar_correo_no_verificado(self, correo_actual: str, correo_nuevo: str) -> dict:
        """Corrige la dirección con la que la cuenta AUTENTICADA se
        inscribió, mientras `correo_verificado` sigue en False.

        Cierra el callejón sin salida del issue: quien se autoinscribió con
        un correo mal tipeado nunca recibía el enlace de verificación y no
        tenía forma de arreglarlo -- reinscribirse choca con el 400 de
        identidad duplicada (`enrollment_servicio.enroll`) antes de llegar
        siquiera a mirar el correo. Deliberadamente distinto de
        `actualizar_perfil_propio` (`PATCH /auth/me`): ese endpoint excluye
        `correo` a propósito porque la edición propia fue removida por
        diseño para una cuenta YA verificada -- esta es la única puerta, y
        se cierra sola en cuanto la cuenta lo está.

        Reusa `obtener_por_correo` para la unicidad (misma comparación
        normalizada que login/registro/recuperación) y
        `solicitar_verificacion_correo` para encolar el enlace a la
        dirección nueva, con la MISMA disciplina de outbox que cualquier
        otra alta -- pero antes retira las filas todavía activas de la
        dirección vieja: si sobrevivieran, el próximo reintento del worker
        entregaría el enlace a un correo que el titular ya dijo que estaba
        mal.

        El `sub` del JWT es el correo: reemite el par de tokens al final,
        igual que `invalidar_otras_sesiones`, para que el caller siga
        autenticado bajo la dirección nueva en la misma respuesta que
        confirma el cambio.
        """
        usuario = self.obtener_usuario_actual(correo_actual)
        if usuario.correo_verificado:
            raise OperacionInvalida(
                "El correo ya está verificado y no puede modificarse por esta vía."
            )

        cuenta_existente = self.repo.obtener_por_correo(correo_nuevo)
        if cuenta_existente is not None and cuenta_existente.id != usuario.id:
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        usuario.correo = correo_nuevo
        self.db.query(VerificacionCorreoOutbox).filter(
            VerificacionCorreoOutbox.usuario_id == usuario.id,
            VerificacionCorreoOutbox.status.in_(("PENDIENTE", "ENVIANDO")),
        ).delete(synchronize_session=False)

        try:
            self.db.commit()
        except IntegrityError as error:
            # Carrera (mismo criterio que `registrar_usuario`): dos
            # correcciones casi simultáneas hacia la misma dirección nueva
            # pasan las dos el pre-check de arriba.
            self.db.rollback()
            if identidad_en_conflicto(error) is None:
                raise
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA) from error

        self.db.refresh(usuario)
        self.solicitar_verificacion_correo(usuario.correo)
        tokens = self.reemitir_tokens_para(usuario)
        return {"correo": usuario.correo, "mensaje": MENSAJE_VERIFICACION_ENVIADA, **tokens}
