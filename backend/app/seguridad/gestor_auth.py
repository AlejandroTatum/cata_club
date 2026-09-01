from datetime import datetime, timedelta, timezone
from typing import Optional, TYPE_CHECKING

import jwt
from passlib.context import CryptContext
from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.soporte_transversal.configuracion import settings
from app.dominio.enums import EstadoMembresia, TipoRol
from app.dominio.excepciones import CredencialesInvalidas, PermisosInsuficientes
from app.dominio.modelos import HistorialEstadoMembresia, Membresia
from app.infraestructura.db import obtener_sesion
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio

if TYPE_CHECKING:
    from app.dominio.modelos import Usuario

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


class GestorAutenticacion:
    """Encapsula el hashing de contraseñas y la emisión/validación de JWT."""

    @staticmethod
    def alta_presencial_completada(db: Session, persona_id: int) -> bool:
        """Deriva el hito histórico de la primera membresía ACTIVA.

        No usa el estado operativo actual como única fuente: una membresía
        VENCIDA o SUSPENDIDA ya demuestra que estuvo activa, y las
        transiciones históricas hacia ACTIVA conservan el hecho aunque la
        fila hoy tenga otro estado. Una INACTIVA sola nunca habilita.
        """
        estado_habilitante = (
            EstadoMembresia.ACTIVA,
            EstadoMembresia.VENCIDA,
            EstadoMembresia.SUSPENDIDA,
        )
        if db.query(Membresia.id).filter(
            Membresia.persona_id == persona_id,
            Membresia.estado.in_(estado_habilitante),
        ).first() is not None:
            return True

        return db.query(HistorialEstadoMembresia.id).join(
            Membresia, Membresia.id == HistorialEstadoMembresia.membresia_id,
        ).filter(
            Membresia.persona_id == persona_id,
            or_(
                HistorialEstadoMembresia.estado_nuevo == EstadoMembresia.ACTIVA,
                HistorialEstadoMembresia.estado_anterior == EstadoMembresia.ACTIVA,
            ),
        ).first() is not None

    @staticmethod
    def puede_acceder_modulos(db: Session, usuario: "Usuario") -> bool:
        """Aplica el gate solo a cuentas públicas, nunca a admin/trainer."""
        roles = {rol.tipo_rol for rol in usuario.roles}
        if TipoRol.ADMINISTRADOR in roles or TipoRol.ENTRENADOR in roles:
            return True
        return usuario.correo_verificado and GestorAutenticacion.alta_presencial_completada(
            db, usuario.persona_id,
        )

    @staticmethod
    def obtener_hash_contrasenia(contrasenia: str) -> str:
        return pwd_context.hash(contrasenia)

    @staticmethod
    def verificar_contrasenia(contrasenia_plana: str, contrasenia_hash: str) -> bool:
        return pwd_context.verify(contrasenia_plana, contrasenia_hash)

    @staticmethod
    def crear_token_acceso(datos: dict, version_sesion: int, expiracion_minutos: Optional[int] = None) -> str:
        """`version_sesion` es OBLIGATORIO (sin default) a propósito, igual que
        `version_contrasenia` en `crear_token_recuperacion`: así ningún call
        site puede emitir un token "olvidando" el claim `sver` en silencio.
        En este slice el claim se emite pero nada lo valida todavía (ver
        `GestorAutenticacion.epoch_valido`, cableado en un slice posterior)."""
        payload = datos.copy()
        # El claim `type` distingue un access token de un refresh token;
        # el endpoint /auth/refresh valida que lo que recibe sea `type=refresh`.
        payload["type"] = "access"
        payload["sver"] = version_sesion
        expira = datetime.now(timezone.utc) + timedelta(
            minutes=expiracion_minutos or settings.jwt_expira_minutos
        )
        payload.update({"exp": expira})
        return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algoritmo)

    @staticmethod
    def crear_token_refresco(datos: dict, version_sesion: int) -> str:
        """Emite un refresh token (vida larga, type=refresh). Sirve únicamente
        para pedir un nuevo access token vía /auth/refresh; NO se usa para
        autenticar requests a endpoints de negocio (eso requiere access token).

        `version_sesion` obligatorio por el mismo motivo que en
        `crear_token_acceso`: el claim `sver` debe viajar en AMBOS tokens del
        par para que la invalidación de sesión pueda cerrar también el lado
        refresh (ver nota de `epoch_valido`)."""
        payload = datos.copy()
        payload["type"] = "refresh"
        payload["sver"] = version_sesion
        expira = datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_expira_dias)
        payload.update({"exp": expira})
        return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algoritmo)

    # --- E01-RF003: recuperación de contraseña -------------------------------
    @staticmethod
    def crear_token_recuperacion(correo: str, version_contrasenia: int, expiracion_minutos: int = 30) -> str:
        """Token de un solo propósito (`type=reset_password`), corta duración
        (30 min por defecto). Incluye la versión actual de la contraseña para
        invalidar el token tras un restablecimiento exitoso (single-use)."""
        payload = {
            "sub": correo,
            "type": "reset_password",
            "ver": version_contrasenia,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=expiracion_minutos),
        }
        return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algoritmo)

    @staticmethod
    def decodificar_token_recuperacion(token: str) -> dict:
        """Devuelve el payload {sub, ver} si el token es válido y de tipo
        reset_password. La comparación contra la versión actual de la
        contraseña del usuario se hace en el servicio, para invalidar tokens
        reutilizados (single-use) tras un restablecimiento exitoso."""
        try:
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
        except jwt.PyJWTError:
            raise CredencialesInvalidas("El enlace de recuperación es inválido o expiró")
        if payload.get("type") != "reset_password":
            raise CredencialesInvalidas("El enlace de recuperación es inválido o expiró")
        return payload

    # --- Issue #790: verificación de la dirección de correo -----------------
    # Cuarto valor del claim `type`, junto a `access`, `refresh` y
    # `reset_password`. La disciplina es la misma y por el mismo motivo: todos
    # los tokens del sistema van firmados con la MISMA clave, así que `type`
    # es lo único que impide que un enlace que viaja por correo -- y que puede
    # quedar en el historial de un cliente de mail, en un proxy o en una
    # captura -- sirva como credencial de autenticación. `decodificar_token`
    # exige `type == "access"`, de modo que este token queda excluido de ahí
    # sin necesidad de tocar esa función; lo que falta es el lado simétrico,
    # que es el que aporta `decodificar_token_verificacion_correo`.
    VERIFICACION_CORREO_EXPIRA_HORAS = 24

    @staticmethod
    def crear_token_verificacion_correo(
        correo: str, expiracion_horas: int | None = None
    ) -> str:
        """Token de un solo propósito (`type=verify_email`).

        Dura más que el de recuperación (24 h contra 30 min) porque cubre otra
        situación: quien restablece su contraseña está sentado frente a la
        pantalla esperando el correo, mientras que quien se inscribe en el club
        puede abrir el enlace recién esa noche, desde otro dispositivo.

        No lleva claim de versión, a diferencia de `crear_token_recuperacion`.
        No hace falta: el único efecto de este token es marcar verificada la
        dirección que él mismo nombra, así que reusarlo no puede conceder nada
        que la primera vez no hubiera concedido ya. Y si la cuenta cambia de
        dirección, el `sub` deja de resolver a ninguna cuenta y el token muere
        solo."""
        horas = expiracion_horas or GestorAutenticacion.VERIFICACION_CORREO_EXPIRA_HORAS
        payload = {
            "sub": correo,
            "type": "verify_email",
            "exp": datetime.now(timezone.utc) + timedelta(hours=horas),
        }
        return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algoritmo)

    @staticmethod
    def decodificar_token_verificacion_correo(token: str) -> dict:
        """Devuelve el payload si el token es válido y de tipo `verify_email`.

        Un access token, un refresh token o un token de recuperación llegan
        acá con firma perfectamente válida: es este chequeo de `type` --
        y solo este -- lo que impide que cualquiera de ellos marque verificada
        una dirección que su portador nunca leyó."""
        try:
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
        except jwt.PyJWTError:
            raise CredencialesInvalidas("El enlace de verificación es inválido o expiró")
        if payload.get("type") != "verify_email":
            raise CredencialesInvalidas("El enlace de verificación es inválido o expiró")
        return payload

    # --- E01: invalidación de sesión (epoch compartido access + refresh) ----
    @staticmethod
    def epoch_valido(sver_claim: Optional[int], usuario: "Usuario") -> bool:
        """Función pura: ÚNICO lugar del sistema que puede honrar el epoch de
        sesión de un token, para que ambas rutas (access vía
        `decodificar_token` y refresh vía `AuthServicio.refrescar_sesion`)
        compartan exactamente la misma regla en vez de reimplementarla cada
        una por su lado -- dos copias de "qué hace vigente a un token" es
        justo el tipo de duplicación que reintroduce este bug en el próximo
        refactor.

        `sver_claim is None` es INVÁLIDO, no equivalente a `1`: aceptarlo
        dejaría sobrevivir cualquier token (access o refresh) emitido antes
        de este cambio hasta su expiración natural -- hasta 7 días en el
        caso del refresh -- derrotando la invalidación en silencio.
        """
        return sver_claim is not None and sver_claim == usuario.version_sesion

    @staticmethod
    def sesion_vigente(sver_claim: Optional[int], usuario: "Usuario") -> bool:
        """Regla COMPLETA de vigencia de una sesión: compone el epoch
        (`epoch_valido`, que se mantiene puro y sin cambios) con el estado de
        la cuenta (`usuario.activo`). Un token con `sver` vigente pero de una
        cuenta desactivada NO es una sesión vigente: sin este chequeo, un
        usuario suspendido conservaba acceso hasta la expiración natural de
        sus tokens.

        Misma filosofía que `epoch_valido`: ÚNICO lugar del sistema que puede
        decidir si una sesión sigue viva. AMBAS rutas de token (access vía
        `decodificar_token` y refresh vía `AuthServicio.refrescar_sesion`)
        deben llamar a ESTE método, nunca componer las dos condiciones por su
        lado -- dos copias de la regla es justo la bifurcación que reintroduce
        este bug en el próximo refactor."""
        return usuario.activo and GestorAutenticacion.epoch_valido(sver_claim, usuario)

    @staticmethod
    def decodificar_token(
        request: Request,
        token: str = Depends(oauth2_scheme),
        db: Session = Depends(obtener_sesion),
    ) -> dict:
        """Dependencia de autenticación general: exige un ACCESS token.

        La verificación de `type` no es decorativa. Todos los tokens del
        sistema van firmados con la misma clave, así que sin este chequeo
        `jwt.decode` aceptaba por igual un refresh token (vida de 7 días) y
        un token de recuperación de contraseña (que viaja por correo) como
        credencial de autenticación para cualquier endpoint que solo exija
        estar autenticado.

        El caso del token de recuperación era el peor: usarlo como bearer no
        incrementa `version_contrasenia`, así que un enlace interceptado daba
        acceso de lectura al perfil sin dejar ninguna señal para la víctima.

        `/auth/refresh` ya hacía la verificación simétrica (rechaza lo que no
        sea `type=refresh`); esto cierra el otro lado del par.

        El parámetro `db` es nuevo (E01: invalidación de sesión). Esta
        dependencia YA estaba acoplada a FastAPI (`Depends(oauth2_scheme)`),
        así que no pierde pureza por esto; el callable en sí no cambia de
        identidad (sigue siendo `GestorAutenticacion.decodificar_token`), así
        que los ~55 `Depends(...)` que la referencian en toda la app -- y los
        overrides de `conftest.py` -- no requieren ningún cambio.
        """
        try:
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
        except jwt.PyJWTError:
            raise CredencialesInvalidas("Token inválido o expirado")
        if payload.get("type") != "access":
            raise CredencialesInvalidas("Token inválido o expirado")
        usuario = UsuarioRepositorio(db).obtener_por_correo(payload.get("sub"))
        if not usuario or not GestorAutenticacion.sesion_vigente(payload.get("sver"), usuario):
            raise CredencialesInvalidas("Token inválido o expirado")

        # `/auth/me` is the deliberately limited status surface for pending
        # accounts; logout must remain available so the user can leave it.
        # Carve-out de autoservicio de seguridad (#858): listar las propias
        # sesiones e invalidar las OTRAS son superficies propio-via-`sub` al
        # nivel de logout (test_guardia_autorizacion_rutas.py, balde 2) -- la
        # identidad sale del `sub` del JWT, así que un pendiente solo toca SU
        # epoch: son justo el botón con el que protege una cuenta recién
        # creada. Los módulos del club siguen bloqueados.
        # Carve-out de auto-servicio familiar (#790): el gate de #858 bloquea
        # los módulos del club, pero el router de `/personas` ya impone sus
        # propios checks granulares de ownership/verificación -- la familia
        # que se autoinscribió no puede quedar varada sin ver a su propio
        # representado ni completar la vinculación tras verificar.
        ruta = request.url.path.rstrip("/")
        es_superficie_limitada = (
            ruta.endswith("/auth/me")
            or ruta.endswith("/auth/logout")
            or ruta.endswith("/auth/me/sesiones")
            or ruta.endswith("/auth/sesiones/invalidar")
            or ruta.startswith("/api/v1/personas")
        )
        if not es_superficie_limitada and not GestorAutenticacion.puede_acceder_modulos(db, usuario):
            raise PermisosInsuficientes(
                "Su cuenta aún no está habilitada para acceder a este módulo.",
            )
        return payload
