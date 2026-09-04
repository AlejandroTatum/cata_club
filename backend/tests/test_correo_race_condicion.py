"""Carrera de identidad case-variant sobre `usuario.correo` (issue #1016,
ADR-3/ADR-4/ADR-6) y su prima de `persona.cedula` (issue #942, ADR-6).

El defecto real NO es un 500: `EntidadDuplicada` ya mapea a 400
(`main.py:129-137`) y las cuatro rutas ya rechazan un duplicado SECUENCIAL
con `obtener_por_correo` (case-insensitive desde el issue #827). El
defecto es la CARRERA -- dos requests casi simultáneas, cada una viendo
"no existe" porque la otra todavía no comiteó, pasan las dos el pre-check.
Antes de la migración `d1016emailunico` ninguna las detenía y las dos
escribían (`Usuario.correo` es `unique=True` case-SENSIBLE); desde esa
migración, el índice funcional único (`ix_usuario_correo_lower`) rechaza
la segunda. Estos tests simulan la carrera anulando el pre-check con
`monkeypatch` -- mismo patrón que
`tests/test_invariantes_constraints.py::test_pago_pendiente_duplicado_
responde_igual_por_chequeo_o_por_constraint`: dos llamadas secuenciales,
ninguna "ve" a la otra, y la base es quien tiene que atajar la segunda.

En `admin_cuenta_servicio.py`, `auth_servicio.py` y `persona_servicio.py`
(`crear_representado`) el `IntegrityError` de la carrera no estaba
atrapado en absoluto ANTES de este PR -- ver ADR-3 y ADR-6. En
`enrollment_servicio.py` el catch ya existía (issue #999); acá solo se
confirma que sigue cubriendo la carrera con el índice único ya en pie
(issue #1016, tarea 2.12)."""
from datetime import date

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import EntidadDuplicada
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.dominio.modelos import Persona, Usuario
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.servicios_negocio.admin_cuenta_servicio import AdminCuentaServicio
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.dtos.auth_schemas import RegistroUsuarioDTO
from app.servicios_negocio.dtos.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentCreateDTO,
    EnrollmentCredencialesDTO,
)
from app.servicios_negocio.dtos.persona_schemas import RepresentadoCreateDTO
from app.servicios_negocio.enrollment_servicio import EnrollmentServicio
from app.servicios_negocio.persona_servicio import PersonaServicio

_FICHA = dict(
    tipo_sangre="O_POSITIVO", enfermedades=[],
    contacto_emergencia="María Torres", telefono_emergencia="0991112233",
)


def _bypass_correo(monkeypatch) -> None:
    """Simula que ninguna de las dos requests concurrentes ve la fila que
    la otra todavía no comiteó."""
    monkeypatch.setattr(UsuarioRepositorio, "obtener_por_correo", lambda self, correo: None)


def _bypass_cedula(monkeypatch) -> None:
    monkeypatch.setattr(PersonaRepositorio, "obtener_por_cedula", lambda self, cedula: None)


def _contar_usuarios_por_correo(db_session: Session, correo: str) -> int:
    return db_session.execute(
        select(func.count(Usuario.id)).where(func.lower(Usuario.correo) == correo.lower())
    ).scalar_one()


# --- 1. Autoinscripción pública (POST /enrollment/), correo -----------------

def test_autoinscripcion_race_case_variant_deja_una_sola_fila(db_session, monkeypatch):
    """Confirma la tarea 2.12: `enrollment_servicio.py` ya atrapaba
    `IntegrityError` (issue #999); con el índice único de #1016 en pie,
    ese catch ya cubre también la carrera case-variant."""
    _bypass_correo(monkeypatch)
    servicio = EnrollmentServicio(db_session)

    def _datos(correo: str, cedula: str) -> EnrollmentCreateDTO:
        return EnrollmentCreateDTO(
            alumno=EnrollmentAlumnoDTO(
                nombres="Lucas", apellidos="Martinez", cedula=cedula,
                fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
            ),
            credenciales_alumno=EnrollmentCredencialesDTO(
                correo=correo, contrasenia="password8",
            ),
            ficha_medica=dict(_FICHA),
            acepta_consentimientos=True,
        )

    ganadora = servicio.enroll(_datos("Carrera@Example.com", cedula_valida(701)))
    assert ganadora["persona_id"] is not None

    with pytest.raises(EntidadDuplicada) as error:
        servicio.enroll(_datos("carrera@example.com", cedula_valida(702)))
    assert error.value.mensaje == MENSAJE_IDENTIDAD_DUPLICADA

    assert _contar_usuarios_por_correo(db_session, "carrera@example.com") == 1


# --- 2. Panel admin (POST /personas/admin/cuentas), correo ------------------

