"""
Política de acceso a los datos de una Persona.

Regla única del negocio: los datos de una persona los puede ver (o accionar)
la propia persona, su representante legal, o un rol del staff con mandato
para hacerlo. Estaba escrita a mano en cada call site, y esa duplicación es
exactamente la razón por la que varios endpoints hermanos quedaron sin
ningún chequeo: al agregarlos, no había un solo lugar del que acordarse
(issue #457).

Este módulo es ese lugar. No cambia el criterio: lo centraliza. Hoy lo usan,
vía `exigir_acceso`/`exigir_acceso_directo`, los routers `personas_router`,
`asistencias_router` y `ficha_medica_router`; y vía `puede_acceder`,
`MembresiaServicio.obtener_membresia`,
`MembresiaServicio.listar_membresias_por_persona`,
`PagoServicio.obtener_pago`, `PagoServicio.registrar_pago`,
`PagoServicio.listar_pagos_de_persona` y `PagoServicio.adjuntar_voucher`
en `membresia_pago_servicio.py` (issue #830, que terminó de migrar estos
últimos cuatro).

Issue #1666 (segundo guardián): "representante" pasó a significar DOS
vínculos -- el principal y el segundo guardián --, y `AlcanceRepresentacion`
dice cuáles entran en cada call site. Esa es la única definición: ningún
endpoint compara `representante_id` por su cuenta.
"""
from enum import Enum

from sqlalchemy.orm import Session

from app.dominio.excepciones import PermisosInsuficientes
from app.dominio.modelos import Persona
from app.infraestructura.repositorios.co_representante_repositorio import CoRepresentanteRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio

class AlcanceRepresentacion(Enum):
    """Qué guardianes pasan la rama de representación (issue #1666).

    `GENERAL`: el representante principal Y el segundo guardián -- ver,
    pagar, subir comprobantes, editar datos generales.

    `FIRMA_LEGAL`: SOLO el principal. Es lo que firma o edita la ficha médica
    y los consentimientos legales: el segundo guardián únicamente los VE
    (decisión del dueño, 2026-10-05). Todo call site que escribe un dato
    médico o legal del representado debe pasar este alcance."""

    GENERAL = "general"
    FIRMA_LEGAL = "firma_legal"


ROL_ADMINISTRADOR = "ADMINISTRADOR"
ROL_ENTRENADOR = "ENTRENADOR"

#: Solo el Administrador pasa por encima del vínculo dueño/representante.
#: Es el valor por defecto: lo más restrictivo que sigue siendo operable.
SOLO_ADMINISTRADOR = (ROL_ADMINISTRADOR,)

#: El Entrenador también, para lo que necesita en su operación diaria
#: (roster, horarios). Ya era el criterio de `listar_representados`.
ADMINISTRADOR_O_ENTRENADOR = (ROL_ADMINISTRADOR, ROL_ENTRENADOR)


