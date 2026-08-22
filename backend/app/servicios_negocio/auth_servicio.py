import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

import jwt
from sqlalchemy.orm import Session

from app.dominio.modelos import Sesion, Usuario
from app.dominio.excepciones import (
    CredencialesInvalidas, EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida,
    ServicioNoDisponible,
)
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.presentacion.schemas.auth_schemas import RegistroUsuarioDTO, ActualizarPerfilPropioDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.dispositivo import describir_dispositivo
from app.soporte_transversal.firma_archivos import es_firma_valida

_log = logging.getLogger(__name__)

# --- TRA-4 (issue #111): freno progresivo de login por cuenta --------------
# Contador de intentos fallidos CONSECUTIVOS por correo (normalizado, ver
# `login`). Vive en un dict a nivel de módulo -- simplificación aceptada para
# el alcance de este proyecto, mismo criterio que la ausencia de blacklist
# Redis ya documentada en `refrescar_sesion`: no sobrevive un reinicio del
# proceso ni se comparte entre réplicas. En producción multi-instancia se
# movería a Redis con TTL (el TTL además limpiaría solo los intentos de
# cuentas inexistentes, que acá quedan en memoria indefinidamente).
_INTENTOS_FALLIDOS_LOGIN: dict[str, int] = {}
_UMBRAL_RETRASO_INTENTOS = 3
_TECHO_RETRASO_SEGUNDOS = 60

# Cuántas sesiones devuelve `listar_sesiones`. La tarjeta del perfil responde
# "¿desde dónde entré últimamente?", no "dame la bitácora completa". Es un
# corte de LECTURA: la tabla conserva todo.
LIMITE_SESIONES_LISTADAS = 10


@dataclass(frozen=True)
class SesionVista:
    """Una fila de `sesion` ya resuelta contra el epoch del usuario.

    Existe para que `vigente` y `actual` -- que son DERIVADOS, no columnas--
    no se calculen en el router ni, peor, se persistan. Si vivieran en la
    tabla, la tabla habría empezado a opinar sobre validez, que es justo lo
    que el docstring de `Sesion` prohíbe.
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
    cada intento siguiente, con techo de 60s. Nunca bloqueo duro -- eso
    regala un ataque nuevo (dejar a un socio afuera sin saber ninguna
    contraseña)."""
    if intentos_fallidos < _UMBRAL_RETRASO_INTENTOS:
        return 0
    exponente = intentos_fallidos - _UMBRAL_RETRASO_INTENTOS
    return min(2 ** exponente, _TECHO_RETRASO_SEGUNDOS)