def test_admin_wizard_race_case_variant_de_correo_da_entidad_duplicada(db_session, monkeypatch):
    """ADR-3: `admin_cuenta_servicio.py` no tenía NINGÚN catch de
    `IntegrityError` antes de este PR -- la carrera caía en el genérico
    409 de `main.py`. Acá se prueba a nivel de servicio: sin el catch, el
    `IntegrityError` crudo se propaga y el test falla con ESE error, no
    con `EntidadDuplicada`."""
    _bypass_correo(monkeypatch)
    servicio = AdminCuentaServicio(db_session)

    def _datos(correo: str, cedula: str) -> AdminCrearCuentaDTO:
        return AdminCrearCuentaDTO(
            nombres="Nueva", apellidos="Cuenta", cedula=cedula,
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
            correo=correo, contrasenia="password8",
            tipo_cuenta="JUGADOR", ficha_medica=dict(_FICHA),
        )

    ganadora = servicio.crear_cuenta(_datos("Wizard@Example.com", cedula_valida(703)))
    assert ganadora["usuario_id"] is not None

    with pytest.raises(EntidadDuplicada) as error:
        servicio.crear_cuenta(_datos("wizard@example.com", cedula_valida(704)))
    assert "correo" in error.value.mensaje.lower()

    assert _contar_usuarios_por_correo(db_session, "wizard@example.com") == 1


# --- 3. Panel admin, cedula (folds in one item from #942) -------------------

def test_admin_wizard_race_de_cedula_da_entidad_duplicada_no_generica(db_session, monkeypatch):
    """ADR-6: el mismo `try/except` que ADR-3 agrega también cubre
    `persona.cedula` -- un item de #942, no todo el issue."""
    _bypass_cedula(monkeypatch)
    servicio = AdminCuentaServicio(db_session)
    cedula_disputada = cedula_valida(705)

    def _datos(correo: str) -> AdminCrearCuentaDTO:
        return AdminCrearCuentaDTO(
            nombres="Nueva", apellidos="Cuenta", cedula=cedula_disputada,
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
            correo=correo, contrasenia="password8",
            tipo_cuenta="JUGADOR", ficha_medica=dict(_FICHA),
        )

    ganadora = servicio.crear_cuenta(_datos("primero.cedula@example.com"))
    assert ganadora["persona_id"] is not None

    with pytest.raises(EntidadDuplicada) as error:
        servicio.crear_cuenta(_datos("segundo.cedula@example.com"))
    assert "cédula" in error.value.mensaje
    assert cedula_disputada in error.value.mensaje

    total = db_session.execute(
        select(func.count(Persona.id)).where(Persona.cedula == cedula_disputada)
    ).scalar_one()
    assert total == 1


# --- 4. POST /auth/registro, correo ------------------------------------------

def test_auth_registro_race_case_variant_de_correo_da_entidad_duplicada(db_session, monkeypatch):
    """ADR-3: `auth_servicio.py` tampoco atrapaba `IntegrityError` antes de
    este PR."""
    _bypass_correo(monkeypatch)
    servicio = AuthServicio(db_session)

    persona_a = Persona(
        nombres="Persona", apellidos="A", cedula=cedula_valida(706),
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000010",
    )
    persona_b = Persona(
        nombres="Persona", apellidos="B", cedula=cedula_valida(707),
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000011",
    )
    db_session.add_all([persona_a, persona_b])
    db_session.commit()

    ganadora = servicio.registrar_usuario(RegistroUsuarioDTO(
        cedula=persona_a.cedula, correo="Registro@Example.com", contrasenia="password8",
    ))
    assert ganadora["usuario_id"] is not None

    with pytest.raises(EntidadDuplicada) as error:
        servicio.registrar_usuario(RegistroUsuarioDTO(
            cedula=persona_b.cedula, correo="registro@example.com", contrasenia="password8",
        ))
    assert error.value.mensaje == MENSAJE_IDENTIDAD_DUPLICADA

    assert _contar_usuarios_por_correo(db_session, "registro@example.com") == 1


# --- 5. POST /personas/{id}/representados, correo ----------------------------

def test_crear_representado_race_case_variant_de_correo_da_entidad_duplicada(
    db_session, monkeypatch
):
    """ADR-3: `persona_servicio.py::crear_representado` es el quinto camino
    que acuña credenciales (`RepresentadoCreateDTO`); tampoco atrapaba
    `IntegrityError`."""
    _bypass_correo(monkeypatch)
    servicio = PersonaServicio(db_session)

    representante = Persona(
        nombres="Rep", apellidos="Legal", cedula=cedula_valida(708),
        fecha_nacimiento=date(1985, 1, 1), telefono="0990000012",
    )
    db_session.add(representante)
    db_session.commit()

    def _datos(correo: str, cedula: str) -> RepresentadoCreateDTO:
        return RepresentadoCreateDTO(
            nombres="Hija", apellidos="Legal", cedula=cedula,
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo=correo, contrasenia="password8",
        )

    ganadora = servicio.crear_representado(
        representante.id, _datos("Depende@Example.com", cedula_valida(709))
    )
    assert ganadora.id is not None

    with pytest.raises(EntidadDuplicada) as error:
        servicio.crear_representado(
            representante.id, _datos("depende@example.com", cedula_valida(710))
        )
    assert error.value.mensaje == MENSAJE_IDENTIDAD_DUPLICADA

    assert _contar_usuarios_por_correo(db_session, "depende@example.com") == 1


