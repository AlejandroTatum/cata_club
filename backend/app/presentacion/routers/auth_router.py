from typing import List

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.dtos.auth_schemas import (
    RegistroUsuarioDTO, RefreshTokenDTO, UsuarioMeResponseDTO, LogoutResponseDTO,
    SolicitarRecuperacionDTO, SolicitarRecuperacionResponseDTO, RestablecerContraseniaDTO,
    SolicitarVerificacionCorreoDTO, SolicitarVerificacionCorreoResponseDTO,
    ConfirmarVerificacionCorreoDTO,
    ActualizarPerfilPropioDTO, ActualizarPerfilPropioResponseDTO, ActualizarFotoPerfilResponseDTO,
    SesionResponseDTO,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.soporte_transversal.lectura_archivos import leer_con_limite
from app.soporte_transversal.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["Autenticación"])

# Issue #733: un username sin tope de longitud es lo que convertía a
# `POST /auth/login` en un vector de denegación de servicio sin autenticar
# -- se medió que un string de 100.006 caracteres era aceptado (401, no
# 422) y quedaba retenido para siempre como clave de
# `auth_servicio._INTENTOS_FALLIDOS_LOGIN`. 254 es el límite de RFC 5321
# §4.5.3.1.3 (Path length restriction) para una ruta de correo completa
# ("MAIL FROM"/"RCPT TO"), el mismo criterio que usa `EmailField` de Django
# por defecto: cualquier username más largo que eso es estructuralmente
# imposible como correo y se rechaza acá, en la capa de FORM, con un 422 --
# ANTES de convertirse en clave del dict y sin gastar ni un ciclo de
# `AuthServicio.login`. Esto tapa la vía más barata del DoS (strings
# gigantes) pero no alcanza solo: ver la cota del propio mapa en
# `auth_servicio.py` para la otra mitad (direcciones DISTINTAS de longitud
# válida, sin límite de cantidad).
LONGITUD_MAXIMA_USERNAME_LOGIN = 254


@router.post("/login")
@limiter.limit("60/minute")
async def login(
    request: Request,
    username: str = Form(..., max_length=LONGITUD_MAXIMA_USERNAME_LOGIN),
    password: str = Form(...),
    db: Session = Depends(obtener_sesion),
):
    # El user-agent alimenta SOLO el registro observacional de sesiones (ver
    # `AuthServicio._registrar_sesion`). No participa de la autenticación: un
    # cliente que no lo manda entra igual.
    #
    # `username`/`password` sueltos en vez de `OAuth2PasswordRequestForm`:
    # ese DTO de FastAPI no expone un tope de longitud configurable en
    # `username` (issue #733). Los campos `grant_type`/`scope`/`client_id`/
    # `client_secret` que trae esa clase nunca se leían acá, así que no se
    # pierde nada -- Swagger UI sigue pudiendo loguearse desde el botón
    # "Authorize" (`OAuth2PasswordBearer` en `gestor_auth.py`): manda esos
    # campos igual, FastAPI simplemente los ignora al no estar declarados.
    #
    # `run_in_threadpool`: el freno progresivo de login (TRA-4) hace un
    # `time.sleep` REAL dentro de `AuthServicio.login` cuando penaliza un
    # intento fallido (`_penalizar_intento_fallido`). Llamado directo desde
    # esta coroutine, ese sleep retiene el único hilo del event loop y
    # bloquea a TODO otro cliente -- ni siquiera `GET /health` respondía
    # mientras un intento penalizado dormía (issue #311). Correrlo en el
    # threadpool de FastAPI libera el event loop durante esos segundos.
    return await run_in_threadpool(
        AuthServicio(db).login,
        username, password, user_agent=request.headers.get("user-agent"),
    )


@router.post(
    "/registro",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(GestorPermisos(["ADMINISTRADOR"]))],
)
@limiter.limit("20/minute")
async def registro(request: Request, datos: RegistroUsuarioDTO, db: Session = Depends(obtener_sesion)):
    """
    Solo ADMINISTRADOR: crea el `Usuario` (credenciales) para una `Persona`
    que ya existe. Antes era público (sin auth) — ahora está protegido
    para que nadie pueda crear credenciales ajenas usando solo una cédula.
    """
    # `run_in_threadpool` (issue #826): `registrar_usuario` hashea la
    # contraseña con bcrypt (`GestorAutenticacion.obtener_hash_contrasenia` ->
    # `pwd_context.hash`), cientos de ms de CPU PURA. A diferencia del bloqueo por
    # red de `login`, acá no hay E/S que ceder: llamado directo desde esta
    # coroutine, ese cómputo retiene el único hilo del event loop de punta a
    # punta. El candado de `tests/test_bloqueo_del_event_loop.py` exige esta
    # forma para todo handler que alcance un hasheo o una subida.
    return await run_in_threadpool(AuthServicio(db).registrar_usuario, datos)


