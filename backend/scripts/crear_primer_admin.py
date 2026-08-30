"""Bootstrap del primer ADMINISTRADOR en una base vacía (issue #551).

Rompe el ciclo sin salida de una producción recién aprovisionada: el seed
solo corre con AMBIENTE=development (`entrypoint.sh`), `POST /auth/registro`
crea usuarios sin rol, y asignar roles exige un administrador previo. Corre
en CUALQUIER ambiente: exige contraseña fuerte y se niega si ya existe algún
ADMINISTRADOR (repetirlo es inofensivo). Uso tras el primer deploy: ver
docs/operations/provisioning.md. Todo entra por variables de entorno
(obligatorias: BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD,
BOOTSTRAP_ADMIN_CEDULA, BOOTSTRAP_ADMIN_TELEFONO; opcionales:
BOOTSTRAP_ADMIN_NOMBRES, _APELLIDOS, _FECHA_NACIMIENTO en ISO), nada por
argv: una contraseña en argumentos de CLI queda visible en `ps` y en el
historial del shell.

BOOTSTRAP_ADMIN_TELEFONO pasó de opcional a OBLIGATORIA (issue #828). Antes
tenía como default `"0000000000"`, que no es un teléfono ecuatoriano válido
-- diez dígitos que no empiezan en `09`, así que no es celular ni fijo -- y
que quedó grabado en la fila del administrador de staging. Ningún default lo
reemplaza: inventar un número con forma válida sería fabricar un dato de
contacto falso, y dejarlo vacío daría de alta al ÚNICO administrador del club
sin forma de llamarlo. El teléfono es dato de identidad igual que la cédula,
que ya era obligatoria; se pide, no se adivina."""
import os
import sys
from datetime import date
from pathlib import Path

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.cedula import es_cedula_valida  # noqa: E402
from app.dominio.enums import TipoRol  # noqa: E402
from app.dominio.modelos import Persona, Rol, Usuario  # noqa: E402
from app.dominio.telefono import es_telefono_valido  # noqa: E402
from app.seguridad.gestor_auth import GestorAutenticacion  # noqa: E402


class BootstrapAdminError(RuntimeError):
    """Se lanza cuando el bootstrap del primer administrador no procede."""


LONGITUD_MINIMA_CONTRASENIA = 12

# Contraseñas publicadas en este mismo repositorio (seeds de desarrollo):
# son de conocimiento público y jamás pueden ser la credencial de un admin.
CONTRASENIAS_PUBLICADAS = {"admin12345", "trainer12345", "alumno123"}


def validar_contrasenia(contrasenia: str) -> None:
    if len(contrasenia) < LONGITUD_MINIMA_CONTRASENIA:
        raise BootstrapAdminError(
            f"La contraseña debe tener al menos {LONGITUD_MINIMA_CONTRASENIA} caracteres."
        )
    if contrasenia.lower() in CONTRASENIAS_PUBLICADAS:
        raise BootstrapAdminError(
            "Esa contraseña está publicada en el repositorio (seed de "
            "desarrollo) y no puede usarse como credencial real."
        )


def validar_identidad(cedula: str, telefono: str) -> None:
    """Issue #828: desde que `Persona` valida su propia identidad, una cédula
    o un teléfono malos ya no entran a la base -- explotan con un `ValueError`
    del ORM en medio del alta. Este chequeo va ANTES del primer `add` para
    que el operador reciba un `BootstrapAdminError` que dice qué variable
    corregir y con qué forma, en vez de una traza de SQLAlchemy."""
    if not es_cedula_valida(cedula):
        raise BootstrapAdminError(
            "BOOTSTRAP_ADMIN_CEDULA no es una cédula ecuatoriana válida: "
            "deben ser 10 dígitos, con provincia existente (01-24 o 30) y "
            "dígito verificador correcto."
        )
    if not es_telefono_valido(telefono):
        raise BootstrapAdminError(
            "BOOTSTRAP_ADMIN_TELEFONO no es un teléfono ecuatoriano válido: "
            "10 dígitos empezando en 09 (celular) o 9 dígitos empezando en 0 "
            "(fijo), sin espacios ni separadores."
        )


def existe_administrador(db) -> bool:
    return db.query(Usuario).join(Usuario.roles).filter(
        Rol.tipo_rol == TipoRol.ADMINISTRADOR
    ).first() is not None


def crear_primer_admin(
    db, correo: str, contrasenia: str, cedula: str, nombres: str,
    apellidos: str, telefono: str, fecha_nacimiento: date,
) -> Usuario:
    """Crea persona + usuario + rol ADMINISTRADOR en UNA transacción: todas
    las validaciones van antes del primer `add` y el único `commit` está al
    final, así un rechazo no deja rastro en la base."""
    validar_contrasenia(contrasenia)
    validar_identidad(cedula, telefono)

    if existe_administrador(db):
        raise BootstrapAdminError(
            "Ya existe al menos un usuario con rol ADMINISTRADOR: este script "
            "solo crea el PRIMERO; los siguientes se asignan desde la aplicación."
        )
    if db.query(Usuario).filter(Usuario.correo == correo).first() is not None:
        raise BootstrapAdminError(f"Ya existe un usuario con el correo {correo}.")

    if db.query(Persona).filter(Persona.cedula == cedula).first() is not None:
        raise BootstrapAdminError(f"Ya existe una persona con la cédula {cedula}.")

    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=fecha_nacimiento, telefono=telefono,
    )
    db.add(persona)
    db.flush()

    # Check-before-insert (seed_dev_base.py): en una base vacía el rol no existe.
    rol_admin = db.query(Rol).filter(Rol.tipo_rol == TipoRol.ADMINISTRADOR).first()
    if rol_admin is None:
        rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")
        db.add(rol_admin)
        db.flush()

    usuario = Usuario(
        correo=correo, persona_id=persona.id, roles=[rol_admin],
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(contrasenia),
    )
    db.add(usuario)
    db.commit()
    return usuario


def main() -> None:
    correo = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "").strip()
    contrasenia = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
    cedula = os.environ.get("BOOTSTRAP_ADMIN_CEDULA", "").strip()
    telefono = os.environ.get("BOOTSTRAP_ADMIN_TELEFONO", "").strip()
    if not correo or not contrasenia or not cedula or not telefono:
        print("Bootstrap denegado: faltan BOOTSTRAP_ADMIN_EMAIL, "
              "BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_CEDULA y/o "
              "BOOTSTRAP_ADMIN_TELEFONO.", file=sys.stderr)
        sys.exit(1)

    from app.infraestructura.db import SessionLocal

    db = SessionLocal()
    try:
        usuario = crear_primer_admin(
            db,
            correo=correo,
            contrasenia=contrasenia,
            cedula=cedula,
            nombres=os.environ.get("BOOTSTRAP_ADMIN_NOMBRES", "Admin"),
            apellidos=os.environ.get("BOOTSTRAP_ADMIN_APELLIDOS", "Cata Club"),
            telefono=telefono,
            fecha_nacimiento=date.fromisoformat(
                os.environ.get("BOOTSTRAP_ADMIN_FECHA_NACIMIENTO", "1990-01-01")
            ),
        )
        print(f"[bootstrap] Administrador creado: {usuario.correo} (usuario id={usuario.id})")
    except BootstrapAdminError as exc:
        print(f"Bootstrap denegado: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
