"""
Issues #826 y #835: las subidas a Cloudinary y los hasheos bcrypt bloquean el
event loop.

`test_bloqueo_del_event_loop.py` es el candado estructural: prueba que ninguna
llamada bloqueante quedó fuera de `run_in_threadpool` mirando el AST. Este
archivo prueba la otra mitad, la que un AST no puede decir: que el SERVIDOR
sigue atendiendo mientras una de esas llamadas está en curso. Es el mismo
razonamiento -- y la misma forma -- que `test_auth_login_no_bloqueante.py`
(issue #311): ASGI real, una llamada lenta REAL disparada en un hilo aparte, y
otro request medido desde el hilo principal mientras esa llamada todavía corre.

El backend corre un solo proceso de uvicorn sin `--workers`
(`backend/Dockerfile:53`), así que "el event loop" es literalmente el único
hilo que atiende a todos los clientes.

Se eligieron dos caminos, uno por cada mecanismo de bloqueo:

  · `POST /sponsors/` -- E/S de red contra Cloudinary, acotada por
    `TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS = 8.0`.
  · `POST /enrollment/` -- bcrypt, cientos de ms de CPU PURA por hash (ver la
    medición en `test_bloqueo_del_event_loop.py`). Es el más
    grave de los dos: el endpoint es público y sin autenticación, así que
    provocarlo no requiere ni una cuenta.

Los dobles duermen 1 s en vez de hacer el trabajo real (ni red ni bcrypt
costoso): lo que se mide es si ese segundo se paga en el event loop o en el
threadpool, y para eso el origen de la demora es indistinto. Sin el arreglo,
`GET /health` -- que no toca ni la BD ni la red -- tarda lo que reste de ese
segundo; con el arreglo, unos pocos milisegundos.

Con una salvedad que conviene decir en voz alta: `time.sleep` SUELTA el GIL,
así que el threadpool lo esconde de verdad. Un bloqueo que NO lo soltara
seguiría frenando al event loop aunque corriera en otro hilo, y este doble no
lo detectaría. La conclusión sobre producción igual se sostiene, pero por otra
razón: bcrypt suelta el GIL mientras deriva (lo hace su extensión en C) y el
SDK de Cloudinary bloquea en un socket. Eso lo garantizan esas bibliotecas, no
este archivo.

El tercer test cuida el borde de esa corrección: mover el trabajo al
threadpool no sirve si el handler devuelve un objeto que obliga a la
serialización -- que corre en el event loop -- a volver a la base.
"""
import threading
import time
from datetime import date

from sqlalchemy import inspect as inspeccionar_orm

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona
from app.presentacion.schemas.enrollment_schemas import EnrollmentFichaMedicaDTO
from app.presentacion.schemas.persona_schemas import (
    PersonaResponseDTO, RepresentadoCreateDTO,
)
from app.servicios_negocio.persona_servicio import PersonaServicio

RUTA_SPONSORS = "/api/v1/sponsors/"
RUTA_ENROLLMENT = "/api/v1/enrollment/"

# Firma binaria real de un JPEG, igual que en `test_sponsors.py`: el servicio
# valida que el contenido coincida con el `content_type` declarado (#838) antes
# de llegar a Cloudinary, así que un relleno cualquiera nunca alcanzaría la
# subida que este test necesita poner en vuelo.
JPEG_VALIDO = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100

SEGUNDOS_DE_LA_LLAMADA_LENTA = 1.0
# Techo de la aserción. Un `GET /health` normal tarda pocos milisegundos; 200 ms
# deja margen holgado para el ruido de un runner cargado sin acercarse ni de
# lejos al ~1000 ms que costaría si el event loop estuviera retenido. Mismo
# criterio y mismo número que `test_auth_login_no_bloqueante.py`.
TECHO_DE_SALUD_SEGUNDOS = 0.2


