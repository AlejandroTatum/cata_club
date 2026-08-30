"""Administración de logos de patrocinadores (issue #503)."""
from uuid import uuid4

from sqlalchemy.orm import Session

from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.dominio.modelos import Sponsor
from app.infraestructura.cloudinary_cliente import eliminar_logo_sponsor, subir_logo_sponsor
from app.infraestructura.repositorios.sponsor_repositorio import SponsorRepositorio
from app.presentacion.schemas.sponsor_schemas import SponsorCreateDTO
from app.soporte_transversal.firma_archivos import es_firma_valida


class SponsorServicio:
    TAMANO_MAXIMO_LOGO_BYTES = 5 * 1024 * 1024

    def __init__(self, db: Session):
        self.repo = SponsorRepositorio(db)

    def listar(self) -> list[Sponsor]:
        return self.repo.listar()

    def crear(self, datos: SponsorCreateDTO, contenido: bytes, content_type: str | None) -> Sponsor:
        if not contenido:
            raise OperacionInvalida("El logo es obligatorio.")
        # Defensa en profundidad: el router ya acota la lectura vía
        # `leer_con_limite` antes de llegar acá, pero este chequeo protege a
        # cualquier llamador directo del servicio que no pase por esa ruta.
        if len(contenido) > self.TAMANO_MAXIMO_LOGO_BYTES:
            raise OperacionInvalida("El logo no puede superar 5 MB.")
        if content_type not in ("image/jpeg", "image/png"):
            raise OperacionInvalida("El logo debe ser una imagen JPG o PNG.")
        # La firma binaria real debe coincidir con el tipo declarado: el
        # Content-Type que manda el cliente no prueba nada sobre el contenido
        # real (issue #838, mismo criterio que `actualizar_foto_perfil`,
        # `PersonaServicio.actualizar_foto` y la subida de voucher).
        if not es_firma_valida(contenido, content_type):
            raise OperacionInvalida(
                "El contenido del archivo no coincide con el formato declarado"
            )

        public_id = str(uuid4())
        logo_url = subir_logo_sponsor(contenido, public_id, content_type)
        return self.repo.crear(Sponsor(
            nombre=datos.nombre.strip(), logo_url=logo_url, logo_public_id=public_id,
        ))

    def eliminar(self, sponsor_id: int) -> None:
        sponsor = self.repo.obtener_por_id(sponsor_id)
        if not sponsor:
            raise EntidadNoEncontrada(f"Patrocinador con id {sponsor_id} no encontrado")
        eliminar_logo_sponsor(sponsor.logo_public_id)
        self.repo.eliminar(sponsor)
