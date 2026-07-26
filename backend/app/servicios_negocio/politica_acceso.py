"""
Política de acceso a los datos de una Persona.

Regla única del negocio: los datos de una persona los puede ver (o accionar)
la propia persona, su representante legal, o un rol del staff con mandato
para hacerlo. Estaba escrita a mano en seis lugares distintos --
`MembresiaServicio.listar_membresias_por_persona`,
`MembresiaServicio.obtener_membresia`, `PagoServicio.registrar_pago`,
`PagoServicio.listar_pagos_de_persona`, `PagoServicio.adjuntar_voucher`, y
tres chequeos inline en `personas_router` -- y esa duplicación es
exactamente la razón por la que cinco endpoints hermanos quedaron sin
ningún chequeo: al agregarlos, no había un solo lugar del que acordarse.

Este módulo es ese lugar. No cambia el criterio: lo centraliza.
"""
from sqlalchemy.orm import Session

from app.dominio.excepciones import PermisosInsuficientes
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio

ROL_ADMINISTRADOR = "ADMINISTRADOR"
ROL_ENTRENADOR = "ENTRENADOR"

#: Solo el Administrador pasa por encima del vínculo dueño/representante.
#: Es el valor por defecto: lo más restrictivo que sigue siendo operable.
SOLO_ADMINISTRADOR = (ROL_ADMINISTRADOR,)

#: El Entrenador también, para lo que necesita en su operación diaria
#: (roster, horarios, ranking). Ya era el criterio de `listar_representados`
#: y de `GET /ranking/{persona_id}/perfil`.
ADMINISTRADOR_O_ENTRENADOR = (ROL_ADMINISTRADOR, ROL_ENTRENADOR)


class PoliticaAccesoPersona:
    """Resuelve "¿este solicitante puede tocar los datos de esta persona?"."""

    def __init__(self, db: Session):
        self._repo_persona = PersonaRepositorio(db)

    def puede_acceder(
        self,
        *,
        persona_id_objetivo: int,
        persona_id_solicitante: int | None,
        roles_solicitante: list[str] | None,
        roles_privilegiados: tuple[str, ...] = SOLO_ADMINISTRADOR,
        incluir_representante_propio: bool = False,
    ) -> bool:
        """
        El orden de evaluación no es casual y se conserva del código original:
        primero rol privilegiado, después dueño, y SOLO al final se consulta
        la Persona objetivo en la base para resolver el vínculo de
        representación. Así, un solicitante sin ningún vínculo real nunca
        provoca una lectura que permita distinguir "persona inexistente" de
        "persona que no es mía" -- ambos casos terminan en el mismo 403.

        `incluir_representante_propio` habilita el sentido INVERSO del
        vínculo: que el representado pueda leer la ficha de SU representante.
        Va apagado por defecto y se enciende solo en `GET /personas/{id}`,
        donde el portal del alumno necesita mostrar quién es su tutor (ver
        `frontend/src/app/api/student/route.ts`). No se activa en asistencia
        ni en pagos a propósito: que un menor vea el nombre de su tutor es
        parte de su propia ficha; que vea los pagos o la asistencia del
        tutor, no.
        """
        roles = roles_solicitante or []
        if any(rol in roles_privilegiados for rol in roles):
            return True

        if persona_id_solicitante is None:
            return False

        if persona_id_solicitante == persona_id_objetivo:
            return True

        persona_objetivo = self._repo_persona.obtener_por_id(persona_id_objetivo)
        if persona_objetivo is None:
            return False

        if persona_objetivo.representante_id == persona_id_solicitante:
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