def _medir_salud_durante(client, disparar, en_vuelo: threading.Event) -> tuple[float, dict]:
    """Corre `disparar` en un hilo y cronometra `GET /health` mientras tanto.

    `en_vuelo` lo levanta el doble lento JUSTO ANTES de dormir, así que cuando
    esta función mide ya es un hecho -- no una estimación de tiempos, como el
    `sleep(0.1)` del test de login -- que la llamada bloqueante está en curso.
    """
    resultado: dict = {}

    def _correr():
        try:
            resultado["respuesta"] = disparar()
        except BaseException as exc:  # pragma: no cover - solo diagnostica
            resultado["error"] = exc

    hilo = threading.Thread(target=_correr)
    hilo.start()
    try:
        assert en_vuelo.wait(timeout=10), "la llamada lenta nunca arrancó"
        inicio = time.monotonic()
        respuesta_salud = client.get("/health")
        duracion = time.monotonic() - inicio
    finally:
        hilo.join(timeout=30)

    assert "error" not in resultado, resultado.get("error")
    assert respuesta_salud.status_code == 200
    return duracion, resultado["respuesta"]


def test_subida_lenta_de_logo_no_bloquea_el_event_loop(client, monkeypatch):
    en_vuelo = threading.Event()

    def _subida_lenta(contenido, public_id, content_type):
        # Se reemplaza `subir_logo_sponsor` y no `cloudinary.uploader.upload`
        # a propósito: es la misma costura que ya usan todos los tests de
        # `test_sponsors.py`, y lo que se está midiendo es la disciplina del
        # router respecto del event loop, no el SDK.
        en_vuelo.set()
        time.sleep(SEGUNDOS_DE_LA_LLAMADA_LENTA)
        return f"https://cdn/{public_id}.jpg"

    monkeypatch.setattr(
        "app.servicios_negocio.sponsor_servicio.subir_logo_sponsor", _subida_lenta,
    )

    duracion, respuesta = _medir_salud_durante(
        client,
        lambda: client.post(
            RUTA_SPONSORS,
            data={"nombre": "Municipio"},
            files={"archivo": ("logo.jpg", JPEG_VALIDO, "image/jpeg")},
        ),
        en_vuelo,
    )

    assert respuesta.status_code == 201
    assert duracion < TECHO_DE_SALUD_SEGUNDOS, (
        f"GET /health tardó {duracion:.3f}s mientras una subida de logo de "
        f"{SEGUNDOS_DE_LA_LLAMADA_LENTA:.0f}s estaba en curso -- el event loop "
        "parece bloqueado"
    )


def test_hasheo_lento_de_la_autoinscripcion_publica_no_bloquea_el_event_loop(
    client, monkeypatch,
):
    """El más urgente de los tres hasheos: `POST /enrollment/` es PÚBLICO.

    Se ralentiza `pwd_context.hash`, que es la primitiva real (bcrypt), y no
    `obtener_hash_contrasenia`: así el camino que se ejercita es el de
    producción entero, incluido el método de `GestorAutenticacion` que el
    servicio llama.
    """
    from app.seguridad import gestor_auth

    en_vuelo = threading.Event()
    hash_real = gestor_auth.pwd_context.hash

    def _hash_lento(contrasenia):
        en_vuelo.set()
        time.sleep(SEGUNDOS_DE_LA_LLAMADA_LENTA)
        return hash_real(contrasenia)

    monkeypatch.setattr(gestor_auth.pwd_context, "hash", _hash_lento)

    cuerpo = {
        "alumno": {
            "nombres": "Ana",
            "apellidos": "Torres",
            # Cédula ecuatoriana con dígito verificador correcto: el DTO la
            # valida antes de que el flujo llegue al hasheo, así que un número
            # inventado dejaría a este test verde sin haber medido nada.
            "cedula": cedula_valida(826),
            "fecha_nacimiento": "1990-05-20",
            "telefono": "0991234567",
        },
        "credenciales_alumno": {
            # `example.com` y no `cataclub.test`: pydantic rechaza los TLD
            # reservados en `EmailStr`, y ese 422 mataría el request antes del
            # hasheo que este test necesita poner en vuelo.
            "correo": "ana-no-bloqueante@example.com", "contrasenia": "password8",
        },
        "ficha_medica": {
            "tipo_sangre": "O_POSITIVO",
            "enfermedades": [],
            "contacto_emergencia": "María Torres",
            "telefono_emergencia": "0991112233",
        },
        "acepta_consentimientos": True,
    }

    duracion, respuesta = _medir_salud_durante(
        client,
        lambda: client.post(RUTA_ENROLLMENT, json=cuerpo),
        en_vuelo,
    )

    assert respuesta.status_code == 201, respuesta.text
    assert duracion < TECHO_DE_SALUD_SEGUNDOS, (
        f"GET /health tardó {duracion:.3f}s mientras el bcrypt de una "
        "autoinscripción pública corría -- el event loop parece bloqueado, y "
        "este endpoint no exige ni una cuenta para provocarlo"
    )


