from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.infraestructura.db import obtener_sesion
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.presentacion.schemas.persona_schemas import (
    FichaEmergenciaResponseDTO, FichaMedicaCreateDTO, FichaMedicaResponseDTO, FichaMedicaUpdateDTO,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.ficha_medica_servicio import FichaMedicaServicio
from app.servicios_negocio.gestor_permisos import GestorPermisos
from app.servicios_negocio.persona_servicio import _calcular_edad, EDAD_MAYORIA_EDAD
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

# El titular también entra sobre su PROPIA ficha, pero solo si es MAYOR DE
# EDAD: la ficha tiene un campo de enfermedades, y ahí puede haber algo que la
# familia todavía no habló con un hijo menor -- abrirla parejo se lo filtraría
# por la app. Un menor con cuenta propia sigue afuera; la gestiona su
# representante (el caso que ya cubre `PoliticaAccesoPersona` por el vínculo
# `representante_id`, sin este chequeo de edad).
#
# `PoliticaAccesoPersona.incluir_titular` es una regla COMPARTIDA con
# personas/asistencias/pagos y su default (True, sin condición de edad) no se
# toca acá -- cambiarle la semántica le cambiaría la regla a media
# aplicación. Este router resuelve la edad ACÁ, con el mismo dato
# (`EDAD_MAYORIA_EDAD`, `_calcular_edad`) que ya usa `PersonaServicio` y que
# reusan `asistencia_servicio.py`/`membresia_pago_servicio.py` para el mismo
# tipo de corte -- y sigue pasando `incluir_titular=False` a la política
# cuando no aplica. `incluir_titular=True` calculado acá reproduce
# exactamente lo que la política ya hacía por defecto para "es el dueño";
# el único caso nuevo es dueño + mayor de edad.
def _es_titular_mayor_de_edad(
    db: Session, *, persona_id_objetivo: int, persona_id_solicitante: int | None,
) -> bool:
    if persona_id_solicitante is None or persona_id_solicitante != persona_id_objetivo:
        return False
    persona = PersonaRepositorio(db).obtener_por_id(persona_id_objetivo)
    if persona is None:
        # Persona objetivo inexistente: cae al 403 de siempre, no acá. La
        # política vuelve a resolver esto mismo más abajo -- ver su propio
        # comentario sobre por qué "inexistente" y "no es mía" dan el mismo
        # 403 (no distinguirlos es la garantía anti-IDOR).
        return False
    return _calcular_edad(persona.fecha_nacimiento) >= EDAD_MAYORIA_EDAD


_MENSAJE_SIN_ACCESO = (
    "Solo un administrador, el representante de esta persona, o la propia "
    "persona (si es mayor de edad) pueden acceder a su ficha médica"
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
    """Lectura de la ficha médica: ADMINISTRADOR, el representante legal de
    esa persona, o la propia persona si es MAYOR DE EDAD. La identidad del
    solicitante sale del token verificado (`persona_id`), nunca del path."""
    persona_id_solicitante = token_payload.get("persona_id")
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=persona_id_solicitante,
        roles_solicitante=token_payload.get("roles"),
        incluir_titular=_es_titular_mayor_de_edad(
            db, persona_id_objetivo=persona_id, persona_id_solicitante=persona_id_solicitante,
        ),
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
    """Mismo criterio que la lectura: ADMINISTRADOR, el representante, o la
    propia persona si es mayor de edad."""
    persona_id_solicitante = token_payload.get("persona_id")
    PoliticaAccesoPersona(db).exigir_acceso(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=persona_id_solicitante,
        roles_solicitante=token_payload.get("roles"),
        incluir_titular=_es_titular_mayor_de_edad(
            db, persona_id_objetivo=persona_id, persona_id_solicitante=persona_id_solicitante,
        ),
        mensaje=_MENSAJE_SIN_ACCESO,
    )
    return FichaMedicaServicio(db).actualizar_por_persona(persona_id, datos)


# --- GET /persona/{persona_id}/emergencia -----------------------------------
# Issue #360. Endpoint PROPIO: no reusa `obtener_ficha_por_persona` ni su
# DTO. Esa lectura completa (arriba) es admin/representante/titular porque
# expone la ficha entera; esta es de ROL (ADMINISTRADOR o ENTRENADOR) porque
# el club no asigna entrenadores a horarios -- "los alumnos de este
# entrenador" no existe -- y lo que hay que acotar es el DATO expuesto
# (`FichaEmergenciaResponseDTO`, 7 campos enumerados a mano), no a qué
# alumnos puede pedírselo. Sin `PoliticaAccesoPersona` a propósito: esa
# política resuelve "es dueño o representante", que es la pregunta
# equivocada acá.
ROL_ADMIN_O_ENTRENADOR = ["ADMINISTRADOR", "ENTRENADOR"]


@router.get(
    "/persona/{persona_id}/emergencia",
    response_model=FichaEmergenciaResponseDTO,
)
async def obtener_ficha_emergencia(
    persona_id: int,
    db: Session = Depends(obtener_sesion),
    token_payload: dict = Depends(GestorPermisos(ROL_ADMIN_O_ENTRENADOR)),
):
    """Los cuatro datos de emergencia de un alumno más el respaldo de su
    representante legal -- pensado para que un entrenador pueda actuar
    durante un entrenamiento sin buscar a nadie en un directorio.

    Sin confirmación ni compuerta adicional a propósito (issue #360: "en una
    emergencia cada segundo cuenta y una compuerta extra es daño, no
    protección"). La protección es el registro posterior: cada consulta
    queda auditada en `ConsultaFichaEmergencia` con quién y cuándo.
    """
    consultante_persona_id = token_payload.get("persona_id")
    return FichaMedicaServicio(db).obtener_ficha_emergencia(
        persona_id, consultante_persona_id,
    )
