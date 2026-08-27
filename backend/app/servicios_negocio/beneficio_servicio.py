"""
`BeneficioServicio` (issue #398): asignar y retirar el beneficio personal
(un descuento del catálogo concedido por el club a una persona, vigente
hasta que un admin lo retire). Deliberadamente NO resuelve el beneficio
contra un `Pago` -- eso es el issue #400/3c, fuera de alcance acá -- ni
expone ningún camino para que el propio beneficiario se lo asigne: el actor
(`persona_id_admin`) llega SIEMPRE como parámetro explícito, nunca leído
desde la entidad que se está modificando, así que el router es quien decide
de dónde sale (el token, nunca el cuerpo del request).

Concurrencia (mismo patrón que `MembresiaServicio.crear_membresia` /
`PagoServicio.registrar_pago`, issue #8): el pre-check de acá es el camino
primario de error (mensaje legible); el índice único parcial
`uq_asignacion_descuento_activa_por_persona` es la red de seguridad ante dos
asignaciones concurrentes que el pre-check no puede ver, porque corren en
transacciones separadas. Cuando la red atrapa, se traduce al MISMO error de
dominio que ya daría el pre-check -- nunca un `IntegrityError` crudo hasta
el cliente.
"""
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.dominio.modelos import AsignacionDescuento, Descuento
from app.infraestructura.repositorios.descuento_repositorio import (
    AsignacionDescuentoRepositorio, DescuentoRepositorio,
)
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.presentacion.schemas.beneficio_schemas import AsignacionDescuentoResponseDTO
from app.presentacion.schemas.descuento_schemas import DescuentoResponseDTO

MENSAJE_BENEFICIO_ACTIVO_DUPLICADO = (
    "Esta persona ya tiene un beneficio activo. Retírelo antes de "
    "asignar uno nuevo."
)


class BeneficioServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = AsignacionDescuentoRepositorio(db)
        self.repo_descuento = DescuentoRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        self.repo_membresia = MembresiaRepositorio(db)

    @staticmethod
    def _valor_potencial(descuento: Descuento, tarifa: Decimal) -> Decimal:
        """Cuánto valdría este descuento contra una tarifa mensual dada --
        misma fórmula que `PagoServicio._congelar_beneficio_activo` usa
        contra el monto base real de un pago (ver su docstring), pero sin
        ningún efecto de negocio: esto es una proyección para decidir si
        CONCEDER el beneficio (issue #665), no una aplicación congelada."""
        if descuento.porcentaje is not None:
            return (tarifa * descuento.porcentaje / Decimal("100")).quantize(Decimal("0.01"))
        return descuento.monto

    def obtener_activo(self, persona_id: int) -> AsignacionDescuento | None:
        """`None` es una respuesta VÁLIDA (persona sin beneficio vigente),
        no un error -- por eso 404 solo cuando la persona en sí no existe."""
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")
        return self.repo.obtener_activa_por_persona(persona_id)

    def asignar(
        self, persona_id: int, descuento_id: int, persona_id_admin: int,
    ) -> AsignacionDescuento:
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        descuento = self.repo_descuento.obtener_por_id(descuento_id)
        if not descuento:
            raise EntidadNoEncontrada(f"Descuento con id {descuento_id} no encontrado")
        # Un descuento inactivo es catálogo retirado del club: no puede
        # CONCEDERSE de nuevo, aunque -- por diseño, ver modelos.py -- sigue
        # sin afectar los beneficios ya concedidos con él (issue #398).
        if not descuento.activo:
            raise OperacionInvalida(
                f"El descuento '{descuento.nombre}' está inactivo y no puede asignarse"
            )

        if self.repo.obtener_activa_por_persona(persona_id) is not None:
            raise OperacionInvalida(MENSAJE_BENEFICIO_ACTIVO_DUPLICADO)

        # Issue #665: un beneficio no puede superar la tarifa mensual de la
        # persona. Solo se puede medir contra una tarifa REAL, y la única
        # garantizada única por persona es la membresía OPERATIVA (ACTIVA o
        # SUSPENDIDA, `uq_membresia_activa_por_persona` en modelos.py) --
        # sin eso no hay nada contra qué comparar (persona sin membresía, o
        # con una todavía INACTIVA esperando su primer pago), y el gate se
        # omite ahí a propósito: el chequeo de `PagoServicio.
        # _congelar_beneficio_activo` (`valor > monto_base`) sigue siendo la
        # red de seguridad para ese caso, igual que antes de este fix.
        membresia_operativa = self.repo_membresia.obtener_operativa_por_persona(persona_id)
        if membresia_operativa is not None:
            valor = self._valor_potencial(descuento, membresia_operativa.monto_aplicado)
            if valor > membresia_operativa.monto_aplicado:
                raise OperacionInvalida(
                    f"El beneficio '{descuento.nombre}' (${valor}) supera la "
                    f"tarifa mensual de la persona (${membresia_operativa.monto_aplicado}). "
                    "Asigne un descuento de menor valor o edítelo antes de concederlo."
                )

        asignacion = AsignacionDescuento(
            persona_id=persona_id,
            descuento_id=descuento_id,
            asignado_por_persona_id=persona_id_admin,
        )
        try:
            return self.repo.crear(asignacion)
        except IntegrityError as error:
            self.db.rollback()
            if "uq_asignacion_descuento_activa_por_persona" in str(error.orig):
                raise OperacionInvalida(MENSAJE_BENEFICIO_ACTIVO_DUPLICADO) from error
            raise

    def retirar(self, persona_id: int, persona_id_admin: int) -> AsignacionDescuento:
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        activa = self.repo.obtener_activa_por_persona(persona_id)
        if activa is None:
            raise EntidadNoEncontrada(
                f"La persona con id {persona_id} no tiene un beneficio activo para retirar"
            )

        activa.retirado_en = datetime.now(timezone.utc)
        activa.retirado_por_persona_id = persona_id_admin
        return self.repo.guardar_cambios(activa)

    def a_response_dto(self, asignacion: AsignacionDescuento) -> AsignacionDescuentoResponseDTO:
        """Punto único donde una `AsignacionDescuento` ORM se convierte en la
        respuesta HTTP, anidando el `Descuento` del catálogo (ver docstring
        de `AsignacionDescuentoResponseDTO` sobre por qué no hay relación
        ORM que lo resuelva solo)."""
        descuento = self.repo_descuento.obtener_por_id(asignacion.descuento_id)
        return AsignacionDescuentoResponseDTO(
            id=asignacion.id,
            persona_id=asignacion.persona_id,
            descuento=DescuentoResponseDTO.model_validate(descuento),
            asignado_por_persona_id=asignacion.asignado_por_persona_id,
            asignado_en=asignacion.asignado_en,
            retirado_por_persona_id=asignacion.retirado_por_persona_id,
            retirado_en=asignacion.retirado_en,
        )
