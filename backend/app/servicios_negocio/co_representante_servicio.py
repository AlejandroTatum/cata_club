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
    EntidadNoEncontrada, OperacionInvalida,
)
from app.dominio.modelos import (
    CoRepresentante, CoRepresentanteEvento, CoRepresentanteInvitacion, Persona, Usuario,
)
from app.dominio.nombre_propio import nombre_completo
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.dominio.reglas_negocio import EDAD_MAYORIA_EDAD, calcular_edad
from app.infraestructura.repositorios.co_representante_repositorio import CoRepresentanteRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.co_representante_vinculo import cancelar_invitacion, retirar_vinculo
from app.servicios_negocio.dtos.co_representante_schemas import (
    DatosInvitadoDTO, GuardianDeMenorDTO, InvitacionRecibidaDTO, MenorConGuardianesDTO,
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
    "Este menor ya tiene dos representantes o una invitación pendiente. "
    "Quita al segundo antes de invitar a otro."
)
MENSAJE_INVITADO_MENOR = "El segundo representante debe ser mayor de edad."
MENSAJE_INVITACION_NEUTRA = "Si el correo es válido, enviaremos la invitación."
MENSAJE_INVITACION_NO_ENCONTRADA = "No encontramos esa invitación."
MENSAJE_SIN_MENOR = "Persona con id {} no encontrada"
MENSAJE_SIN_REPRESENTANTE = "Solo se puede agregar un segundo representante a quien ya tiene un representante principal."
MENSAJE_SIN_SEGUNDO = "Este menor no tiene segundo representante ni invitación pendiente."


