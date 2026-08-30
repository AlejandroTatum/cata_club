"""Tests del bootstrap del primer ADMINISTRADOR (issue #551): contraseña
fuerte (nunca las publicadas del seed), negativa si ya existe un ADMINISTRADOR
y alta de persona+usuario+rol en una transacción — todo contra SQLite en
memoria (mismo montaje importlib que `test_seed_dev_base.py`), sin Postgres."""
import importlib.util
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.dominio.enums import TipoRol
from app.dominio.modelos import Base, Persona, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion

SCRIPT = Path(__file__).parents[1] / "scripts" / "crear_primer_admin.py"
CONTRASENIA_FUERTE = "una-clave-larga-y-unica-2026"
DATOS_ADMIN = {
    "correo": "duenio@clubreal.com", "contrasenia": CONTRASENIA_FUERTE,
    "cedula": "1710034065", "nombres": "Admin", "apellidos": "Bootstrap",
    "telefono": "0999999999", "fecha_nacimiento": date(1990, 1, 1),
}


def _cargar_modulo():
    spec = importlib.util.spec_from_file_location("crear_primer_admin", SCRIPT)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


def _sesion_en_memoria():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


def test_contrasenia_corta_rechaza():
    modulo = _cargar_modulo()
    with pytest.raises(modulo.BootstrapAdminError):
        modulo.validar_contrasenia("corta123456")  # 11 < 12


@pytest.mark.parametrize(
    "conocida", ["admin12345", "trainer12345", "alumno123", "TRAINER12345"]
)
def test_contrasenias_publicadas_del_seed_rechazan(conocida):
    """Claves documentadas en el repo: nunca aceptables, en ningún casing."""
    modulo = _cargar_modulo()
    with pytest.raises(modulo.BootstrapAdminError):
        modulo.validar_contrasenia(conocida)


def test_contrasenia_fuerte_pasa():
    _cargar_modulo().validar_contrasenia(CONTRASENIA_FUERTE)


def test_rechaza_si_ya_existe_un_administrador():
    """Con UN usuario que ya tenga el rol ADMINISTRADOR, se niega."""
    modulo = _cargar_modulo()
    with _sesion_en_memoria()() as db:
        modulo.crear_primer_admin(db, **DATOS_ADMIN)
        with pytest.raises(modulo.BootstrapAdminError):
            modulo.crear_primer_admin(
                db, **{**DATOS_ADMIN, "correo": "otro@clubreal.com", "cedula": "1710034073"}
            )


def test_crea_persona_usuario_y_rol_administrador_persistidos():
    modulo = _cargar_modulo()
    SessionLocal = _sesion_en_memoria()
    with SessionLocal() as db:
        modulo.crear_primer_admin(db, **DATOS_ADMIN)

    with SessionLocal() as verificacion:
        usuario = verificacion.query(Usuario).filter(Usuario.correo == DATOS_ADMIN["correo"]).one()
        assert [rol.tipo_rol for rol in usuario.roles] == [TipoRol.ADMINISTRADOR]
        assert usuario.persona.cedula == DATOS_ADMIN["cedula"]
        assert usuario.contrasenia != CONTRASENIA_FUERTE  # hasheada, nunca en claro
        assert GestorAutenticacion.verificar_contrasenia(CONTRASENIA_FUERTE, usuario.contrasenia)


@pytest.mark.parametrize("cedula", ["1712345678", "0000000000", "17100340", "abcdefghij"])
def test_cedula_invalida_rechaza_con_mensaje_accionable(cedula):
    """Issue #828: desde que `Persona` valida su identidad, una cédula mala
    reventaría con un `ValueError` del ORM en medio del alta. El script la
    ataja antes y dice QUÉ variable corregir."""
    modulo = _cargar_modulo()
    with pytest.raises(modulo.BootstrapAdminError, match="BOOTSTRAP_ADMIN_CEDULA"):
        modulo.validar_identidad(cedula, "0999999999")


@pytest.mark.parametrize("telefono", ["0000000000", "", "0812345678", "+593991234567"])
def test_telefono_invalido_rechaza_con_mensaje_accionable(telefono):
    """`0000000000` era el DEFAULT de `BOOTSTRAP_ADMIN_TELEFONO` hasta el
    issue #828 -- y es la fila que hoy está en staging. Ahora la variable es
    obligatoria y su valor se valida."""
    modulo = _cargar_modulo()
    with pytest.raises(modulo.BootstrapAdminError, match="BOOTSTRAP_ADMIN_TELEFONO"):
        modulo.validar_identidad("1710034065", telefono)


def test_identidad_valida_pasa():
    _cargar_modulo().validar_identidad("1710034065", "0999999999")


def test_sin_telefono_en_el_entorno_el_script_se_niega(monkeypatch, capsys):
    """`BOOTSTRAP_ADMIN_TELEFONO` pasó de opcional (con default
    `"0000000000"`, que no es un teléfono válido) a OBLIGATORIA. Se prueba por
    comportamiento, no leyendo el texto del script: `main()` corta antes de
    tocar la base."""
    modulo = _cargar_modulo()
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAIL", "duenio@clubreal.com")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", CONTRASENIA_FUERTE)
    monkeypatch.setenv("BOOTSTRAP_ADMIN_CEDULA", "1710034065")
    monkeypatch.delenv("BOOTSTRAP_ADMIN_TELEFONO", raising=False)

    with pytest.raises(SystemExit) as salida:
        modulo.main()

    assert salida.value.code == 1
    assert "BOOTSTRAP_ADMIN_TELEFONO" in capsys.readouterr().err


def test_identidad_invalida_no_deja_rastro_en_la_base():
    """Igual que la contraseña débil: la validación va antes del primer `add`,
    así que un rechazo de identidad no persiste nada."""
    modulo = _cargar_modulo()
    SessionLocal = _sesion_en_memoria()
    with SessionLocal() as db:
        with pytest.raises(modulo.BootstrapAdminError):
            modulo.crear_primer_admin(db, **{**DATOS_ADMIN, "telefono": "0000000000"})

    with SessionLocal() as verificacion:
        assert verificacion.query(Usuario).count() == 0
        assert verificacion.query(Persona).count() == 0


def test_contrasenia_debil_no_deja_rastro_en_la_base():
    """Toda validación va antes del único commit: un rechazo no persiste nada."""
    modulo = _cargar_modulo()
    SessionLocal = _sesion_en_memoria()
    with SessionLocal() as db:
        with pytest.raises(modulo.BootstrapAdminError):
            modulo.crear_primer_admin(db, **{**DATOS_ADMIN, "contrasenia": "trainer12345"})

    with SessionLocal() as verificacion:
        assert verificacion.query(Usuario).count() == 0
        assert verificacion.query(Persona).count() == 0