class AuthServicio:
    def __init__(self, db: Session, dormir: Callable[[float], None] = time.sleep):
        self.db = db
        self.repo = UsuarioRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        # Inyectable para tests (BRIEF.md: ningún test hace un sleep real de
        # varios segundos). El router de producción no pasa `dormir`, así que
        # usa el `time.sleep` real.
        self._dormir = dormir

    # --- Login ---------------------------------------------------------------
    def login(self, correo: str, contrasenia: str, user_agent: str | None = None) -> dict:
        """
        Devuelve el shape estandarizado `{access_token, refresh_token, token_type}`
        para el auto-login tras autenticarse (y para reutilizarlo tras registro).

        TRA-4: aplica el freno progresivo de `_INTENTOS_FALLIDOS_LOGIN` sobre
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
        try:
            usuario = self._verificar_credenciales(correo, contrasenia)
        except CredencialesInvalidas:
            self._penalizar_intento_fallido(clave)
            raise

        _INTENTOS_FALLIDOS_LOGIN.pop(clave, None)
        sesion = self._registrar_sesion(usuario, user_agent)
        return self._emitir_par_tokens(usuario, sesion_id=sesion.id)

    def _registrar_sesion(self, usuario: Usuario, user_agent: str | None) -> Sesion:
        """Deja constancia de un login. Nada más que constancia.

        Va DESPUÉS de `_verificar_credenciales` a propósito: ese método
        rechaza también la cuenta suspendida y la persona dada de baja, que
        son los dos casos donde un registro mal ubicado dejaría la fila de una
        sesión que nunca llegó a existir.

        La fila guarda el epoch vigente (`version_sesion`) para que después se
        pueda DERIVAR si sigue viva, sin que esta tabla participe de la
        decisión -- ver el docstring de `Sesion`. Por eso tampoco se limpia
        nada acá: revocar sesiones bombea el epoch y no toca esta tabla.
        """
        sesion = Sesion(
            usuario_id=usuario.id,
            dispositivo=describir_dispositivo(user_agent),
            version_sesion=usuario.version_sesion,
        )
        self.db.add(sesion)
        self.db.commit()
        self.db.refresh(sesion)
        return sesion

    def _verificar_credenciales(self, correo: str, contrasenia: str) -> Usuario:
        usuario = self.repo.obtener_por_correo(correo)
        if not usuario or not GestorAutenticacion.verificar_contrasenia(contrasenia, usuario.contrasenia):
            raise CredencialesInvalidas("Correo o contraseña incorrectos")
        # E01-RF013: una cuenta suspendida por el Administrador no puede
        # loguearse, aunque la contraseña sea correcta. Mismo tipo de
        # excepción que credenciales inválidas: no se revela si la cuenta
        # existe pero está inactiva vs. si la contraseña es incorrecta,
        # para no filtrar información de cuentas ajenas.
        if not usuario.activo:
            raise CredencialesInvalidas("Correo o contraseña incorrectos")
        # Baja lógica de la PERSONA: quien ya no es miembro del club no entra,
        # aunque su cuenta figure como activa. No es redundante con el chequeo
        # de arriba: dar de baja a una persona desactiva su `Usuario`, pero
        # reactivar la cuenta (`PATCH /personas/{id}/cuenta/estado`) es una
        # operación independiente que no reincorpora a nadie al club. Sin esta
        # línea, ese camino le devolvería el acceso a un ex-miembro.
        if not usuario.persona.activo:
            raise CredencialesInvalidas("Correo o contraseña incorrectos")
        return usuario

    def _penalizar_intento_fallido(self, clave: str) -> None:
        intentos = _INTENTOS_FALLIDOS_LOGIN.get(clave, 0) + 1
        _INTENTOS_FALLIDOS_LOGIN[clave] = intentos
        retraso = _calcular_retraso_login(intentos)
        if retraso:
            self._dormir(retraso)

    # --- Registro de usuario para una Persona ya existente -------------------
    def registrar_usuario(self, datos: RegistroUsuarioDTO) -> dict:
        """
        Crea el `Usuario` (credenciales) para una `Persona` que YA existe (dada
        de alta antes por un ADMINISTRADOR vía POST /personas). NO crea Persona.
        Sin roles asignados (coherente con la asignación perezosa de roles ya
        implementada, los roles se asignan por separado).

        Devuelve el mismo shape que `login()` (auto-login tras registro).
        """
        persona = self.repo_persona.obtener_por_cedula(datos.cedula)
        if not persona:
            raise EntidadNoEncontrada(
                "No existe una persona registrada con esa cédula. "
                "Contacte al administrador del club."
            )

        # Endpoint público: los dos casos comparten el mismo texto a propósito,
        # para no revelar si lo que ya estaba tomado era la cédula o el correo
        # (ver app/dominio/mensajes.py).
        if persona.usuario is not None:
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        if self.repo.obtener_por_correo(datos.correo) is not None:
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        hash_contrasenia = GestorAutenticacion.obtener_hash_contrasenia(datos.contrasenia)
        nuevo_usuario = Usuario(
            correo=datos.correo,
            contrasenia=hash_contrasenia,
            persona_id=persona.id,
        )
        nuevo_usuario = self.repo.crear(nuevo_usuario)
        return self._emitir_par_tokens(nuevo_usuario)

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
            raise OperacionInvalida("Formato de archivo no permitido. Use JPG o PNG")
        # La firma binaria real debe coincidir con el tipo declarado: el
        # Content-Type que manda el cliente no prueba nada sobre el
        # contenido real (decisión de diseño 2.3, sdd/production-readiness).
        if not es_firma_valida(contenido, content_type):
            raise OperacionInvalida(
                "El contenido del archivo no coincide con el formato declarado"
            )
        # Defensa en profundidad: el router ya acota la lectura vía
        # `leer_con_limite` antes de llegar acá.
        if len(contenido) > self.TAMANO_MAXIMO_FOTO_PERFIL_BYTES:
            raise OperacionInvalida("El archivo excede el tamaño máximo de 5MB")

        from app.infraestructura.cloudinary_cliente import subir_foto_perfil

        public_id = f"perfil_{usuario.persona_id}"
        # Issue #553 (Problema 2): la URL que devuelve el SDK al subir NO es una
        # URL de entrega válida (`type="authenticated"`). Se persiste el
        # `public_id` y la URL firmada se resuelve al serializar la respuesta
        # (`ActualizarFotoPerfilResponseDTO`, mismo patrón que el voucher).
        subir_foto_perfil(
            contenido=contenido,
            nombre_publico=public_id,
            content_type=content_type,
            persona_id=usuario.persona_id,
        )

        self.repo_persona.actualizar(usuario.persona, {"foto_url": public_id})
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

    # --- Refresh de access token a partir de un refresh token ---------------
    def refrescar_sesion(self, refresh_token: str) -> dict:
        """
        Valida que `refresh_token` sea un JWT de tipo `refresh` (no `access`) y
        emite un nuevo access token con los roles ACTUALES del usuario (por si
        cambiaron desde la emisión del refresh original).

        Limitación documentada (extensión futura): NO hay rotación de refresh
        tokens ni blacklist de tokens revocados. Es una simplificación aceptada
        para el alcance académico del proyecto. En producción se debería:
          1) rotar el refresh token en cada uso (refresh + access nuevos)
          2) mantener una blacklist (Redis) de refresh revocados para permitir
             invalidación real de sesión antes de los 7 días de vida del token.

        E01 -- invalidación de sesión (epoch compartido, ver `epoch_valido`):
        este método SÍ valida el `sver` del refresh token, y no es opcional.
        Sin este chequeo, un refresh token capturado junto al access token
        comprometido (viajan como cookies httpOnly hermanas, ver
        `_emitir_par_tokens`) seguía vivo hasta sus 7 días de vida y podía
        reemitir un access token nuevo, totalmente compatible con el epoch
        actual -- un bypass total de "cerrar mis otras sesiones", no un caso
        de borde. `decodificar_token` ya aplica la misma regla del lado
        access; esta es la otra mitad del par que cierra la ruta completa.
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

        roles_actuales = [rol.tipo_rol.value for rol in usuario.roles]
        claims = {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": roles_actuales}
        # `sid` se arrastra del refresh en vez de abrirse de nuevo: refrescar
        # es el mismo equipo continuando la misma sesión, no una sesión nueva.
        # Sin esto, el primer refresh dejaría al usuario sin poder reconocer su
        # propio equipo en la lista.
        sid = payload.get("sid")
        if sid is not None:
            claims["sid"] = sid
        access_token = GestorAutenticacion.crear_token_acceso(
            claims, version_sesion=usuario.version_sesion,
        )
        return {"access_token": access_token, "token_type": "bearer"}

    # --- E01: invalidación de sesión (primitiva compartida) -----------------
    def _bombear_epoch_sesion(self, correo: str) -> Usuario:
        """Bombea `version_sesion` del usuario autenticado (resuelto vía el
        `sub` del JWT) y persiste el cambio. NO reemite tokens -- eso queda a
        criterio de cada caller, ver `invalidar_otras_sesiones` (sí reemite)
        vs. `cerrar_sesion` (no reemite).

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
        return self._emitir_par_tokens(usuario, sesion_id=sesion.id)

    # --- TRA-10: POST /auth/logout -------------------------------------------
    def cerrar_sesion(self, correo: str) -> dict:
        """Bombea el epoch de sesión del caller y NO reemite tokens -- a
        diferencia de `invalidar_otras_sesiones`, acá el caller debe quedar
        deslogueado también. Reutiliza `_bombear_epoch_sesion` en vez de
        reusar `invalidar_otras_sesiones` completo: llamar a ese método acá
        generaría un par de tokens nuevo que este endpoint nunca devuelve
        (`LogoutResponseDTO` solo expone `mensaje`) -- trabajo de firma JWT
        desperdiciado, y semánticamente confuso (el docstring de ese método
        promete dejar al caller autenticado, justo lo contrario de un
        logout).
        """
        self._bombear_epoch_sesion(correo)
        return {"mensaje": "Sesión finalizada"}

    # --- Privado: emisión del par access + refresh -------------------------
    def _emitir_par_tokens(self, usuario: Usuario, sesion_id: int | None = None) -> dict:
        """`sesion_id` viaja como claim `sid` y es ADITIVO y OBSERVACIONAL.

        Nada lo valida y nada autoriza con él: sirve para que
        `GET /auth/me/sesiones` pueda decir cuál de las filas corresponde al
        equipo que está mirando la pantalla, que con varios equipos bajo el
        mismo epoch no se puede deducir de otra forma. Un token sin `sid` --
        los emitidos antes de este cambio, y los de `registrar_usuario`, que
        no abre sesión-- simplemente no marca ninguna como actual.

        Que sea opcional no es descuido: si `sid` fuera obligatorio para algo,
        habría dejado de ser observacional.
        """
        roles = [rol.tipo_rol.value for rol in usuario.roles]
        claims = {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": roles}
        # El refresh token no necesita roles (solo sirve para pedir un nuevo
        # access token; los roles se releyan del usuario en cada refresh).
        refresh_claims = {"sub": usuario.correo, "persona_id": usuario.persona_id}
        if sesion_id is not None:
            claims["sid"] = sesion_id
            # También en el refresh: sin esto, el primer refresh perdería la
            # identidad de la sesión y el equipo del usuario dejaría de
            # reconocerse a sí mismo en la lista.
            refresh_claims["sid"] = sesion_id

        access_token = GestorAutenticacion.crear_token_acceso(claims, version_sesion=usuario.version_sesion)
        refresh_token = GestorAutenticacion.crear_token_refresco(refresh_claims, version_sesion=usuario.version_sesion)
        return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}

    # --- Listado de sesiones propias ----------------------------------------
    def listar_sesiones(self, correo: str, sesion_actual_id: int | None) -> list[SesionVista]:
        """Las sesiones del usuario autenticado, la más reciente primero.

        `vigente` se DERIVA comparando el epoch de cada fila contra
        `usuario.version_sesion`. Es una lectura del mecanismo autoritativo, no
        una segunda fuente de verdad: por eso revocar no escribe acá, y por eso
        una fila nunca se actualiza ni se borra al morir.

        El corte en `LIMITE_SESIONES_LISTADAS` es de LECTURA. Cada login agrega
        una fila para siempre y la tarjeta del perfil muestra las últimas, no
        una bitácora de auditoría -- pero borrar el resto sería tirar historial
        para ahorrar en una consulta que ya está indexada.
        """
        usuario = self.obtener_usuario_actual(correo)
        filas = (
            self.db.query(Sesion)
            .filter(Sesion.usuario_id == usuario.id)
            .order_by(Sesion.iniciada_en.desc(), Sesion.id.desc())
            .limit(LIMITE_SESIONES_LISTADAS)
            .all()
        )
        return [
            SesionVista(
                id=fila.id,
                usuario_id=fila.usuario_id,
                dispositivo=fila.dispositivo,
                iniciada_en=fila.iniciada_en,
                vigente=fila.version_sesion == usuario.version_sesion,
                actual=sesion_actual_id is not None and fila.id == sesion_actual_id,
            )
            for fila in filas
        ]

    # --- E01-RF003: recuperación de contraseña -------------------------------
    def solicitar_recuperacion(self, correo: str) -> dict:
        """
        Deliberadamente NO revela si el correo existe o no (mismo mensaje de
        éxito en ambos casos) -- evita que este endpoint sirva para enumerar
        correos registrados. Si existe, dispara la tarea de Celery que
        realiza el envío (ver recuperacion_tareas.py).

        Hallazgo 6 (auditoría): si la publicación de la tarea falla, el
        endpoint NO responde el mensaje de éxito -- eso le mentiría al
        usuario legítimo, que se quedaría esperando un correo que jamás va
        a llegar. Se propaga un error de servicio genérico (503) cuyo texto
        no revela nada sobre la existencia del correo. Tradeoff aceptado:
        durante una caída del broker, un atacante que SEPA de la caída
        podría en teoría distinguir correos registrados (solo estos
        intentan encolar y por lo tanto solo estos fallan); mentirle al
        usuario legítimo es el peor de los dos fallos.
        """
        usuario = self.repo.obtener_por_correo(correo)
        if usuario:
            token = GestorAutenticacion.crear_token_recuperacion(
                correo, usuario.version_contrasenia
            )
            from app.infraestructura.tareas.recuperacion_tareas import enviar_enlace_recuperacion
            try:
                enviar_enlace_recuperacion.delay(correo, token)
            except Exception:
                _log.exception(
                    "No se pudo encolar la tarea de recuperación de contraseña"
                )
                raise ServicioNoDisponible(
                    "No se pudo procesar la solicitud. Intente nuevamente más tarde"
                )
        return {"mensaje": "Si el correo está registrado, se envió un enlace de recuperación"}

    def restablecer_contrasenia(self, token: str, nueva_contrasenia: str) -> None:
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

        usuario.contrasenia = GestorAutenticacion.obtener_hash_contrasenia(nueva_contrasenia)
        usuario.version_contrasenia += 1
        # Criterio unificado (issue #4): restablecer la contraseña RETIRA el
        # acceso previo. Quien restablece suele hacerlo porque sospecha que su
        # cuenta está comprometida: un access/refresh token robado no debe
        # sobrevivir al reset.
        usuario.revocar_sesiones()
        self.db.commit()
