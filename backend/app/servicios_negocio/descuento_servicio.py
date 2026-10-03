"""
Catálogo de descuentos (issue #11, modelo firmado §4).

Solo el CRUD del catálogo vive aquí. La APLICACIÓN de un descuento a un pago
(congelar el valor vigente, tope del 100 %, quién autorizó) es parte del
registro del pago y vive en `PagoServicio.registrar_pago`: aplicar un
descuento ES un atributo del hecho de pagar, no una operación del catálogo.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadNoEncontrada, NombreDuplicado, OperacionInvalida, RecursoEnUso
from app.dominio.nombres_catalogo import existe_nombre, normalizar_nombre
from app.dominio.modelos import Descuento
from app.infraestructura.repositorios.descuento_repositorio import DescuentoRepositorio
from app.servicios_negocio.dtos.descuento_schemas import DescuentoCreateDTO, DescuentoUpdateDTO

MENSAJE_DESCUENTO_AMBIGUO = (
    "El descuento debe definir exactamente uno: porcentaje o monto fijo"
)


class DescuentoEnUso(RecursoEnUso):
    """Se intentó eliminar un descuento que ya se usó (-> 409)."""


class DescuentoServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = DescuentoRepositorio(db)

    def _exigir_nombre_libre(self, nombre: str, excluir_id: Optional[int] = None) -> None:
        """QA3 ADM-11: sin duplicados por mayúsculas ni espacios (las tildes
        distinguen). El catálogo es chico, así que se compara en Python."""
        otros = [d.nombre for d in self.repo.listar() if d.id != excluir_id]
        if existe_nombre(nombre, otros):
            raise NombreDuplicado(f"Ya existe un descuento con el nombre '{nombre}'.")

    def crear(self, datos: DescuentoCreateDTO) -> Descuento:
        nombre = normalizar_nombre(datos.nombre)
        self._exigir_nombre_libre(nombre)
        resultado = self.repo.crear(Descuento(**{**datos.model_dump(), "nombre": nombre}))
        self.db.commit()
        return self._marcar_en_uso([resultado])[0]

    def _marcar_en_uso(self, descuentos: list[Descuento]) -> list[Descuento]:
        """Anota `en_uso` (atributo transitorio, no columna) para el DTO."""
        usados = self.repo.ids_en_uso([d.id for d in descuentos])
        for descuento in descuentos:
            descuento.en_uso = descuento.id in usados
        return descuentos

    def listar(self, skip: int = 0, limit: Optional[int] = None) -> list[Descuento]:
        return self._marcar_en_uso(self.repo.listar(skip=skip, limit=limit))

    def eliminar(self, descuento_id: int) -> None:
        """Borrado duro, solo de un descuento que nunca se usó. Si se usó, el
        camino es ocultarlo (`activo=False`)."""
        descuento = self._obtener_sin_marcar(descuento_id)
        if self.repo.ids_en_uso([descuento.id]):
            raise DescuentoEnUso(
                f"No se puede eliminar el descuento '{descuento.nombre}' porque ya se "
                "aplicó o se asignó. Puede ocultarlo para que deje de ofrecerse."
            )
        self.repo.eliminar(descuento)
        self.db.commit()

    def contar(self) -> int:
        return self.repo.contar()

    def _obtener_sin_marcar(self, descuento_id: int) -> Descuento:
        descuento = self.repo.obtener_por_id(descuento_id)
        if not descuento:
            raise EntidadNoEncontrada(f"Descuento con id {descuento_id} no encontrado")
        return descuento

    def obtener(self, descuento_id: int) -> Descuento:
        return self._marcar_en_uso([self._obtener_sin_marcar(descuento_id)])[0]

    def actualizar(self, descuento_id: int, datos: DescuentoUpdateDTO) -> Descuento:
        """Actualización parcial del catálogo (incluida la baja/alta suave
        vía `activo`). NUNCA toca `DescuentoAplicado`: las aplicaciones
        históricas conservan su valor congelado por diseño.

        La exclusividad porcentaje/monto se valida sobre el estado RESULTANTE
        antes de mutar la entidad, para no dejar una fila sucia en la sesión
        si el cambio es inválido."""
        descuento = self._obtener_sin_marcar(descuento_id)
        cambios = datos.model_dump(exclude_unset=True)

        if cambios.get("nombre"):
            cambios["nombre"] = normalizar_nombre(cambios["nombre"])
            self._exigir_nombre_libre(cambios["nombre"], excluir_id=descuento.id)

        porcentaje_final = cambios.get("porcentaje", descuento.porcentaje)
        monto_final = cambios.get("monto", descuento.monto)
        if (porcentaje_final is None) == (monto_final is None):
            raise OperacionInvalida(MENSAJE_DESCUENTO_AMBIGUO)

        for campo, valor in cambios.items():
            setattr(descuento, campo, valor)
        resultado = self.repo.guardar_cambios(descuento)
        self.db.commit()
        self._marcar_en_uso([resultado])
        return resultado
