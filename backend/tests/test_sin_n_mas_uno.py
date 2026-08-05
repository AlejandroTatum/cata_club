"""
Contrato "no hay N+1" sobre los repositorios con `listar()` de entidad plana
(consultas-sin-n1, slice 5, Design D8): `descuento`, `geografia` (país,
provincia, cantón), `institucion` y `persona.listar` (ya paginado) deben
resolver su listado en un número FIJO de SELECTs, sin crecer con la
cantidad de filas devueltas.

Fuera de este contrato (D8): `antecedentes_club_repositorio.py`,
`rol_repositorio.py` y `usuario_ficha_repositorio.py` no tienen ningún
método de listado multi-fila. Un test de conteo de SELECTs ahí afirmaría
una condición que hoy es IMPOSIBLE de violar -- no hay bucle sobre filas
que pudiera degenerar en N+1 -- así que no protegería nada real y solo
agregaría líneas vacías de mantenimiento.

Estos tests NO pueden ser RED-first (Design, sección "Testing Strategy"):
ya pasan hoy, porque ninguno de estos `listar()` toca una relación dentro
de un bucle. La prueba de que NO son vacíos está documentada en el
docstring de cada uno: se detalla la mutación temporal (acceder a una
relación lazy por cada fila, DENTRO del bloque medido) que se aplicó, se
corrió, SÍ hizo subir el conteo de SELECTs -- confirmando que el fixture
`contar_selects` detecta un N+1 real si alguna vez se introduce uno acá --
y luego se revirtió. Ningún archivo de producción fue tocado para esta
prueba: la mutación vive, se ejecuta y se revierte enteramente en el test.
"""
from datetime import date
from decimal import Decimal

from app.dominio.enums import TipoEscuela
from app.dominio.modelos import Canton, Descuento, Institucion, Pais, Persona, Provincia
from app.infraestructura.repositorios.descuento_repositorio import DescuentoRepositorio
from app.infraestructura.repositorios.geografia_repositorio import (
    CantonRepositorio, PaisRepositorio, ProvinciaRepositorio,
)
from app.infraestructura.repositorios.institucion_repositorio import InstitucionRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio


def _selects(sentencias):
    return [s for s in sentencias if s.strip().upper().startswith("SELECT")]


def test_descuento_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for d in resultado: _ = d.aplicaciones` (relación lazy `List[
    DescuentoAplicado]`) -- el conteo de SELECTs subió de 1 a 4 (uno extra
    por cada uno de los 3 descuentos). Confirma que el fixture SÍ detecta
    un N+1 si alguna vez se introduce uno acá."""
    for i in range(3):
        db_session.add(Descuento(nombre=f"Descuento {i}", porcentaje=Decimal("10")))
    db_session.commit()
    db_session.expire_all()  # fuerza recarga real desde la BD

    repo = DescuentoRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 3
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_pais_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for p in resultado: _ = p.provincias` (relación lazy `List[Provincia]`)
    -- el conteo de SELECTs subió de 1 a 4 (uno extra por cada uno de los
    3 países)."""
    for nombre in ["Ecuador", "Perú", "Colombia"]:
        db_session.add(Pais(nombre=nombre))
    db_session.commit()
    db_session.expire_all()

    repo = PaisRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 3
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_provincia_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for pv in resultado: _ = pv.cantones` (relación lazy `List[Canton]`)
    -- el conteo de SELECTs subió de 1 a 3 (uno extra por cada una de las
    2 provincias)."""
    pais = Pais(nombre="Ecuador")
    db_session.add(pais)
    db_session.flush()
    for nombre in ["Pichincha", "Guayas"]:
        db_session.add(Provincia(nombre=nombre, pais_id=pais.id))
    db_session.commit()
    db_session.expire_all()

    repo = ProvinciaRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 2
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_canton_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for c in resultado: _ = c.direcciones` (relación lazy `List[
    Direccion]`) -- el conteo de SELECTs subió de 1 a 3 (uno extra por
    cada uno de los 2 cantones)."""
    pais = Pais(nombre="Ecuador")
    db_session.add(pais)
    db_session.flush()
    provincia = Provincia(nombre="Pichincha", pais_id=pais.id)
    db_session.add(provincia)
    db_session.flush()
    for nombre in ["Quito", "Rumiñahui"]:
        db_session.add(Canton(nombre=nombre, provincia_id=provincia.id))
    db_session.commit()
    db_session.expire_all()

    repo = CantonRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 2
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_institucion_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """Mutación probada y revertida: dentro del bloque medido se agregó
    `for i_ in resultado: _ = i_.personas` (relación lazy `List[Persona]`)
    -- el conteo de SELECTs subió de 1 a 4 (uno extra por cada una de las
    3 instituciones)."""
    for nombre in ["Colegio A", "Colegio B", "Colegio C"]:
        db_session.add(Institucion(nombre=nombre, tipo_escuela=TipoEscuela.FISCAL))
    db_session.commit()
    db_session.expire_all()

    repo = InstitucionRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar()

    assert len(resultado) == 3
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )


def test_persona_listar_no_incurre_en_n_mas_uno(db_session, contar_selects):
    """`PersonaRepositorio.listar` ya está paginado (`skip`/`limit`); este
    test guarda que, además, siga siendo plano. Mutación probada y
    revertida: dentro del bloque medido se agregó `for p in resultado: _ =
    p.usuario` (relación lazy `Optional[Usuario]`, to-one) -- el conteo de
    SELECTs subió de 1 a 4 (uno extra por cada una de las 3 personas)."""
    for i in range(3):
        db_session.add(Persona(
            nombres="Ana", apellidos=f"Torres {i}", cedula=f"171003{4200 + i}",
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
        ))
    db_session.commit()
    db_session.expire_all()

    repo = PersonaRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar(skip=0, limit=50)

    assert len(resultado) == 3
    selects = _selects(sentencias)
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT, se ejecutaron {len(selects)}: {selects}"
    )