class PoliticaAccesoPersona:
    """Resuelve "¿este solicitante puede tocar los datos de esta persona?"."""

    def __init__(self, db: Session):
        self._repo_persona = PersonaRepositorio(db)
        self._repo_co_representante = CoRepresentanteRepositorio(db)

    def es_guardian(
        self,
        persona_objetivo: Persona,
        persona_id_solicitante: int | None,
        alcance: AlcanceRepresentacion = AlcanceRepresentacion.GENERAL,
    ) -> bool:
        """ÚNICA definición de "es guardián de" (issue #1666): el
        representante principal (`Persona.representante_id`) o, solo con
        alcance `GENERAL`, el segundo guardián vigente.

        No incluye al propio titular ni a ningún rol: es solo la rama de
        representación, para los call sites que ya resolvieron el resto (o
        que no admiten titular ni admin, p. ej. inscribir a un representado).
        El vínculo se lee en el momento de la petición, así que retirar al
        segundo guardián corta su acceso en la siguiente llamada."""
        if persona_id_solicitante is None:
            return False
        if persona_objetivo.representante_id == persona_id_solicitante:
            return True
        if alcance is AlcanceRepresentacion.FIRMA_LEGAL:
            return False
        return self._repo_co_representante.existe(persona_objetivo.id, persona_id_solicitante)

    def puede_acceder(
        self,
        *,
        persona_id_objetivo: int,
        persona_id_solicitante: int | None,
        roles_solicitante: list[str] | None,
        roles_privilegiados: tuple[str, ...] = SOLO_ADMINISTRADOR,
        incluir_representante_propio: bool = False,
        incluir_titular: bool = True,
        alcance: AlcanceRepresentacion = AlcanceRepresentacion.GENERAL,
    ) -> bool:
        """
        El orden de evaluación no es casual y se conserva del código original:
        primero rol privilegiado, después dueño, y SOLO al final se consulta
        la Persona objetivo en la base para resolver el vínculo de
        representación. Así, un solicitante sin ningún vínculo real nunca
        provoca una lectura que permita distinguir "persona inexistente" de
        "persona que no es mía" -- ambos casos terminan en el mismo 403.

        `incluir_titular` apaga la rama del dueño: el propio interesado deja
        de pasar y queda SOLO el rol privilegiado o el representante. Va
        encendido por defecto porque es el criterio de todos los call sites
        previos; se apaga en la ficha médica (`GET`/`PATCH
        /fichas-medicas/persona/{id}`), donde abrir el dato de salud al propio
        titular es una decisión de producto todavía no tomada. Volver a
        abrirla es borrar el `incluir_titular=False` de ese router.

        `incluir_representante_propio` habilita el sentido INVERSO del
        vínculo: que el representado pueda leer la ficha de SU representante.
        Va apagado por defecto y se enciende solo en `GET /personas/{id}`,
        donde el portal del alumno necesita mostrar quién es su tutor (ver
        `frontend/src/app/api/student/route.ts`). No se activa en asistencia
        ni en pagos a propósito: que un menor vea el nombre de su tutor es
        parte de su propia ficha; que vea los pagos o la asistencia del
        tutor, no.

        `alcance` decide cuáles guardianes entran por la rama de
        representación: `GENERAL` (default) admite al principal y al segundo
        guardián; `FIRMA_LEGAL` solo al principal. El segundo guardián no
        tiene sentido inverso (`incluir_representante_propio` sigue siendo del
        principal).
        """
        roles = roles_solicitante or []
        if any(rol in roles_privilegiados for rol in roles):
            return True

        if persona_id_solicitante is None:
            return False

        if incluir_titular and persona_id_solicitante == persona_id_objetivo:
            return True

        persona_objetivo = self._repo_persona.obtener_por_id(persona_id_objetivo)
        if persona_objetivo is None:
            return False

        if self.es_guardian(persona_objetivo, persona_id_solicitante, alcance):
            return True

        if incluir_representante_propio:
            solicitante = self._repo_persona.obtener_por_id(persona_id_solicitante)
            return bool(
                solicitante and solicitante.representante_id == persona_id_objetivo
            )

        return False

    def exigir_acceso(
        self,
        *,
        persona_id_objetivo: int,
        persona_id_solicitante: int | None,
        roles_solicitante: list[str] | None,
        roles_privilegiados: tuple[str, ...] = SOLO_ADMINISTRADOR,
        incluir_representante_propio: bool = False,
        incluir_titular: bool = True,
        alcance: AlcanceRepresentacion = AlcanceRepresentacion.GENERAL,
        mensaje: str = (
            "Solo la propia persona, su representante, o un administrador "
            "pueden acceder a estos datos"
        ),
    ) -> None:
        """Igual que `puede_acceder`, pero lanza la excepción de dominio que
        `main.py` traduce a 403. Es la forma que usan los routers y servicios:
        el caso feliz no necesita rama."""
        if not self.puede_acceder(
            persona_id_objetivo=persona_id_objetivo,
            persona_id_solicitante=persona_id_solicitante,
            roles_solicitante=roles_solicitante,
            roles_privilegiados=roles_privilegiados,
            incluir_representante_propio=incluir_representante_propio,
            incluir_titular=incluir_titular,
            alcance=alcance,
        ):
            raise PermisosInsuficientes(mensaje)

    # --- Regla más estrecha: sin la rama de representación -------------------
    def exigir_acceso_directo(
        self,
        *,
        persona_id_objetivo: int,
        persona_id_solicitante: int | None,
        roles_solicitante: list[str] | None,
        roles_privilegiados: tuple[str, ...] = SOLO_ADMINISTRADOR,
        mensaje: str = "Permisos insuficientes para esta operación",
    ) -> None:
        """Solo el propio titular o un rol privilegiado; el representante NO
        entra.

        Existe como regla aparte, y no como un booleano de `exigir_acceso`,
        porque son dos decisiones de negocio distintas y conviene que el
        call site diga cuál eligió. Aplica a las acciones que se ejercen
        sobre la propia cuenta -- dar de alta un representado, independizarse
        del representante --: dejar que un representante las ejecute sobre
        un tercero ampliaría permisos en vez de restringirlos.
        """
        roles = roles_solicitante or []
        es_privilegiado = any(rol in roles_privilegiados for rol in roles)
        es_titular = (
            persona_id_solicitante is not None
            and persona_id_solicitante == persona_id_objetivo
        )
        if not (es_titular or es_privilegiado):
            raise PermisosInsuficientes(mensaje)
