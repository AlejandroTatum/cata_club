"""Segundo guardián de un menor (issue #1666).

Decisiones del dueño (2026-10-05, ver `odd/tasks/1666-second-guardian.md`):
máximo dos guardianes por menor (el principal más uno); el principal invita
por correo y puede quitar al segundo, el administrador también; la invitación
CREA la cuenta cuando el correo no tiene una, con el enlace de fijar
contraseña de siempre; altas y bajas quedan auditadas en
`CoRepresentanteEvento`.

La autorización de invitar y quitar es la de `FIRMA_LEGAL` de
`PoliticaAccesoPersona` (solo el principal o un administrador): el segundo
guardián no administra guardianes.
"""
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.enums import TipoRol
from app.dominio.excepciones import (
    EntidadDuplicada, EntidadNoEncontrada, OperacionInvalida,
)
from app.dominio.modelos import (
    CoRepresentante, CoRepresentanteEvento, CoRepresentanteInvitacion, Persona, Usuario,
)
from app.dominio.reglas_negocio import EDAD_MAYORIA_EDAD, calcular_edad
from app.infraestructura.repositorios.co_representante_repositorio import CoRepresentanteRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.restricciones_identidad import identidad_en_conflicto
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.dtos.co_representante_schemas import (
    DatosInvitadoDTO, GuardianDeMenorDTO, MenorConGuardianesDTO,
)
from app.servicios_negocio.politica_acceso import AlcanceRepresentacion, PoliticaAccesoPersona
from app.soporte_transversal.tiempo import hoy_club

_log = logging.getLogger(__name__)

ROL_ADMINISTRADOR = "ADMINISTRADOR"

MENSAJE_SIN_PERMISO = (
    "Solo el representante principal de este menor o un administrador pueden "
    "agregar o quitar a su segundo representante"
)
MENSAJE_MENOR_COMPLETO = (
    "Este menor ya tiene dos representantes. Quita al segundo antes de invitar a otro."
)
MENSAJE_CUENTA_NO_REPRESENTANTE = (
    "Ese correo ya pertenece a una cuenta que no es de representante (administrador, "
    "entrenador o jugador). Usa otro correo para invitar a la persona."
)
MENSAJE_CUENTA_INACTIVA = "Esa cuenta está desactivada y no puede ser segundo representante."
MENSAJE_INVITADO_MENOR = "El segundo representante debe ser mayor de edad."
MENSAJE_INVITADO_ES_PRINCIPAL = "Esa persona ya es el representante principal de este menor."
MENSAJE_SIN_MENOR = "Persona con id {} no encontrada"
MENSAJE_SIN_REPRESENTANTE = "Solo se puede agregar un segundo representante a quien ya tiene un representante principal."
MENSAJE_DATOS_DUPLICADOS = (
    "Ya existe una persona o una cuenta con esa cédula o ese correo. "
    "Pídele a la persona que use el correo de su cuenta de representante."
)
MENSAJE_SIN_SEGUNDO = "Este menor no tiene segundo representante."


class ResultadoInvitacion:
    REQUIERE_DATOS = "REQUIERE_DATOS"
    INVITADO = "INVITADO"
    VINCULADO = "VINCULADO"


class CoRepresentanteServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = CoRepresentanteRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_rol = RolRepositorio(db)
        self.politica = PoliticaAccesoPersona(db)

    # --- Lectura: el tablero del representante ------------------------------
    def listar_mios(self, persona_id: int) -> list[MenorConGuardianesDTO]:
        """Menores de los que `persona_id` es guardián, con el segundo
        guardián de cada uno (solo visible para el principal)."""
        resultado = []
        for menor in self.repo_persona.listar_representados_accesibles(persona_id):
            es_principal = menor.representante_id == persona_id
            vinculo = self.repo.obtener_por_persona(menor.id)
            segundo = None
            if es_principal and vinculo is not None:
                cuenta = self.repo_usuario.obtener_por_persona_id(vinculo.co_representante_id)
                pendiente = any(
                    i.persona_id == menor.id
                    for i in self.repo.listar_pendientes_de_cuenta(vinculo.co_representante_id)
                )
                co = vinculo.co_representante
                segundo = GuardianDeMenorDTO(
                    persona_id=co.id, nombres=co.nombres, apellidos=co.apellidos,
                    correo=cuenta.correo if cuenta else None,
                    estado="PENDIENTE" if pendiente else "ACTIVO",
                )
            resultado.append(MenorConGuardianesDTO(
                persona_id=menor.id, nombres=menor.nombres, apellidos=menor.apellidos,
                rol="PRINCIPAL" if es_principal else "SEGUNDO",
                segundo_guardian=segundo, completo=vinculo is not None,
            ))
        return resultado

    # --- Invitar --------------------------------------------------------------
    def invitar(
        self, *, persona_ids: list[int], correo: str, datos: Optional[DatosInvitadoDTO],
        actor_persona_id: Optional[int], roles: list[str],
    ) -> tuple[str, list[int]]:
        """Agrega al guardián de `correo` como segundo guardián de cada
        `persona_ids`, todo o nada. Devuelve `(estado, persona_ids)`."""
        ids = list(dict.fromkeys(persona_ids))
        es_admin = ROL_ADMINISTRADOR in (roles or [])
        menores = [self._cargar_menor_autorizado(i, actor_persona_id, roles) for i in ids]
        cuenta = self.repo_usuario.obtener_por_correo(correo)
        if cuenta is not None:
            self._exigir_cuenta_elegible(cuenta)

        nuevos, reenvios = self._clasificar(menores, cuenta)
        if cuenta is None and datos is None:
            return ResultadoInvitacion.REQUIERE_DATOS, []

        origen = "ADMIN" if es_admin else "REPRESENTANTE"
        try:
            if cuenta is None:
                cuenta = self._crear_cuenta_invitada(correo, datos)
                crea_invitacion = True
            else:
                crea_invitacion = self._es_pendiente(cuenta)
            for menor in nuevos:
                self._vincular(menor, cuenta, actor_persona_id, origen, crea_invitacion=crea_invitacion)
            hay_pendiente = bool(self.repo.listar_pendientes_de_cuenta(cuenta.persona_id))
            if hay_pendiente and (nuevos or reenvios):
                AuthServicio(self.db)._encolar_recuperacion(cuenta, respetar_enfriamiento=False)
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            if identidad_en_conflicto(error) is not None:
                raise EntidadDuplicada(MENSAJE_DATOS_DUPLICADOS) from error
            raise OperacionInvalida(MENSAJE_MENOR_COMPLETO) from error
        except Exception:
            self.db.rollback()
            raise
        estado = ResultadoInvitacion.INVITADO if hay_pendiente else ResultadoInvitacion.VINCULADO
        return estado, [m.id for m in menores]

    def _clasificar(
        self, menores: list[Persona], cuenta: Optional[Usuario],
    ) -> tuple[list[Persona], list[Persona]]:
        """`(nuevos, reenvios)`: menores sin segundo guardián, y menores que ya
        lo tienen y es el mismo (reenvío idempotente). Cualquier otro caso
        rompe el tope de dos guardianes."""
        nuevos, reenvios = [], []
        for menor in menores:
            existente = self.repo.obtener_por_persona(menor.id)
            if existente is None:
                self._exigir_distinto_del_principal(menor, cuenta)
                nuevos.append(menor)
            elif cuenta is not None and existente.co_representante_id == cuenta.persona_id:
                reenvios.append(menor)
            else:
                raise OperacionInvalida(MENSAJE_MENOR_COMPLETO)
        return nuevos, reenvios

    def _es_pendiente(self, cuenta: Usuario) -> bool:
        return bool(self.repo.listar_pendientes_de_cuenta(cuenta.persona_id)) and not cuenta.correo_verificado

    def _cargar_menor_autorizado(
        self, persona_id: int, actor_persona_id: Optional[int], roles: list[str],
    ) -> Persona:
        """Autoriza ANTES de revelar nada (un extraño recibe 403 exista o no la
        persona; el administrador sí distingue el 404). El segundo guardián
        queda fuera: es `FIRMA_LEGAL`."""
        self.politica.exigir_acceso(
            persona_id_objetivo=persona_id,
            persona_id_solicitante=actor_persona_id,
            roles_solicitante=roles,
            incluir_titular=False,
            alcance=AlcanceRepresentacion.FIRMA_LEGAL,
            mensaje=MENSAJE_SIN_PERMISO,
        )
        persona = self.repo_persona.obtener_por_id_con_bloqueo(persona_id)
        if persona is None:
            raise EntidadNoEncontrada(MENSAJE_SIN_MENOR.format(persona_id))
        if persona.representante_id is None:
            raise OperacionInvalida(MENSAJE_SIN_REPRESENTANTE)
        return persona

    def _exigir_cuenta_elegible(self, cuenta: Usuario) -> None:
        if not any(rol.tipo_rol == TipoRol.REPRESENTANTE for rol in cuenta.roles):
            raise OperacionInvalida(MENSAJE_CUENTA_NO_REPRESENTANTE)
        if not cuenta.activo or not cuenta.persona.activo:
            raise OperacionInvalida(MENSAJE_CUENTA_INACTIVA)
        if calcular_edad(cuenta.persona.fecha_nacimiento, hoy_club()) < EDAD_MAYORIA_EDAD:
            raise OperacionInvalida(MENSAJE_INVITADO_MENOR)

    @staticmethod
    def _exigir_distinto_del_principal(menor: Persona, cuenta: Optional[Usuario]) -> None:
        if cuenta is not None and cuenta.persona_id in (menor.representante_id, menor.id):
            raise OperacionInvalida(MENSAJE_INVITADO_ES_PRINCIPAL)

    def _crear_cuenta_invitada(self, correo: str, datos: DatosInvitadoDTO) -> Usuario:
        """Persona + cuenta REPRESENTANTE sin verificar y con una contraseña
        que nadie conoce (mismo patrón que `EntrenadorServicio.crear`)."""
        if calcular_edad(datos.fecha_nacimiento, hoy_club()) < EDAD_MAYORIA_EDAD:
            raise OperacionInvalida(MENSAJE_INVITADO_MENOR)
        if self.repo_persona.obtener_por_cedula(datos.cedula) is not None:
            raise EntidadDuplicada(MENSAJE_DATOS_DUPLICADOS)
        persona = self.repo_persona.crear(Persona(
            nombres=datos.nombres, apellidos=datos.apellidos, cedula=datos.cedula,
            fecha_nacimiento=datos.fecha_nacimiento, telefono=datos.telefono,
        ))
        return self.repo_usuario.crear(Usuario(
            correo=correo,
            contrasenia=GestorAutenticacion.obtener_hash_contrasenia(secrets.token_urlsafe(32)),
            persona_id=persona.id,
            correo_verificado=False,
            roles=[self.repo_rol.obtener_o_crear(TipoRol.REPRESENTANTE)],
        ))

    def _vincular(
        self, menor: Persona, cuenta: Usuario, actor_persona_id: Optional[int], origen: str,
        *, crea_invitacion: bool,
    ) -> None:
        ahora = datetime.now(timezone.utc)
        invitacion_id = None
        if crea_invitacion:
            invitacion = self.repo.crear_invitacion(CoRepresentanteInvitacion(
                persona_id=menor.id, co_representante_id=cuenta.persona_id,
                correo=cuenta.correo, invitada_por_persona_id=actor_persona_id,
            ))
            invitacion_id = invitacion.id
            self._evento(menor.id, cuenta.persona_id, actor_persona_id, "INVITACION", origen, invitacion_id)
        self.repo.crear(CoRepresentante(
            persona_id=menor.id, co_representante_id=cuenta.persona_id,
            creado_por_persona_id=actor_persona_id, creado_en=ahora,
        ))
        self._evento(menor.id, cuenta.persona_id, actor_persona_id, "ALTA", origen, invitacion_id)

    def _evento(
        self, persona_id: int, co_id: Optional[int], actor_id: Optional[int],
        operacion: str, origen: str, invitacion_id: Optional[int] = None,
    ) -> None:
        self.repo.registrar_evento(CoRepresentanteEvento(
            persona_id=persona_id, co_representante_id=co_id, actor_persona_id=actor_id,
            operacion=operacion, origen=origen, invitacion_id=invitacion_id,
        ))

    # --- Aceptar (primer ingreso con el enlace de contraseña) ------------------
    def aceptar_invitaciones(self, cuenta: Usuario) -> None:
        """Marca aceptadas las invitaciones pendientes de `cuenta` (SIN
        commit: lo hace `AuthServicio.restablecer_contrasenia`, en la misma
        transacción que fija la contraseña)."""
        ahora = datetime.now(timezone.utc)
        for invitacion in self.repo.listar_pendientes_de_cuenta(cuenta.persona_id):
            invitacion.aceptada_en = ahora
            self._evento(
                invitacion.persona_id, cuenta.persona_id, cuenta.persona_id,
                "ACEPTACION", "INVITADO", invitacion.id,
            )
        self.db.flush()

    # --- Quitar ----------------------------------------------------------------
    def quitar(self, persona_id: int, actor_persona_id: Optional[int], roles: list[str]) -> None:
        """Retira al segundo guardián. El acceso se corta en el acto: el
        vínculo ES la autorización y cada petición lo lee de la base."""
        menor = self._cargar_menor_autorizado(persona_id, actor_persona_id, roles)
        vinculo = self.repo.obtener_por_persona(menor.id)
        if vinculo is None:
            raise EntidadNoEncontrada(MENSAJE_SIN_SEGUNDO)
        origen = "ADMIN" if ROL_ADMINISTRADOR in (roles or []) else "REPRESENTANTE"
        co_id = vinculo.co_representante_id
        ahora = datetime.now(timezone.utc)
        try:
            pendientes = self.repo.listar_pendientes_de_cuenta(co_id)
            for invitacion in pendientes:
                if invitacion.persona_id == menor.id:
                    self.repo.cancelar_pendiente(invitacion, ahora)
                    self._evento(menor.id, co_id, actor_persona_id, "INVITACION_CANCELADA", origen, invitacion.id)
            self.repo.eliminar(vinculo)
            self._evento(menor.id, co_id, actor_persona_id, "BAJA", origen)
            if pendientes and all(i.persona_id == menor.id for i in pendientes):
                # Sin invitaciones vivas: el enlace de contraseña ya enviado
                # deja de servir (single-use por versión de contraseña).
                cuenta = self.repo_usuario.obtener_por_persona_id(co_id)
                if cuenta is not None and not cuenta.correo_verificado:
                    cuenta.version_contrasenia += 1
            self.db.commit()
        except Exception:
            self.db.rollback()
            _log.exception("No se pudo quitar al segundo representante")
            raise
