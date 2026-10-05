"""Alta de entrenadores por el administrador (issue #1575).

Crea la `Persona` y una cuenta con el rol ENTRENADOR únicamente -- sin ficha
médica, plan, mensualidad ni categoría -- y encola la invitación por el outbox
de recuperación de contraseña (`AuthServicio._encolar_recuperacion`). Nadie
conoce la contraseña de la cuenta recién creada: queda con un hash de un valor
aleatorio que se descarta, y el entrenador la define con el enlace del correo
(ver `AuthServicio.restablecer_contrasenia`)."""
import logging
import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.enums import TipoRol
from app.dominio.excepciones import (
    EntidadDuplicada, EntidadNoEncontrada, OperacionInvalida, ServicioNoDisponible,
)
from app.dominio.invitacion_entrenador import invitacion_pendiente
from app.dominio.modelos import Persona, Usuario
from app.dominio.reglas_negocio import EDAD_MAYORIA_EDAD, calcular_edad
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.restricciones_identidad import identidad_en_conflicto
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.dtos.persona_schemas import EntrenadorCreateDTO
from app.soporte_transversal.tiempo import hoy_club

_log = logging.getLogger(__name__)

# Lo lee el administrador, no un visitante: puede decir qué chocó sin el
# problema de enumeración de `MENSAJE_IDENTIDAD_DUPLICADA` (público).
MENSAJE_ENTRENADOR_DUPLICADO = (
    "Ya existe una persona o una cuenta con esa cédula o ese correo. "
    "Búscala en Miembros; si es un jugador, puedes cambiarle el rol desde ahí."
)
MENSAJE_ENTRENADOR_MENOR = "El entrenador debe ser mayor de edad."
MENSAJE_SIN_INVITACION_PENDIENTE = (
    "Esta cuenta no tiene una invitación pendiente: el entrenador ya creó su contraseña."
)


class EntrenadorServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_rol = RolRepositorio(db)

    def crear(self, datos: EntrenadorCreateDTO) -> Persona:
        if calcular_edad(datos.fecha_nacimiento, hoy_club()) < EDAD_MAYORIA_EDAD:
            raise OperacionInvalida(MENSAJE_ENTRENADOR_MENOR)
        if (
            self.repo.obtener_por_cedula(datos.cedula) is not None
            or self.repo_usuario.obtener_por_correo(datos.correo) is not None
        ):
            raise EntidadDuplicada(MENSAJE_ENTRENADOR_DUPLICADO)

        try:
            persona = self.repo.crear(Persona(
                nombres=datos.nombres, apellidos=datos.apellidos, cedula=datos.cedula,
                fecha_nacimiento=datos.fecha_nacimiento, telefono=datos.telefono,
            ))
            usuario = self.repo_usuario.crear(Usuario(
                correo=datos.correo,
                contrasenia=GestorAutenticacion.obtener_hash_contrasenia(secrets.token_urlsafe(32)),
                persona_id=persona.id,
                correo_verificado=False,
                roles=[self.repo_rol.obtener_o_crear(TipoRol.ENTRENADOR)],
            ))
            AuthServicio(self.db)._encolar_recuperacion(usuario, respetar_enfriamiento=False)
            self.db.commit()
        except IntegrityError as error:
            # Carrera: dos altas casi simultáneas pasaron el pre-chequeo.
            self.db.rollback()
            if identidad_en_conflicto(error) is None:
                raise
            raise EntidadDuplicada(MENSAJE_ENTRENADOR_DUPLICADO) from error
        return persona

    def reenviar_invitacion(self, persona_id: int) -> None:
        usuario = self.repo_usuario.obtener_por_persona_id(persona_id)
        if usuario is None:
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no tiene una cuenta")
        if not invitacion_pendiente(usuario):
            raise OperacionInvalida(MENSAJE_SIN_INVITACION_PENDIENTE)
        AuthServicio(self.db)._encolar_recuperacion(usuario, respetar_enfriamiento=False)
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            _log.exception("No se pudo registrar el reenvío de la invitación")
            raise ServicioNoDisponible(
                "No se pudo procesar la solicitud. Intenta nuevamente más tarde"
            )