def test_crear_representado_devuelve_una_persona_que_no_vuelve_a_la_base(
    db_session, contar_selects,
):
    """Lo que el servicio devuelve no puede quedar EXPIRADO.

    `crear_representado` no termina en el `commit()+refresh()` de
    `registrar_persona`: después de eso commitean `FichaMedicaRepositorio.
    crear`, `repo_usuario.crear` y `_asignar_rol`, y como `expire_on_commit`
    está en su default `True` (`app/infraestructura/db.py:14`), cada uno de
    esos commits vuelve a expirar el objeto ya devuelto.

    Un ORM expirado se despierta solo, con un SELECT, la primera vez que
    alguien lee un atributo. Y ese alguien es la serialización de FastAPI
    contra `PersonaResponseDTO`, que corre en el hilo del EVENT LOOP -- afuera
    del `run_in_threadpool` del handler (#826). O sea: la ida a la base
    volvería justo al hilo del que este PR la sacó.

    Por eso el test mira las dos mitades: que el objeto no esté expirado, y
    que serializarlo no ejecute NINGUNA sentencia. La segunda es la que
    importa; la primera nombra la causa cuando falla.
    """
    representante = Persona(
        nombres="Marcela", apellidos="Vega", cedula=cedula_valida(1),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991230000",
    )
    db_session.add(representante)
    db_session.commit()
    db_session.refresh(representante)

    # CON ficha médica Y credenciales: es el camino que dispara los tres
    # commits posteriores al `refresh` de `registrar_persona`.
    datos = RepresentadoCreateDTO(
        nombres="Lucas", apellidos="Vega", cedula=cedula_valida(2),
        fecha_nacimiento=date(2015, 5, 14), telefono="0991230001",
        ficha_medica=EnrollmentFichaMedicaDTO(
            tipo_sangre="O_POSITIVO", enfermedades=["Asma"],
            contacto_emergencia="Marcela Vega", telefono_emergencia="0991230000",
        ),
        correo="menor-no-bloqueante@example.com", contrasenia="clave12345",
    )

    representado = PersonaServicio(db_session).crear_representado(representante.id, datos)

    assert not inspeccionar_orm(representado).expired, (
        "`crear_representado` devolvió una Persona expirada: los commits de la "
        "ficha, el usuario y el rol la invalidan después del `refresh` de "
        "`registrar_persona`. Refrescarla dentro del servicio deja ese SELECT "
        "en el threadpool en vez de dejárselo al event loop"
    )

    with contar_selects() as sentencias:
        PersonaResponseDTO.model_validate(representado)

    assert sentencias == [], (
        "Serializar la respuesta ejecutó "
        f"{len(sentencias)} sentencia(s) contra la base. Eso pasa en el hilo "
        "del event loop, después de que el handler salió del "
        f"`run_in_threadpool`: {sentencias}"
    )
