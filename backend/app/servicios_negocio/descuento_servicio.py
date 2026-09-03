"""
Catálogo de descuentos (issue #11, modelo firmado §4).

Solo el CRUD del catálogo vive aquí. La APLICACIÓN de un descuento a un pago
(congelar el valor vigente, tope del 100 %, quién autorizó) es parte del
registro del pago y vive en `PagoServicio.registrar_pago`: aplicar un
descuento ES un atributo del hecho de pagar, no una operación del catálogo.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadDuplicada, EntidadNoEncontrada, OperacionInvalida
from app.dominio.modelos import Descuento
from app.infraestructura.repositorios.descuento_repositorio import DescuentoRepositorio
from app.servicios_negocio.dtos.descuento_schemas import DescuentoCreateDTO, DescuentoUpdateDTO

MENSAJE_DESCUENTO_AMBIGUO = (
    "El descuento debe definir exactamente uno: porcentaje o monto fijo"
)


class DescuentoServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = DescuentoRepositorio(db)

    def crear(self, datos: DescuentoCreateDTO) -> Descuento:
        if self.repo.obtener_por_nombre(datos.nombre):
            raise EntidadDuplicada(f"Ya existe un descuento con el nombre '{datos.nombre}'")
        resultado = self.repo.crear(Descuento(**datos.model_dump()))
        self.db.commit()
        return resultado

    def listar(self, skip: int = 0, limit: Optional[int] = None) -> list[Descuento]:
        return self.repo.listar(skip=skip, limit=limit)

    def contar(self) -> int:
        return self.repo.contar()

    def obtener(self, descuento_id: int) -> Descuento:
        descuento = self.repo.obtener_por_id(descuento_id)
        if not descuento:
            raise EntidadNoEncontrada(f"Descuento con id {descuento_id} no encontrado")
        return descuento

    def actualizar(self, descuento_id: int, datos: DescuentoUpdateDTO) -> Descuento:
        """Actualización parcial del catálogo (incluida la baja/alta suave
        vía `activo`). NUNCA toca `DescuentoAplicado`: las aplicaciones
        históricas conservan su valor congelado por diseño.

        La exclusividad porcentaje/monto se valida sobre el estado RESULTANTE
        antes de mutar la entidad, para no dejar una fila sucia en la sesión
        si el cambio es inválido."""
        descuento = self.obtener(descuento_id)
        cambios = datos.model_dump(exclude_unset=True)

        nombre_nuevo = cambios.get("nombre")
        if nombre_nuevo and nombre_nuevo != descuento.nombre:
            if self.repo.obtener_por_nombre(nombre_nuevo):
                raise EntidadDuplicada(f"Ya existe un descuento con el nombre '{nombre_nuevo}'")

        porcentaje_final = cambios.get("porcentaje", descuento.porcentaje)
        monto_final = cambios.get("monto", descuento.monto)
        if (porcentaje_final is None) == (monto_final is None):
            raise OperacionInvalida(MENSAJE_DESCUENTO_AMBIGUO)

        for campo, valor in cambios.items():
            setattr(descuento, campo, valor)
        resultado = self.repo.guardar_cambios(descuento)
        self.db.commit()
        return resultado
