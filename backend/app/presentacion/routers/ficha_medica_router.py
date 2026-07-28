from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.presentacion.schemas.persona_schemas import (
    FichaMedicaCreateDTO, FichaMedicaResponseDTO, FichaMedicaUpdateDTO,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.ficha_medica_servicio import FichaMedicaServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.politica_acceso import PoliticaAccesoPersona

router = APIRouter(prefix="/fichas-medicas", tags=["Ficha Médica"])

# Ficha médica = dato de salud sensible. El alta suelta por `persona_id` del
# payload (POST) sigue siendo herramienta de administración y queda en
# ADMINISTRADOR. La lectura y la corrección por persona, en cambio, ya no
# pueden ser admin-only: `PersonaServicio.crear_representado` escribe la ficha
# del menor con datos que declara su REPRESENTANTE en la inscripción, así que
# el tutor tiene que poder releer y corregir lo que él mismo cargó (una alergia
# nueva, un tipo de sangre mal tipeado). El vínculo se verifica DENTRO del
# handler con `PoliticaAccesoPersona` -- la misma regla única que ya usan
# personas/asistencias/pagos --, no con un rol, porque "REPRESENTANTE" a secas
# no dice DE QUIÉN.
ROL_ADMIN = ["ADMINISTRADOR"]

# `incluir_titular=False`: a diferencia del resto de los call sites, el propio
# interesado NO entra. Abrir la ficha de salud al titular es una decisión de
# producto aparte y todavía no tomada; encenderla luego es borrar este
# argumento. `roles_privilegiados` queda en el default (SOLO_ADMINISTRADOR):
# el ENTRENADOR no tiene por qué leer datos de salud.
_MENSAJE_SIN_ACCESO = (
    "Solo un administrador o el representante de esta persona pueden "
    "acceder a su ficha médica"
)


@router.post(
    "/",
    response_model=FichaMedicaResponseDTO,
    status_code=201,
    dependencies=[Depends(GestorPermisos(ROL_ADMIN))],
)
async def crear_ficha_medica(datos: FichaMedicaCreateDTO, db: Session = Depends(obtener_sesion)):
    return FichaMedicaServicio(db).crear_ficha_medica(datos)


@router.get(
    "/persona/{persona_id}",
    response_model=FichaMedicaResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def obtener_ficha_por_persona(
    persona_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    """Lectura de la ficha médica: ADMINISTRADOR, o el representante legal de
    esa persona. La identidad del solicitante sale del token verificado
    (`persona_id`), nunca del path."""
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles"),
        incluir_titular=False,
        mensaje=_MENSAJE_SIN_ACCESO,
    )
    return FichaMedicaServicio(db).obtener_por_persona(persona_id)


# Antes solo se podía crear una vez; no había forma de corregir un tipo de
# sangre mal registrado o actualizar la lista de enfermedades. El PATCH hace
# upsert (`FichaMedicaServicio.actualizar_por_persona`), así que también es el
# alta para un representado que todavía no tiene ficha.
@router.patch(
    "/persona/{persona_id}",
    response_model=FichaMedicaResponseDTO,
    dependencies=[Depends(GestorAutenticacion.decodificar_token)],
)
async def actualizar_ficha_medica(
    persona_id: int,
    datos: FichaMedicaUpdateDTO,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorAutenticacion.decodificar_token),
):
    """Mismo criterio que la lectura: ADMINISTRADOR o el representante."""
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=token_payload.get("persona_id"),
        roles_solicitante=token_payload.get("roles"),
        incluir_titular=False,
        mensaje=_MENSAJE_SIN_ACCESO,
    )
    return FichaMedicaServicio(db).actualizar_por_persona(persona_id, datos)
