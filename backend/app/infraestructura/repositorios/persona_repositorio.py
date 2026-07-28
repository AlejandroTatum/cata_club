from typing import Optional, List, Tuple
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Ranking, Usuario, Rol, usuario_rol
from app.dominio.enums import TipoRol
from app.infraestructura.repositorios.eliminacion_segura import eliminar_o_error_de_dominio


class PersonaRepositorio:
    """Encapsula todo el acceso a datos de Persona. Es la ÚNICA clase
    del proyecto que debe importar Session y ejecutar db.query/add/commit
    para esta entidad."""

    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, persona_id: int) -> Optional[Persona]:
        return self.db.get(Persona, persona_id)

    def obtener_por_cedula(self, cedula: str) -> Optional[Persona]:
        return self.db.query(Persona).filter(Persona.cedula == cedula).first()

    # Orden estable del roster: como se lee una nómina, por apellidos y luego
    # nombres. El id va de desempate para que el orden sea TOTAL -- sin él,
    # dos homónimos podrían repartirse de forma distinta entre páginas y
    # `OFFSET/LIMIT` repetiría o se saltaría filas.
    _ORDEN_NOMINA = (Persona.apellidos.asc(), Persona.nombres.asc(), Persona.id.asc())

    def listar(self, skip: int = 0, limit: int = 50) -> List[Persona]:
        return (
            self.db.query(Persona)
            .order_by(*self._ORDEN_NOMINA)
            .offset(skip)
            .limit(limit)
            .all()
        )

    def contar(self) -> int:
        return self.db.query(Persona).count()

    def listar_por_rol(self, tipo_rol: TipoRol) -> List[Persona]:
        """Personas con un Usuario que tenga el `tipo_rol` dado (ej. listar
        entrenadores para un selector). Mismo criterio de "rol asignado" que
        `AsistenciaServicio._validar_entrenador` usa para validar."""
        return (
            self.db.query(Persona)
            .join(Usuario, Usuario.persona_id == Persona.id)
            .join(Usuario.roles)
            .filter(Rol.tipo_rol == tipo_rol)
            # Mismo orden de nómina que `listar`: alimenta selectores
            # (entrenadores) y el ranking, donde un orden alfabético estable
            # es lo que el usuario espera al buscar un nombre en la lista.
            .order_by(*self._ORDEN_NOMINA)
            .all()
        )

    def listar_por_rol_con_ranking(
        self, tipo_rol: TipoRol
    ) -> List[Tuple[Persona, Optional[Ranking]]]:
        """Igual que `listar_por_rol`, pero trae además la fila de `Ranking`
        de cada persona (o `None`) en la MISMA sentencia.

        Existe para que el roster de niveles no dispare un SELECT de ranking
        por alumno (N+1: con 68 alumnos eran 69 consultas). Detalles que NO
        son negociables:

        - `outerjoin`: una persona puede no tener fila de `Ranking` todavía
          (aún sin grupo asignado). Con un INNER JOIN esos alumnos
          desaparecerían del roster sin error visible -- son justamente los
          que la pantalla muestra como "Sin nivel asignado".
        - `distinct`: el filtro por rol pasa por persona-usuario-rol, que
          multiplica filas cuando el usuario tiene varios roles. `listar_por_rol`
          no lo notaba porque `Query` deduplica entidades completas; acá las
          filas son tuplas, así que la deduplicación es explícita. Es segura
          porque `Ranking.persona_id` es UNIQUE: como mucho hay una fila de
          ranking por persona, nunca un producto cartesiano real.
        - Mismo `_ORDEN_NOMINA` que `listar_por_rol`: el orden del listado no
          puede cambiar por optimizar la consulta.
        """
        stmt = (
            select(Persona, Ranking)
            .join(Usuario, Usuario.persona_id == Persona.id)
            .join(usuario_rol, usuario_rol.c.usuario_id == Usuario.id)
            .join(Rol, Rol.id == usuario_rol.c.rol_id)
            .outerjoin(Ranking, Ranking.persona_id == Persona.id)
            .where(Rol.tipo_rol == tipo_rol)
            .distinct()
            .order_by(*self._ORDEN_NOMINA)
        )
        return [(persona, ranking) for persona, ranking in self.db.execute(stmt)]

    def crear(self, persona: Persona) -> Persona:
        self.db.add(persona)
        self.db.commit()
        self.db.refresh(persona)
        return persona

    def actualizar(self, persona: Persona, cambios: dict) -> Persona:
        for campo, valor in cambios.items():
            setattr(persona, campo, valor)
        self.db.commit()
        self.db.refresh(persona)
        return persona

    def eliminar(self, persona: Persona) -> None:
        eliminar_o_error_de_dominio(
            self.db, persona,
            "No se puede eliminar a esta persona porque tiene registros "
            "asociados (asistencias, pagos, membresías, ficha médica u "
            "horarios a cargo). Elimina o reasigna esos registros primero.",
        )

    # --- Reportes (E04-RF014) --------------------------------------------------
    def listar_nuevas_por_periodo(self, fecha_inicio, fecha_fin) -> List[Persona]:
        """E04-RF014: alumnos nuevos registrados en un rango de fechas."""
        return (
            self.db.query(Persona)
            .filter(Persona.fecha_registro >= fecha_inicio, Persona.fecha_registro <= fecha_fin)
            .order_by(Persona.fecha_registro.asc())
            .all()
        )

    def buscar_por_nombre(
        self, q: str, rol: Optional[str] = None, skip: int = 0, limit: int = 20
    ) -> List[Persona]:
        """Búsqueda de personas por nombre/apellido con filtro opcional por rol."""
        stmt = select(Persona)
        if rol:
            stmt = (
                stmt.join(Usuario, Usuario.persona_id == Persona.id)
                .join(usuario_rol, usuario_rol.c.usuario_id == Usuario.id)
                .join(Rol, Rol.id == usuario_rol.c.rol_id)
                .where(Rol.tipo_rol == rol)
            )
        filtro = f"%{q}%"
        stmt = stmt.where(
            (Persona.nombres.ilike(filtro)) | (Persona.apellidos.ilike(filtro))
        )
        # `skip`/`limit` viajaban por toda la cadena (router -> servicio ->
        # repositorio) sin llegar nunca a la sentencia: el tope `le=50` del
        # router era decorativo y una `q` de dos caracteres que matcheara a
        # todo el club devolvía el club entero. El `order_by` es parte del
        # arreglo: sin orden total, paginar con OFFSET no es determinista.
        stmt = stmt.order_by(*self._ORDEN_NOMINA).offset(skip).limit(limit)
        return list(self.db.execute(stmt).scalars().all())
