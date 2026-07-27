import jwt
from sqlalchemy.orm import Session

from app.dominio.modelos import Usuario
from app.dominio.excepciones import (
    CredencialesInvalidas, EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida,
)
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.presentacion.schemas.auth_schemas import RegistroUsuarioDTO, ActualizarPerfilPropioDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.firma_archivos import es_firma_valida


class AuthServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = UsuarioRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)

    # --- Login ---------------------------------------------------------------
    def login(self, correo: str, contrasenia: str) -> dict:
        """
        Devuelve el shape estandarizado `{access_token, refresh_token, token_type}`
        para el auto-login tras autenticarse (y para reutilizarlo tras registro).
        """
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

        return self._emitir_par_tokens(usuario)

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

        if persona.usuario is not None:
            raise EntidadDuplicada("Esta persona ya tiene una cuenta registrada")

        if self.repo.obtener_por_correo(datos.correo) is not None:
            raise EntidadDuplicada("El correo ya está en uso por otra cuenta")

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
        url = subir_foto_perfil(
            contenido=contenido,
            nombre_publico=public_id,
            content_type=content_type,
            persona_id=usuario.persona_id,
        )

        self.repo_persona.actualizar(usuario.persona, {"foto_url": url})
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

        if not GestorAutenticacion.epoch_valido(payload.get("sver"), usuario):
            raise CredencialesInvalidas("Refresh token inválido o expirado")

        roles_actuales = [rol.tipo_rol.value for rol in usuario.roles]
        access_token = GestorAutenticacion.crear_token_acceso(
            {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": roles_actuales},
            version_sesion=usuario.version_sesion,
        )
        return {"access_token": access_token, "token_type": "bearer"}

    # --- E01: invalidación de sesión (POST /auth/sesiones/invalidar) --------
    def invalidar_otras_sesiones(self, correo: str) -> dict:
        """Bombea `version_sesion` del usuario autenticado (resuelto vía el
        `sub` del JWT, igual que el resto de operaciones self-service de esta
        clase) y le reemite un par de tokens nuevo EN LA MISMA respuesta.

        El bump del epoch invalida de inmediato TODO token previo -- access y
        refresh, ver `GestorAutenticacion.epoch_valido` -- incluido el que se
        usó para autenticar esta misma llamada. El re-issue es lo que
        convierte esto en "cerrar mis OTRAS sesiones" en vez de "cerrar
        también la mía": el caller sigue autenticado con el par nuevo, que ya
        lleva el `sver` vigente.
        """
        usuario = self.obtener_usuario_actual(correo)
        usuario.version_sesion += 1
        self.db.commit()
        self.db.refresh(usuario)
        return self._emitir_par_tokens(usuario)

    # --- Privado: emisión del par access + refresh -------------------------
    def _emitir_par_tokens(self, usuario: Usuario) -> dict:
        roles = [rol.tipo_rol.value for rol in usuario.roles]
        claims = {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": roles}
        access_token = GestorAutenticacion.crear_token_acceso(claims, version_sesion=usuario.version_sesion)
        # El refresh token no necesita roles (solo sirve para pedir un nuevo
        # access token; los roles se releyan del usuario en cada refresh).
        refresh_claims = {"sub": usuario.correo, "persona_id": usuario.persona_id}
        refresh_token = GestorAutenticacion.crear_token_refresco(refresh_claims, version_sesion=usuario.version_sesion)
        return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}

    # --- E01-RF003: recuperación de contraseña -------------------------------
    def solicitar_recuperacion(self, correo: str) -> dict:
        """
        Deliberadamente NO revela si el correo existe o no (mismo mensaje de
        éxito en ambos casos) -- evita que este endpoint sirva para enumerar
        correos registrados. Si existe, dispara la tarea de Celery que
        simula el envío (ver recuperacion_tareas.py).
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
                # Sin broker de Celery disponible (ej. entorno de tests): no
                # debe tumbar la request. El envío es "best effort" por diseño.
                pass
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

        usuario.contrasenia = GestorAutenticacion.obtener_hash_contrasenia(nueva_contrasenia)
        usuario.version_contrasenia += 1
        self.db.commit()
