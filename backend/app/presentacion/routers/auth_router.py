from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.presentacion.schemas.auth_schemas import (
    RegistroUsuarioDTO, RefreshTokenDTO, UsuarioMeResponseDTO, LogoutResponseDTO,
    SolicitarRecuperacionDTO, SolicitarRecuperacionResponseDTO, RestablecerContraseniaDTO,
    ActualizarPerfilPropioDTO, ActualizarPerfilPropioResponseDTO, ActualizarFotoPerfilResponseDTO,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.soporte_transversal.lectura_archivos import leer_con_limite
from app.soporte_transversal.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["Autenticación"])


@router.post("/login")
@limiter.limit("60/minute")
async def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(obtener_sesion)):
    return AuthServicio(db).login(form.username, form.password)


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
    return AuthServicio(db).registrar_usuario(datos)


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
    return AuthServicio(db).actualizar_foto_perfil(
        correo_actual=token_payload["sub"],
        contenido=contenido,
        content_type=archivo.content_type,
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
    """
    return AuthServicio(db).invalidar_otras_sesiones(token_payload["sub"])


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
    AuthServicio(db).restablecer_contrasenia(datos.token, datos.nueva_contrasenia)
