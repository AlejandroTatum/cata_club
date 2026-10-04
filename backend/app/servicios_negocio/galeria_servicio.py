"""Administración de la galería pública de la landing (issue #1372)."""
import logging
from uuid import uuid4

from sqlalchemy import inspect as inspeccionar_orm
from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.dominio.modelos import EntradaGaleria
from app.infraestructura.cloudinary_cliente import eliminar_imagen_galeria, subir_imagen_galeria
from app.infraestructura.repositorios.galeria_repositorio import GaleriaRepositorio
from app.servicios_negocio.dtos.galeria_schemas import EntradaGaleriaCreateDTO, EntradaGaleriaUpdateDTO
from app.soporte_transversal.firma_archivos import es_firma_valida


logger = logging.getLogger(__name__)


class GaleriaServicio:
    TAMANO_MAXIMO_IMAGEN_BYTES = 5 * 1024 * 1024

    def __init__(self, db: Session):
        self.db = db
        self.repo = GaleriaRepositorio(db)

    def listar(self, *, solo_visibles: bool = True) -> list[EntradaGaleria]:
        return self.repo.listar(solo_visibles=solo_visibles)

    def _validar_imagen(self, contenido: bytes, content_type: str | None) -> None:
        if not contenido:
            raise OperacionInvalida("La imagen es obligatoria.")
        # Defensa en profundidad: el router ya acota la lectura vía
        # `leer_con_limite` antes de llegar acá, pero este chequeo protege a
        # cualquier llamador directo del servicio que no pase por esa ruta.
        if len(contenido) > self.TAMANO_MAXIMO_IMAGEN_BYTES:
            raise OperacionInvalida("La imagen pesa más de 5 MB. Elija una más liviana.")
        if content_type not in ("image/jpeg", "image/png"):
            raise OperacionInvalida("La imagen debe ser un archivo JPG o PNG.")
        # La firma binaria real debe coincidir con el tipo declarado: el
        # Content-Type que manda el cliente no prueba nada sobre el contenido
        # real (mismo criterio que `SponsorServicio.crear`, la foto de perfil
        # y la subida de voucher).
        if not es_firma_valida(contenido, content_type):
            raise OperacionInvalida(
                "Ese archivo no es una imagen válida. Elija una foto JPG o PNG."
            )

    def crear(self, datos: EntradaGaleriaCreateDTO, contenido: bytes, content_type: str | None) -> EntradaGaleria:
        self._validar_imagen(contenido, content_type)
        public_id = str(uuid4())
        imagen_url = subir_imagen_galeria(contenido, public_id, content_type)
        resultado = self.repo.crear(EntradaGaleria(
            titulo=datos.titulo.strip(), descripcion=datos.descripcion.strip(),
            imagen_url=imagen_url, imagen_public_id=public_id,
            orden=self.repo.siguiente_orden(), visible=True,
        ))
        self.db.commit()
        # Mismo motivo que `SponsorServicio.crear`: este método corre dentro
        # de `run_in_threadpool` y la entrada se serializa después, ya en el
        # event loop.
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        return resultado

    def _obtener(self, entrada_id: int) -> EntradaGaleria:
        entrada = self.repo.obtener_por_id(entrada_id)
        if not entrada:
            raise EntidadNoEncontrada(f"Entrada de galería con id {entrada_id} no encontrada")
        return entrada

    def actualizar(
        self, entrada_id: int, datos: EntradaGaleriaUpdateDTO,
        contenido: bytes | None = None, content_type: str | None = None,
    ) -> EntradaGaleria:
        """ADMB-34: corrige texto y visibilidad; con `contenido` también
        reemplaza la foto (la ya recortada por el cliente, ADMB-37)."""
        entrada = self._obtener(entrada_id)
        public_id_anterior = None
        if contenido is not None:
            # Se valida y sube ANTES de tocar la fila: un archivo malo deja la
            # entrada intacta.
            self._validar_imagen(contenido, content_type)
            public_id = str(uuid4())
            entrada.imagen_url = subir_imagen_galeria(contenido, public_id, content_type)
            public_id_anterior, entrada.imagen_public_id = entrada.imagen_public_id, public_id
        entrada.titulo = datos.titulo.strip()
        entrada.descripcion = datos.descripcion.strip()
        entrada.visible = datos.visible
        self.db.commit()
        if public_id_anterior:
            try:
                eliminar_imagen_galeria(public_id_anterior)
            except Exception:  # la fila ya apunta a la foto nueva; solo queda un huérfano
                logger.warning("No se pudo retirar la foto anterior de la galería", exc_info=True)
        if inspeccionar_orm(entrada).expired:
            self.db.refresh(entrada)
        return entrada

    def mover(self, entrada_id: int, direccion: str) -> list[EntradaGaleria]:
        """Intercambia la posición con la vecina. Se renumera la lista entera
        porque las filas previas a la migración pueden compartir `orden`."""
        entrada = self._obtener(entrada_id)
        entradas = self.repo.listar()
        indice = entradas.index(entrada)
        destino = indice - 1 if direccion == "subir" else indice + 1
        if 0 <= destino < len(entradas):
            entradas[indice], entradas[destino] = entradas[destino], entradas[indice]
        for posicion, item in enumerate(entradas):
            item.orden = posicion
        self.db.commit()
        return self.repo.listar()

    def eliminar(self, entrada_id: int) -> None:
        entrada = self._obtener(entrada_id)
        eliminar_imagen_galeria(entrada.imagen_public_id)
        self.repo.eliminar(entrada)
        self.db.commit()
