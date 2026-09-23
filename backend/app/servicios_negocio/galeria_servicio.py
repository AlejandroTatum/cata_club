"""Administración de la galería pública de la landing (issue #1372)."""
from uuid import uuid4

from sqlalchemy import inspect as inspeccionar_orm
from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.dominio.modelos import EntradaGaleria
from app.infraestructura.cloudinary_cliente import eliminar_imagen_galeria, subir_imagen_galeria
from app.infraestructura.repositorios.galeria_repositorio import GaleriaRepositorio
from app.servicios_negocio.dtos.galeria_schemas import EntradaGaleriaCreateDTO
from app.soporte_transversal.firma_archivos import es_firma_valida


class GaleriaServicio:
    TAMANO_MAXIMO_IMAGEN_BYTES = 5 * 1024 * 1024

    def __init__(self, db: Session):
        self.db = db
        self.repo = GaleriaRepositorio(db)

    def listar(self) -> list[EntradaGaleria]:
        return self.repo.listar()

    def crear(self, datos: EntradaGaleriaCreateDTO, contenido: bytes, content_type: str | None) -> EntradaGaleria:
        if not contenido:
            raise OperacionInvalida("La imagen es obligatoria.")
        # Defensa en profundidad: el router ya acota la lectura vía
        # `leer_con_limite` antes de llegar acá, pero este chequeo protege a
        # cualquier llamador directo del servicio que no pase por esa ruta.
        if len(contenido) > self.TAMANO_MAXIMO_IMAGEN_BYTES:
            raise OperacionInvalida("La imagen no puede superar 5 MB.")
        if content_type not in ("image/jpeg", "image/png"):
            raise OperacionInvalida("La imagen debe ser un archivo JPG o PNG.")
        # La firma binaria real debe coincidir con el tipo declarado: el
        # Content-Type que manda el cliente no prueba nada sobre el contenido
        # real (mismo criterio que `SponsorServicio.crear`, la foto de perfil
        # y la subida de voucher).
        if not es_firma_valida(contenido, content_type):
            raise OperacionInvalida(
                "El contenido del archivo no coincide con el formato declarado"
            )

        public_id = str(uuid4())
        imagen_url = subir_imagen_galeria(contenido, public_id, content_type)
        resultado = self.repo.crear(EntradaGaleria(
            titulo=datos.titulo.strip(), descripcion=datos.descripcion.strip(),
            imagen_url=imagen_url, imagen_public_id=public_id,
        ))
        self.db.commit()
        # Mismo motivo que `SponsorServicio.crear`: este método corre dentro
        # de `run_in_threadpool` y la entrada se serializa después, ya en el
        # event loop.
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        return resultado

    def eliminar(self, entrada_id: int) -> None:
        entrada = self.repo.obtener_por_id(entrada_id)
        if not entrada:
            raise EntidadNoEncontrada(f"Entrada de galería con id {entrada_id} no encontrada")
        eliminar_imagen_galeria(entrada.imagen_public_id)
        self.repo.eliminar(entrada)
        self.db.commit()