class _InvitacionDescartada(Exception):
    """Motivo de descarte hallado al crear la cuenta; se registra y se responde
    igual que cualquier otro descarte."""


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
        guardián de cada uno (solo visible para el principal). Mientras la
        invitación no se acepta, el principal ve SOLO el correo que escribió:
        ni nombre ni ningún dato de la cuenta invitada."""
        resultado = []
        for menor in self.repo_persona.listar_representados_accesibles(persona_id):
            es_principal = menor.representante_id == persona_id
            vinculo = self.repo.obtener_por_persona(menor.id)
            pendiente = self.repo.obtener_pendiente(menor.id)
            segundo = None
            if es_principal and pendiente is not None:
                segundo = GuardianDeMenorDTO(correo=pendiente.correo, estado="PENDIENTE")
            elif es_principal and vinculo is not None:
                co = vinculo.co_representante
                cuenta = self.repo_usuario.obtener_por_persona_id(co.id)
                segundo = GuardianDeMenorDTO(
                    persona_id=co.id, nombres=co.nombres, apellidos=co.apellidos,
                    correo=cuenta.correo if cuenta else None, estado="ACTIVO",
                )
            resultado.append(MenorConGuardianesDTO(
                persona_id=menor.id, nombres=menor.nombres, apellidos=menor.apellidos,
                rol="PRINCIPAL" if es_principal else "SEGUNDO",
                segundo_guardian=segundo,
                completo=vinculo is not None or pendiente is not None,
            ))
        return resultado

    def listar_invitaciones_recibidas(self, persona_id: int) -> list[InvitacionRecibidaDTO]:
        """Invitaciones de una cuenta EXISTENTE que esperan su aceptación.
        Antes de aceptar solo se ve el nombre de pila del menor y quién invita."""
        resultado = []
        for invitacion in self.repo.listar_pendientes_de_cuenta(persona_id):
            if self.repo.existe(invitacion.persona_id, persona_id):
                continue  # la creó una cuenta nueva: se acepta fijando la contraseña
            menor = self.repo_persona.obtener_por_id(invitacion.persona_id)
            invitante = self.repo_persona.obtener_por_id(invitacion.invitada_por_persona_id)
            if menor is None or invitante is None:
                continue
            resultado.append(InvitacionRecibidaDTO(
                id=invitacion.id, nombre_menor=menor.nombres,
                nombre_invitante=nombre_completo(invitante.nombres, invitante.apellidos),
            ))
        return resultado

    # --- Invitar --------------------------------------------------------------
    def invitar(
        self, *, persona_ids: list[int], correo: str, datos: DatosInvitadoDTO,
        actor_persona_id: Optional[int], roles: list[str],
    ) -> None:
        """Invita a `correo` como segundo guardián de cada `persona_ids`, todo o
        nada. NO devuelve nada que dependa del correo: el llamador responde
        siempre lo mismo (`MENSAJE_INVITACION_NEUTRA`), exista o no la cuenta,
        sea de otro rol o esté inactiva. El motivo real solo se registra en el
        log. Lo que SÍ se rechaza con error son cosas que el principal ya sabe
        (no es el principal, el menor ya tiene dos representantes).

        Una cuenta de representante ya existente NUNCA se vincula al instante:
        recibe una invitación pendiente y un aviso, y el vínculo nace cuando
        ella misma la acepta con su sesión (`aceptar_invitacion_recibida`)."""
        ids = list(dict.fromkeys(persona_ids))
        origen = "ADMIN" if ROL_ADMINISTRADOR in (roles or []) else "REPRESENTANTE"
        menores = [self._cargar_menor_autorizado(i, actor_persona_id, roles) for i in ids]
        if calcular_edad(datos.fecha_nacimiento, hoy_club()) < EDAD_MAYORIA_EDAD:
            # Se valida siempre, exista o no la cuenta: no depende del correo.
            raise OperacionInvalida(MENSAJE_INVITADO_MENOR)
        cuenta = self.repo_usuario.obtener_por_correo(correo)
        reenvio = cuenta is not None and self._es_reenvio(menores, cuenta)
        if not reenvio:
            for menor in menores:
                if self.repo.obtener_por_persona(menor.id) or self.repo.obtener_pendiente(menor.id):
                    raise OperacionInvalida(MENSAJE_MENOR_COMPLETO)
        motivo = self._motivo_no_elegible(cuenta, menores)
        if motivo is not None:
            _log.info("Invitación de segundo representante descartada: %s", motivo)
            return
        avisar = None
        try:
            avisar = self._aplicar_invitacion(
                menores, cuenta, correo, datos, actor_persona_id, origen, reenvio=reenvio,
            )
            self.db.commit()
        except (IntegrityError, _InvitacionDescartada) as error:
            self.db.rollback()
            _log.info("Invitación de segundo representante descartada: %s", error or "conflicto de unicidad")
            return
        except Exception:
            self.db.rollback()
            raise
        if avisar is not None:
            self._avisar_invitacion_pendiente(*avisar)

    def _aplicar_invitacion(
        self, menores: list[Persona], cuenta: Optional[Usuario], correo: str, datos: DatosInvitadoDTO,
        actor_persona_id: Optional[int], origen: str, *, reenvio: bool,
    ) -> Optional[tuple[str, str, str, str]]:
        """Escribe la invitación (sin commit). Devuelve los datos del aviso
        para una cuenta existente, o `None`."""
        if reenvio:
            AuthServicio(self.db)._encolar_recuperacion(cuenta, respetar_enfriamiento=False)
            return None
        crea_cuenta = cuenta is None
        if crea_cuenta:
            cuenta = self._crear_cuenta_invitada(correo, datos)
        for menor in menores:
            if crea_cuenta:
                self._invitar_menor(menor, cuenta, actor_persona_id, origen, vincula=True)
            elif origen == "ADMIN":
                self._vincular_directo(menor, cuenta, actor_persona_id, origen)
            else:
                self._invitar_menor(menor, cuenta, actor_persona_id, origen, vincula=False)
        if crea_cuenta:
            AuthServicio(self.db)._encolar_recuperacion(cuenta, respetar_enfriamiento=False)
            return None
        if origen == "ADMIN":
            return None
        invitante = self.repo_persona.obtener_por_id(actor_persona_id)
        return (
            cuenta.correo, cuenta.persona.nombres,
            " y ".join(m.nombres for m in menores),
            nombre_completo(invitante.nombres, invitante.apellidos) if invitante else "El club",
        )

    def _es_reenvio(self, menores: list[Persona], cuenta: Usuario) -> bool:
        """Mismo correo que el principal ya invitó y que aún no fijó contraseña:
        solo se reenvía el enlace (el principal ya ve ese correo en su tablero)."""
        if cuenta.correo_verificado:
            return False
        for menor in menores:
            vinculo = self.repo.obtener_por_persona(menor.id)
            if vinculo is None or vinculo.co_representante_id != cuenta.persona_id:
                return False
        return True

    def _vincular_directo(
        self, menor: Persona, cuenta: Usuario, actor_persona_id: Optional[int], origen: str,
    ) -> None:
        """Alta hecha por un administrador sobre una cuenta existente (sin cambios)."""
        self.repo.crear(CoRepresentante(
            persona_id=menor.id, co_representante_id=cuenta.persona_id,
            creado_por_persona_id=actor_persona_id, creado_en=datetime.now(timezone.utc),
        ))
        self._evento(menor.id, cuenta.persona_id, actor_persona_id, "ALTA", origen)

    def _motivo_no_elegible(self, cuenta: Optional[Usuario], menores: list[Persona]) -> Optional[str]:
        """Por qué NO se puede invitar a esta cuenta, o `None`. Solo para el log."""
        if cuenta is None:
            return None
        if not any(rol.tipo_rol == TipoRol.REPRESENTANTE for rol in cuenta.roles):
            return "la cuenta no es de representante"
        if not cuenta.activo or not cuenta.persona.activo:
            return "la cuenta está inactiva"
        # Un correo sin verificar solo sirve si es la cuenta que una invitación
        # previa creó y cuyo dueño aún no fijó la contraseña (el enlace de un
        # solo uso es la prueba); en otro caso no prueba quién controla la cuenta.
        if not cuenta.correo_verificado and not self.repo.listar_pendientes_de_cuenta(cuenta.persona_id):
            return "el correo de la cuenta no está verificado"
        if calcular_edad(cuenta.persona.fecha_nacimiento, hoy_club()) < EDAD_MAYORIA_EDAD:
            return "la persona invitada es menor de edad"
        if any(cuenta.persona_id in (m.representante_id, m.id) for m in menores):
            return "la persona invitada ya es el representante principal"
        return None

    def _invitar_menor(
        self, menor: Persona, cuenta: Usuario, actor_persona_id: Optional[int], origen: str,
        *, vincula: bool,
    ) -> None:
        """Invitación pendiente de `cuenta` para `menor`. Con `vincula` (cuenta
        creada por la invitación, que aún no tiene contraseña) el vínculo nace
        ya; sin él, solo cuando la cuenta acepte."""
        invitacion = self.repo.crear_invitacion(CoRepresentanteInvitacion(
            persona_id=menor.id, co_representante_id=cuenta.persona_id,
            correo=cuenta.correo, invitada_por_persona_id=actor_persona_id,
        ))
        self._evento(menor.id, cuenta.persona_id, actor_persona_id, "INVITACION", origen, invitacion.id)
        if vincula:
            self.repo.crear(CoRepresentante(
                persona_id=menor.id, co_representante_id=cuenta.persona_id,
                creado_por_persona_id=actor_persona_id, creado_en=datetime.now(timezone.utc),
            ))
            self._evento(menor.id, cuenta.persona_id, actor_persona_id, "ALTA", origen, invitacion.id)

    @staticmethod
    def _avisar_invitacion_pendiente(correo: str, nombre: str, menores: str, invitante: str) -> None:
        """Aviso sin enlace secreto: la invitación se acepta con la sesión de la
        propia cuenta. Best-effort: un fallo de correo no cambia la respuesta."""
        try:
            ServicioNotificaciones().enviar_aviso_invitacion_co_representante(
                correo, nombre, nombre_menor=menores, nombre_invitante=invitante,
            )
        except Exception:
            _log.warning("No se pudo enviar el aviso de invitación de segundo representante")

    # --- Aceptar una invitación recibida (cuenta existente) --------------------
    def aceptar_invitacion_recibida(self, invitacion_id: int, persona_id: int) -> None:
        """La cuenta invitada acepta con su propia sesión: ese es el
        consentimiento. Crea el vínculo si el menor sigue teniendo principal y
        lugar (máximo 2)."""
        invitacion = self.repo.obtener_invitacion(invitacion_id)
        if (
            invitacion is None or invitacion.co_representante_id != persona_id
            or invitacion.aceptada_en is not None or invitacion.cancelada_en is not None
        ):
            raise EntidadNoEncontrada(MENSAJE_INVITACION_NO_ENCONTRADA)
        menor = self.repo_persona.obtener_por_id_con_bloqueo(invitacion.persona_id)
        if (
            menor is None or menor.representante_id is None
            or menor.representante_id == persona_id
            or self.repo.obtener_por_persona(menor.id) is not None
        ):
            raise EntidadNoEncontrada(MENSAJE_INVITACION_NO_ENCONTRADA)
        try:
            invitacion.aceptada_en = datetime.now(timezone.utc)
            self._evento(menor.id, persona_id, persona_id, "ACEPTACION", "INVITADO", invitacion.id)
            self.repo.crear(CoRepresentante(
                persona_id=menor.id, co_representante_id=persona_id,
                creado_por_persona_id=invitacion.invitada_por_persona_id,
                creado_en=datetime.now(timezone.utc),
            ))
            self._evento(menor.id, persona_id, persona_id, "ALTA", "INVITADO", invitacion.id)
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise EntidadNoEncontrada(MENSAJE_INVITACION_NO_ENCONTRADA) from error

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

    def _crear_cuenta_invitada(self, correo: str, datos: DatosInvitadoDTO) -> Usuario:
        """Persona + cuenta REPRESENTANTE sin verificar y con una contraseña
        que nadie conoce (mismo patrón que `EntrenadorServicio.crear`)."""
        if calcular_edad(datos.fecha_nacimiento, hoy_club()) < EDAD_MAYORIA_EDAD:
            raise _InvitacionDescartada("la persona invitada es menor de edad")
        if self.repo_persona.obtener_por_cedula(datos.cedula) is not None:
            raise _InvitacionDescartada("la cédula ya existe")
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
        pendiente = self.repo.obtener_pendiente(menor.id)
        if vinculo is None and pendiente is None:
            raise EntidadNoEncontrada(MENSAJE_SIN_SEGUNDO)
        origen = "ADMIN" if ROL_ADMINISTRADOR in (roles or []) else "REPRESENTANTE"
        try:
            if vinculo is not None:
                retirar_vinculo(self.db, vinculo, actor_persona_id=actor_persona_id, origen=origen)
            else:
                cancelar_invitacion(self.db, pendiente, actor_persona_id=actor_persona_id, origen=origen)
            self.db.commit()
        except Exception:
            self.db.rollback()
            _log.exception("No se pudo quitar al segundo representante")
            raise
