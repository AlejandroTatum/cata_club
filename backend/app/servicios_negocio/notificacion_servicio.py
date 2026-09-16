"""
Servicio de notificaciones in-app.

Extraído de `ranking_servicio.py`: las notificaciones son genéricas (avisos
de vencimiento de membresía, pagos aprobados/rechazados, nuevas
inscripciones — ver `alertas_tareas.py` y `TipoNotificacion`), no una
funcionalidad del ranking competitivo. Compartían módulo solo por historia
de implementación; con el ranking eliminado por completo, quedan en su
propio servicio.
"""
from types import SimpleNamespace
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.dominio.modelos import Notificacion
from app.dominio.excepciones import EntidadNoEncontrada, PermisosInsuficientes
from app.dominio.nombre_propio import nombre_completo
from app.infraestructura.repositorios.notificacion_repositorio import NotificacionRepositorio


# Ancho del fragmento decorativo -- un nombre de persona -- que otros
# servicios anteponen a un mensaje de notificación (ej. "Para <nombre>:
# <mensaje>", "Nuevo alumno inscrito: <nombre> ..."). Un nombre no tiene tope
# real: apellidos compuestos, partículas ("de la", "van der"), varios nombres
# de pila pueden superar largamente lo que hace falta para identificar a
# alguien en un aviso (hallazgo en vivo, 2026-08-11: un nombre + apellido
# real empujó un aviso de vinculación a 372 caracteres). Acortarlo ACÁ, en la
# parte que solo identifica, es lo que le deja lugar de sobra al contenido
# que sí importa -- el motivo de un rechazo, el detalle de una alerta -- sin
# depender de que la columna de la base crezca al ritmo de cualquier nombre
# real. Ver `Notificacion.MENSAJE_MAX` (modelos.py) para el último resorte
# que cubre lo que esto no previno.
LIMITE_NOMBRE_EN_NOTIFICACION = 60


def acortar_nombre_para_notificacion(
    nombre: str, limite: int = LIMITE_NOMBRE_EN_NOTIFICACION
) -> str:
    """Acorta un nombre de persona antes de insertarlo en el texto de una
    notificación, preservando el resto del mensaje intacto."""
    if len(nombre) <= limite:
        return nombre
    return nombre[: limite - 1].rstrip() + "…"


class NotificacionServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = NotificacionRepositorio(db)

    def listar_propias(
        self, persona_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> tuple[list[Notificacion], int]:
        items = self.repo.listar_por_persona(persona_id, skip=skip, limit=limit)
        total = self.repo.contar_por_persona(persona_id)
        return items, total

    def _listar_dependientes_activos(self, persona_id: int) -> list:
        """Dependientes ACTIVOS de `persona_id` -- extraído para que
        `_resolver_ids_autorizados` y `listar_para_persona_y_hijos` (que
        además necesita nombres, no solo ids) consulten una sola vez y nunca
        puedan divergir sobre a quién representa `persona_id`.

        Baja lógica: los dependientes salen de
        `PersonaRepositorio.listar_representados`, que filtra por `activo`, y
        NO de la relación ORM `persona.representados`, que no se puede
        filtrar. Es el mismo criterio operativo que el resto de los listados:
        el feed alimenta el portal del representante, y ahí un dependiente
        dado de baja ya no aparece en ningún lado -- dejar sus notificaciones
        colgadas para siempre sería la única traza de alguien que el sistema
        dice que ya no está.
        """
        from app.infraestructura.repositorios.persona_repositorio import (
            PersonaRepositorio,
        )
        return PersonaRepositorio(self.db).listar_representados(persona_id)

    def _resolver_ids_autorizados(self, persona_id: int) -> list[int]:
        """Persona propia + sus dependientes ACTIVOS -- el mismo alcance que
        ve el feed paginado del representante. Extraído para que
        `listar_para_persona_y_hijos` y `marcar_todas_leidas` (issue #859)
        nunca puedan divergir sobre a quién representa `persona_id`."""
        from app.dominio.modelos import Persona
        persona = self.db.get(Persona, persona_id)
        if not persona:
            return []
        hijos_ids = [h.id for h in self._listar_dependientes_activos(persona_id)]
        return [persona_id] + hijos_ids

    def listar_para_persona_y_hijos(
        self, persona_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> tuple[list[Notificacion], int]:
        """Para representantes: incluye notificaciones propias y de sus
        hijos. Desde el #1227 cada fila SIEMPRE pertenece a su titular real
        (nunca hay una copia escrita para el representante -- ver
        `MembresiaPagoServicio._crear_notificacion`), así que acá, al leer,
        se antepone "Para <nombre acortado>: " al `mensaje` de toda fila cuyo
        `persona_id` no sea el de quien pide el feed. Un solo query resuelve
        los nombres de los dependientes (nunca uno por fila -- `contar_
        selects` en `conftest.py` lo mide)."""
        from app.dominio.modelos import Persona
        persona = self.db.get(Persona, persona_id)
        if not persona:
            return [], 0
        hijos = self._listar_dependientes_activos(persona_id)
        nombres_hijos = {
            h.id: nombre_completo(h.nombres, h.apellidos) for h in hijos
        }
        todos_ids = [persona_id] + list(nombres_hijos.keys())
        query = (
            self.db.query(Notificacion)
            .filter(Notificacion.persona_id.in_(todos_ids))
            .order_by(Notificacion.fecha_creacion.desc(), Notificacion.id.desc())
            .offset(skip)
        )
        if limit is not None:
            query = query.limit(limit)
        items = query.all()
        total = (
            self.db.query(func.count(Notificacion.id))
            .filter(Notificacion.persona_id.in_(todos_ids))
            .scalar()
        )
        items = [
            self._con_prefijo_si_es_de_un_hijo(item, persona_id, nombres_hijos)
            for item in items
        ]
        return items, total

    @staticmethod
    def _con_prefijo_si_es_de_un_hijo(
        item: Notificacion, persona_id: int, nombres_hijos: dict[int, str]
    ) -> Notificacion | SimpleNamespace:
        """Devuelve `item` sin tocar si es propia de `persona_id`, o una
        vista de solo lectura con `mensaje` prefijado si es de un hijo.

        Nunca muta `item.mensaje` en el lugar: es una instancia mapeada del
        ORM, viva en el identity map de la sesión -- mutarla filtraría el
        prefijo hacia cualquier otra lectura de la MISMA fila dentro de la
        misma sesión (ej. el propio feed del hijo, si comparte sesión con el
        del representante, como en los tests). `SimpleNamespace` expone los
        mismos campos que `NotificacionResponseDTO` (`from_attributes=True`
        los lee por atributo, no le importa si el objeto es ORM o no) sin
        crear una segunda fila ni tocar la persistida."""
        if item.persona_id == persona_id:
            return item
        nombre = acortar_nombre_para_notificacion(nombres_hijos[item.persona_id])
        return SimpleNamespace(
            id=item.id,
            tipo=item.tipo,
            mensaje=f"Para {nombre}: {item.mensaje}",
            leida=item.leida,
            fecha_creacion=item.fecha_creacion,
            entidad_relacionada_id=item.entidad_relacionada_id,
        )

    def marcar_todas_leidas(self, persona_id: int) -> int:
        """Marca como leídas TODAS las notificaciones pendientes que
        `persona_id` está autorizado a ver -- las propias y, si tiene
        dependientes, las de sus dependientes activos (issue #859). El
        alcance se resuelve acá, en el backend, con el mismo criterio que
        `listar_para_persona_y_hijos`: nunca a partir de ids que mande el
        cliente."""
        ids_autorizados = self._resolver_ids_autorizados(persona_id)
        if not ids_autorizados:
            return 0
        actualizadas = self.repo.marcar_todas_leidas(ids_autorizados)
        self.db.commit()
        return actualizadas

    def marcar_leida(self, notificacion_id: int, persona_id: int) -> Notificacion:
        notificacion = self.db.get(Notificacion, notificacion_id)
        if notificacion is None:
            raise EntidadNoEncontrada(f"Notificación con id {notificacion_id} no encontrada")
        if notificacion.persona_id != persona_id:
            raise PermisosInsuficientes("No puede marcar como leída una notificación ajena")
        resultado = self.repo.marcar_leida(notificacion)
        self.db.commit()
        return resultado