@router.get("/me", response_model=UsuarioMeResponseDTO)
async def obtener_perfil(
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    usuario = AuthServicio(db).obtener_usuario_actual(token_payload["sub"])
    return {
        "correo": usuario.correo,
        "persona_id": usuario.persona_id,
        "nombres": usuario.persona.nombres,
        "apellidos": usuario.persona.apellidos,
        "roles": [rol.tipo_rol.value for rol in usuario.roles],
        "telefono": usuario.persona.telefono,
        "fecha_creacion": usuario.fecha_creacion,
        "foto_url": usuario.persona.foto_url,
        "fecha_nacimiento": usuario.persona.fecha_nacimiento,
        "correo_verificado": usuario.correo_verificado,
        "alta_presencial_completada": GestorAutenticacion.alta_presencial_completada(
            db, usuario.persona_id,
        ),
        # Issue #940: la MISMA decisión que lleva el claim del token, para que
        # el frontend la consuma en vez de recomputarla de los dos hechos.
        "activacion_completa": GestorAutenticacion.puede_acceder_modulos(db, usuario),
    }


# --- Issue #36: perfil propio (self-service, cualquier rol autenticado) -----
@router.patch("/me", response_model=ActualizarPerfilPropioResponseDTO)
@limiter.limit("10/minute")
async def actualizar_perfil_propio(
    request: Request,
    cambios: ActualizarPerfilPropioDTO,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    """
    Self-service: el usuario autenticado edita SU PROPIO teléfono (correo no
    es editable aquí, ver `ActualizarPerfilPropioDTO`). Se resuelve la
    identidad vía el `sub` del JWT (no vía un persona_id de path param), de
    modo que un usuario nunca pueda editar el registro de otro. Distinto del
    edit-completo de ADMINISTRADOR (`PUT /personas/{id}`), que sigue
    existiendo sin cambios para cualquier persona.
    """
    return AuthServicio(db).actualizar_perfil_propio(token_payload["sub"], cambios)


# --- Issue foto de perfil: subida self-service, cualquier rol autenticado ---
@router.post("/me/foto", response_model=ActualizarFotoPerfilResponseDTO)
@limiter.limit("10/minute")
async def actualizar_foto_perfil(
    request: Request,
    archivo: UploadFile = File(...),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    """
    Self-service: el usuario autenticado sube/reemplaza SU PROPIA foto de
    perfil. Se resuelve la identidad vía el `sub` del JWT (no vía un
    persona_id de path param), igual que `PATCH /auth/me`, de modo que un
    usuario nunca pueda reemplazar la foto de otro.
    """
    contenido = await leer_con_limite(archivo, AuthServicio.TAMANO_MAXIMO_FOTO_PERFIL_BYTES)
    # `run_in_threadpool` (issue #826, mismo patrón que `subir_voucher` en
    # membresias_pagos_router.py, issue #450): `actualizar_foto_perfil` termina
    # en `cloudinary.uploader.upload`, SDK síncrono contra la red acotado por
    # `TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS` (8 s). Sin threadpool, una subida
    # lenta retiene el único hilo del event loop y ningún otro cliente es
    # atendido mientras tanto.
    return await run_in_threadpool(
        AuthServicio(db).actualizar_foto_perfil,
        correo_actual=token_payload["sub"],
        contenido=contenido,
        content_type=archivo.content_type,
    )


@router.get("/me/sesiones", response_model=List[SesionResponseDTO])
async def listar_mis_sesiones(
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    """
    Las sesiones del usuario AUTENTICADO. La identidad sale del `sub` del JWT,
    nunca de un path param, por el mismo motivo que `PATCH /auth/me`: así nadie
    puede leer el historial de otra cuenta.

    `sid` es opcional a propósito -- los tokens emitidos antes de que el claim
    existiera siguen siendo válidos y simplemente no marcan ninguna sesión como
    actual, en vez de fallar.
    """
    return AuthServicio(db).listar_sesiones(
        token_payload["sub"], sesion_actual_id=token_payload.get("sid"),
    )


@router.post("/refresh")
@limiter.limit("120/minute")
async def refrescar(request: Request, datos: RefreshTokenDTO, db: Session = Depends(obtener_sesion)):
    """
    Recibe un refresh token en el BODY (no en header Authorization, porque
    el refresh token no es un bearer token de autenticación general). Devuelve
    un nuevo access token válido con los roles actuales del usuario.
    """
    return AuthServicio(db).refrescar_sesion(datos.refresh_token)


@router.post("/sesiones/invalidar")
@limiter.limit("5/minute")
async def invalidar_sesiones(
    request: Request,
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    """
    E01 -- "cerrar mis otras sesiones": bombea el epoch (`version_sesion`) del
    usuario autenticado, invalidando de inmediato todo token previo (access Y
    refresh, ver `GestorAutenticacion.epoch_valido`) y reemitiendo un par
    nuevo en esta misma respuesta para que el CALLER permanezca autenticado
    (distinto de invalidar también su propia sesión actual).

    Ese par reemitido ES una sesión nueva para este equipo, así que se registra
    con su user-agent: sin eso el usuario tocaría el botón y vería una lista
    vacía, porque toda fila previa -- la suya incluida-- nació bajo el epoch
    que se acaba de bombear.
    """
    return AuthServicio(db).invalidar_otras_sesiones(
        token_payload["sub"], user_agent=request.headers.get("user-agent"),
    )


@router.post("/logout", response_model=LogoutResponseDTO)
async def logout(
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
    db: Session = Depends(obtener_sesion),
):
    """
    TRA-10: bombea `version_sesion` del usuario autenticado (mismo mecanismo
    que `/auth/sesiones/invalidar`, ver `AuthServicio.cerrar_sesion`), así
    que el access_token y el refresh_token usados para llamar a este
    endpoint dejan de servir de inmediato -- antes, un token robado seguía
    autenticando hasta su expiración natural (hasta 7 días en el caso del
    refresh) aunque el dueño legítimo hubiera "cerrado sesión". El cierre en
    el frontend (borrar las cookies httpOnly) sigue ocurriendo igual, esto
    cierra además el lado servidor.
    """
    return AuthServicio(db).cerrar_sesion(token_payload["sub"])


# --- E01-RF003: recuperación de contraseña -----------------------------------
@router.post("/recuperar-contrasenia", response_model=SolicitarRecuperacionResponseDTO)
@limiter.limit("10/minute")
async def solicitar_recuperacion(request: Request, datos: SolicitarRecuperacionDTO, db: Session = Depends(obtener_sesion)):
    return AuthServicio(db).solicitar_recuperacion(datos.correo)


@router.post("/restablecer-contrasenia", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("20/minute")
async def restablecer_contrasenia(request: Request, datos: RestablecerContraseniaDTO, db: Session = Depends(obtener_sesion)):
    # `run_in_threadpool` (issue #826): hashea la contraseña nueva con bcrypt,
    # el mismo bloqueo de CPU que `registro`. Este endpoint es PÚBLICO (quien
    # olvidó su clave puede no tener sesión), así que provocarlo no requiere
    # estar autenticado.
    await run_in_threadpool(
        AuthServicio(db).restablecer_contrasenia, datos.token, datos.nueva_contrasenia,
    )


# --- Issue #790: verificación de la dirección de correo ----------------------
# Públicos por el mismo motivo que la recuperación de contraseña: quien tiene
# que verificar su correo puede haber cerrado la sesión, haberla dejado vencer
# o estar abriendo el enlace desde otro dispositivo. Exigir token acá
# convertiría "no me llegó el correo" en un callejón sin salida.
#
# Ninguno de los dos revela si una dirección está registrada: el reenvío
# responde SIEMPRE `MENSAJE_VERIFICACION_ENVIADA` y la confirmación responde
# siempre lo mismo ante cualquier enlace que no sirva (ver `AuthServicio`).
# Mismo tier de rate limit que sus gemelos de recuperación.
@router.post(
    "/verificar-correo/reenviar", response_model=SolicitarVerificacionCorreoResponseDTO
)
@limiter.limit("10/minute")
async def reenviar_verificacion_correo(
    request: Request,
    datos: SolicitarVerificacionCorreoDTO,
    db: Session = Depends(obtener_sesion),
):
    return AuthServicio(db).solicitar_verificacion_correo(datos.correo)


@router.post("/verificar-correo", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("20/minute")
async def verificar_correo(
    request: Request,
    datos: ConfirmarVerificacionCorreoDTO,
    db: Session = Depends(obtener_sesion),
):
    AuthServicio(db).confirmar_verificacion_correo(datos.token)