# --- 6. El campo que se nombra sale del NOMBRE de la restricción ------------

def test_race_de_correo_no_se_confunde_con_cedula_por_el_texto_del_error(
    db_session, monkeypatch
):
    """El despacho por campo lee `error.orig.diag.constraint_name`, no
    `str(error.orig)`.

    Ese texto trae pegada la línea `DETAIL:` de psycopg, que ECHOA el valor
    en conflicto: con un `in str(...)`, un correo cuya parte local contiene
    literalmente `persona_cedula_key` -- el guion bajo es legal en un
    `EmailStr` y `admin_cuenta_schemas.py` no normaliza -- hacía que una
    carrera de CORREO se despachara por la rama de CÉDULA y respondiera
    nombrando el campo equivocado, con una cédula que nadie disputó."""
    _bypass_correo(monkeypatch)
    servicio = AdminCuentaServicio(db_session)
    correo_trampa = "persona_cedula_key@example.com"

    def _datos(cedula: str) -> AdminCrearCuentaDTO:
        return AdminCrearCuentaDTO(
            nombres="Nueva", apellidos="Cuenta", cedula=cedula,
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
            correo=correo_trampa, contrasenia="password8",
            tipo_cuenta="JUGADOR", ficha_medica=dict(_FICHA),
        )

    cedula_perdedora = cedula_valida(711)
    ganadora = servicio.crear_cuenta(_datos(cedula_valida(712)))
    assert ganadora["usuario_id"] is not None

    with pytest.raises(EntidadDuplicada) as error:
        servicio.crear_cuenta(_datos(cedula_perdedora))
    assert error.value.mensaje == "El correo ya está en uso por otra cuenta"
    assert cedula_perdedora not in error.value.mensaje

    assert _contar_usuarios_por_correo(db_session, correo_trampa) == 1


# --- 7. POST /personas/{id}/representados, cedula ----------------------------

def test_crear_representado_race_de_cedula_da_entidad_duplicada(db_session, monkeypatch):
    """ADR-6: `crear_representado` valida la cédula en
    `_crear_persona_validada`, que flushea el INSERT de la Persona. Ese
    pre-check es tan racy como el del correo, así que el `try` tiene que
    abarcar también ese paso -- si no, la carrera de cédula cae en el 409
    genérico de `main.py` mientras la misma carrera en el panel admin ya
    responde `EntidadDuplicada`."""
    _bypass_cedula(monkeypatch)
    servicio = PersonaServicio(db_session)

    representante = Persona(
        nombres="Rep", apellidos="Legal", cedula=cedula_valida(713),
        fecha_nacimiento=date(1985, 1, 1), telefono="0990000013",
    )
    db_session.add(representante)
    db_session.commit()
    cedula_disputada = cedula_valida(714)

    def _datos() -> RepresentadoCreateDTO:
        return RepresentadoCreateDTO(
            nombres="Hija", apellidos="Legal", cedula=cedula_disputada,
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
        )

    ganadora = servicio.crear_representado(representante.id, _datos())
    assert ganadora.id is not None

    with pytest.raises(EntidadDuplicada) as error:
        servicio.crear_representado(representante.id, _datos())
    assert error.value.mensaje == MENSAJE_IDENTIDAD_DUPLICADA

    total = db_session.execute(
        select(func.count(Persona.id)).where(Persona.cedula == cedula_disputada)
    ).scalar_one()
    assert total == 1


# --- 8. Una restricción que NO es de identidad no se traduce ----------------

def test_integrity_error_ajeno_a_la_identidad_no_sale_como_duplicado(db_session):
    """El `except IntegrityError` no puede anunciar "esta identidad ya
    existe" ante CUALQUIER violación de constraint.

    Acá la que falla es la FK `persona_institucion_id_fkey` (una institución
    que no existe), que nada tiene que ver con la cédula ni con el correo:
    el error se re-lanza tal cual para que lo trate el handler de `main.py`
    (409 genérico), en vez de mentirle al usuario que sus datos ya están
    registrados."""
    servicio = PersonaServicio(db_session)

    representante = Persona(
        nombres="Rep", apellidos="Legal", cedula=cedula_valida(715),
        fecha_nacimiento=date(1985, 1, 1), telefono="0990000014",
    )
    db_session.add(representante)
    db_session.commit()

    with pytest.raises(IntegrityError):
        servicio.crear_representado(representante.id, RepresentadoCreateDTO(
            nombres="Hija", apellidos="Legal", cedula=cedula_valida(716),
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            institucion_id=999_999_999,
        ))
