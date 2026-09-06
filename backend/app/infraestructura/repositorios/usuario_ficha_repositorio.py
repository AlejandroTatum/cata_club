from typing import Optional
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.dominio.enums import TipoRol
from app.dominio.modelos import FichaMedica, Rol, Usuario


class FichaMedicaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, ficha: FichaMedica) -> FichaMedica:
        """Solo `flush()` (issue #831): el caso de uso comitea una sola vez."""
        self.db.add(ficha)
        self.db.flush()
        return ficha

    def guardar_cambios(self, ficha: FichaMedica) -> FichaMedica:
        self.db.add(ficha)
        self.db.flush()
        return ficha

    def listar_persona_ids_con_ficha(self, persona_ids: list[int]) -> set[int]:
        """Issue #362: existencia en bloque, no el contenido de la ficha. El
        admin `/members` necesita saber CUÁLES de N personas tienen ficha
        médica para marcar el hueco "sin datos de emergencia" -- una fila de
        `SELECT persona_id ... WHERE persona_id IN (...)`, nunca N consultas
        (ver el docstring del router para el N+1 que esto evita)."""
        if not persona_ids:
            return set()
        filas = (
            self.db.query(FichaMedica.persona_id)
            .filter(FichaMedica.persona_id.in_(persona_ids))
            .all()
        )
        return {fila[0] for fila in filas}


class UsuarioRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_correo(self, correo: str) -> Optional[Usuario]:
        """Busca la cuenta SIN distinguir mayúsculas ni espacios al borde,
        ni en el input ni en la columna.

        Una dirección de correo no distingue mayúsculas para el usuario que
        la tipea, pero `usuario.correo` guarda literalmente lo que se escribió
        al registrarse y la comparación era `==`. La consecuencia peor no era
        el login -- ahí un error se ve -- sino la recuperación de contraseña:
        `AuthServicio.solicitar_recuperacion` no encontraba al usuario,
        respondía igual el mensaje de éxito anti-enumeración y no encolaba
        nada, así que el correo nunca llegaba y nada quedaba registrado
        (issue #764, reproducido contra QA: con `admin@cataclub.com` guardado,
        pedir `Admin@CataClub.com` devuelve 200 y cero filas en el outbox).

        Issue #1023: el predicado también recorta la COLUMNA
        (`func.btrim(Usuario.correo)`), no solo el input. Antes comparaba
        `lower(correo) == lower(entrada.strip())`: una fila legada con
        espacios al borde (solo alcanzable por una escritura que bypasee
        `CorreoValidado`, que ya normaliza en cada alta/edición de la app)
        quedaba agrupada como la MISMA identidad que su gemela sin espacios
        en `ix_usuario_correo_lower` y en el audit
        (`scripts/auditar_colisiones_correo.py`), pero inalcanzable por
        ninguno de los cuatro caminos que resuelven una cuenta por correo.
        Esta expresión tiene que ser IDÉNTICA a la del índice funcional
        único de `modelos.py` (migración `f1023correobtrim`): si difieren,
        el índice deja de poder servir esta consulta -- la más caliente del
        sistema -- y cae a sequential scan.

        Normalizar acá y no en cada llamador es lo que mantiene coherentes los
        cuatro caminos que resuelven una cuenta por correo -- login, registro,
        recuperación y restablecimiento -- y de paso hace que el registro
        rechace una variante de mayúsculas de un correo ya usado en vez de
        crear una segunda cuenta indistinguible.

        `order_by(id)` porque la unicidad de `usuario.correo` es un btree
        sensible a mayúsculas: si un despliegue ya tiene dos cuentas que solo
        difieren en la capitalización, esta consulta tiene que devolver
        siempre la misma (la más antigua) y no una al azar.
        """
        return (
            self.db.query(Usuario)
            .filter(func.lower(func.btrim(Usuario.correo)) == correo.strip().lower())
            .order_by(Usuario.id)
            .first()
        )

    def obtener_por_persona_id(self, persona_id: int) -> Optional[Usuario]:
        return self.db.query(Usuario).filter(Usuario.persona_id == persona_id).first()

    def contar_administradores_activos(self, excluir_usuario_id: Optional[int] = None) -> int:
        """Cuenta las cuentas ACTIVAS con rol ADMINISTRADOR, opcionalmente
        ignorando una de ellas.

        Solo cuentan las activas: una cuenta desactivada no puede iniciar
        sesión, así que no sirve para recuperar el sistema. `excluir_usuario_id`
        permite preguntar "¿queda algún otro administrador si toco a este?"
        antes de aplicar el cambio."""
        consulta = (
            self.db.query(Usuario)
            .join(Usuario.roles)
            .filter(Rol.tipo_rol == TipoRol.ADMINISTRADOR, Usuario.activo.is_(True))
        )
        if excluir_usuario_id is not None:
            consulta = consulta.filter(Usuario.id != excluir_usuario_id)
        return consulta.count()

    def crear(self, usuario: Usuario) -> Usuario:
        """Solo `flush()` (issue #831): el caso de uso comitea una sola vez."""
        self.db.add(usuario)
        self.db.flush()
        return usuario
