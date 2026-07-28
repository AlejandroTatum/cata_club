"""
Endurecimiento de configuración (PR-10b).

Dos contratos:

1. La documentación interactiva (`/docs`, `/redoc`, `/openapi.json`) solo se
   publica FUERA de producción. En `development` y `test` sigue encendida a
   propósito (es útil para demos y para explorar la API a mano).
2. Los ajustes que en producción NO pueden quedarse con el default de
   desarrollo fallan al arrancar, con un mensaje que dice qué falta. La
   estrictez está condicionada a `AMBIENTE=production`: en `development` y
   `test` un `.env` incompleto NO puede tumbar el arranque.
"""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.soporte_transversal.configuracion import Settings, urls_documentacion
from main import app

_SECRETO_VALIDO = "clave_de_pruebas_larga_y_aleatoria_para_configuracion"


def _construir(**overrides) -> Settings:
    """Settings aislado del `.env` del repo y de las env vars del proceso
    para los campos que la prueba fija explícitamente."""
    base = {
        "_env_file": None,
        "jwt_secret_key": _SECRETO_VALIDO,
        "database_url": "postgresql+psycopg://real:real@db.produccion:5432/cataclub",
        "cors_origenes_raw": "https://cataclub.com",
        "smtp_host": "smtp.sendgrid.net",
        "frontend_url": "https://cataclub.com",
    }
    base.update(overrides)
    return Settings(**base)


# --- 1. Documentación interactiva ------------------------------------------
def test_produccion_apaga_docs_redoc_y_openapi():
    assert urls_documentacion("production") == {
        "docs_url": None, "redoc_url": None, "openapi_url": None,
    }


def test_desarrollo_mantiene_docs_encendidas():
    assert urls_documentacion("development") == {
        "docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json",
    }


def test_ambiente_test_mantiene_docs_encendidas():
    """La suite corre con AMBIENTE=test: apagarlas acá escondería la
    regresión de haber apagado también las de desarrollo."""
    assert urls_documentacion("test")["docs_url"] == "/docs"


def test_openapi_sigue_sirviendose_en_la_app_de_pruebas():
    """Verificación de extremo a extremo del punto anterior sobre la `app`
    real de `main.py` (que se construye con AMBIENTE=test)."""
    with TestClient(app) as cliente:
        respuesta = cliente.get("/openapi.json")
    assert respuesta.status_code == 200


# --- 2. Fail-fast solo en producción ---------------------------------------
def test_produccion_rechaza_la_database_url_de_ejemplo():
    with pytest.raises(ValidationError) as error:
        _construir(
            ambiente="production",
            database_url="postgresql+psycopg://usuario:password@localhost:5432/cataclub_db",
        )
    assert "DATABASE_URL" in str(error.value)


def test_produccion_rechaza_cors_origenes_vacio():
    with pytest.raises(ValidationError) as error:
        _construir(ambiente="production", cors_origenes_raw="")
    assert "CORS_ORIGENES" in str(error.value)


def test_produccion_acepta_una_configuracion_completa():
    ajustes = _construir(ambiente="production")
    assert ajustes.cors_origenes == ["https://cataclub.com"]


@pytest.mark.parametrize("ambiente", ["development", "test"])
def test_fuera_de_produccion_los_defaults_de_desarrollo_no_tumban_el_arranque(ambiente):
    """Guardia anti-regresión del riesgo principal de este cambio: un clon
    nuevo, sin `DATABASE_URL` ni `CORS_ORIGENES` en su `.env`, tiene que
    seguir arrancando en desarrollo. Incluye los defaults de correo que
    inyecta docker-compose.yml (`SMTP_HOST=mailpit`,
    `FRONTEND_URL=http://localhost:3000`): en desarrollo son exactamente lo
    que se quiere, así que no pueden tumbar el arranque."""
    ajustes = Settings(
        _env_file=None, ambiente=ambiente, jwt_secret_key=_SECRETO_VALIDO,
        cors_origenes_raw="", smtp_host="mailpit",
        frontend_url="http://localhost:3000",
    )
    assert ajustes.ambiente == ambiente
    assert ajustes.cors_origenes == []
    assert ajustes.smtp_host == "mailpit"


# --- 3. Correo transaccional: SMTP y enlace de recuperación -----------------
# Sin estos chequeos, producción arranca con los defaults de docker-compose.yml
# y la recuperación de contraseña se rompe EN SILENCIO: o el correo cae en un
# catcher de desarrollo que nadie lee, o llega al usuario real con un enlace a
# localhost que no abre en su dispositivo.
def test_produccion_rechaza_smtp_host_vacio():
    """Fallar al arrancar es mejor que fallar en el primer intento de
    recuperación de contraseña (el guardia en tiempo de ejecución de
    `notificaciones_servicio.py` sigue existiendo como defensa en profundidad)."""
    with pytest.raises(ValidationError) as error:
        _construir(ambiente="production", smtp_host="")
    assert "SMTP_HOST" in str(error.value)


@pytest.mark.parametrize("catcher", ["mailpit", "Mailpit", "mailhog", "MailHog"])
def test_produccion_rechaza_los_catchers_de_correo_de_desarrollo(catcher):
    """`docker-compose.yml` inyecta `SMTP_HOST=${SMTP_HOST:-mailpit}`: quien no
    lo sobreescriba corre producción contra un catcher. El envío tiene ÉXITO,
    así que no hay error en ningún lado — el correo simplemente desaparece.
    La comparación es case-insensitive para que `Mailpit` tampoco pase."""
    with pytest.raises(ValidationError) as error:
        _construir(ambiente="production", smtp_host=catcher)
    assert "SMTP_HOST" in str(error.value)


@pytest.mark.parametrize(
    "catcher",
    [
        "mailpit:1025",       # con puerto pegado al host
        "smtp://mailpit",     # con esquema
        "smtp://mailpit:1025/",  # esquema + puerto + barra
        "  mailpit  ",        # con espacios alrededor
        "mailpit.",           # FQDN con punto final
        "mailpit.internal",   # alias de red interna
        "mailhog.local",      # el mismo caso para el otro catcher
        "MAILPIT.INTERNAL",   # y todo en mayúsculas
    ],
)
def test_produccion_rechaza_catchers_escritos_de_otra_forma(catcher):
    """Previene el falso negativo del guardia original: comparaba el valor
    crudo contra una lista literal, así que cualquier variante que resuelve al
    MISMO catcher (`mailpit:1025`, `smtp://mailpit`, `mailpit.internal`)
    pasaba el chequeo y producción seguía tirando el correo a una bandeja que
    nadie lee. La normalización recorta espacios, esquema, puerto y punto
    final, y compara también la PRIMERA etiqueta del dominio."""
    with pytest.raises(ValidationError) as error:
        _construir(ambiente="production", smtp_host=catcher)
    assert "SMTP_HOST" in str(error.value)


def test_produccion_acepta_un_smtp_host_real():
    ajustes = _construir(ambiente="production", smtp_host="smtp.sendgrid.net")
    assert ajustes.smtp_host == "smtp.sendgrid.net"


@pytest.mark.parametrize(
    "host",
    [
        "smtp.sendgrid.net",
        "smtp.mailpitservice.com",  # decisión fijada: ver docstring
        "email-smtp.us-east-1.amazonaws.com",
        "[::1]",                    # literal IPv6 entre corchetes
        "::1",                      # literal IPv6 SIN corchetes: no debe romper
        "[2001:db8::1]:587",        # literal IPv6 con puerto
    ],
)
def test_produccion_acepta_hosts_smtp_que_no_son_catchers(host):
    """El chequeo compara etiquetas COMPLETAS, no subcadenas: un proveedor real
    cuyo dominio apenas CONTIENE la palabra (`smtp.mailpitservice.com`, cuya
    primera etiqueta es `smtp`) tiene que pasar — bloquearlo sería un falso
    positivo que deja al operador peleándose con el arranque.

    Los literales IPv6 se incluyen para fijar que la normalización del puerto
    NO los mutila ni revienta: un host IPv6 sin corchetes se deja pasar tal
    cual (ningún catcher de desarrollo se configura como literal IPv6)."""
    ajustes = _construir(ambiente="production", smtp_host=host)
    assert ajustes.smtp_host == host


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1"])
def test_produccion_acepta_un_smtp_host_local(host):
    """Decisión deliberada, fijada acá para que nadie la "corrija" después:
    un Postfix o relay corriendo en la misma máquina es un patrón legítimo de
    producción. Bloquear localhost para SMTP sería un falso positivo. La
    asimetría con FRONTEND_URL es intencional (ver el test de abajo)."""
    ajustes = _construir(ambiente="production", smtp_host=host)
    assert ajustes.smtp_host == host


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://localhost",
        "",
    ],
)
def test_produccion_rechaza_frontend_url_local_o_vacia(url):
    """A diferencia de SMTP_HOST, esta URL no la marca el servidor: viaja
    dentro de un correo que se abre en el dispositivo de otra persona, así que
    localhost es inequívocamente incorrecto. Vacía tampoco sirve: genera un
    enlace `/reset-password?token=...` sin host."""
    with pytest.raises(ValidationError) as error:
        _construir(ambiente="production", frontend_url=url)
    assert "FRONTEND_URL" in str(error.value)


@pytest.mark.parametrize(
    "url",
    [
        "localhost:3000",   # `localhost` se parsea como ESQUEMA, no como host
        "cataclub.com",     # el olvido realista: el operador omite el esquema
        "www.cataclub.com",
        "//cataclub.com",   # URL protocol-relative: no sirve dentro de un correo
        "ftp://cataclub.com",
        "javascript:alert(1)",
        "https://",         # esquema correcto pero sin host
    ],
)
def test_produccion_rechaza_frontend_url_que_no_es_absoluta_http(url):
    """Previene el defecto crítico del guardia original: usaba
    `urlparse(v).hostname`, que devuelve `None` para cualquier valor SIN
    esquema, y ese `None` se convertía en `""`, que no está en la lista negra
    — así que el valor se ACEPTABA. `localhost:3000` (donde `localhost` se
    parsea como esquema) y el typo realista `cataclub.com` atravesaban intacto
    el guardia que existe justo para atraparlos, y el enlace del correo salía
    como `cataclub.com/reset-password?token=...`: un enlace muerto enviado a
    usuarios reales.

    En producción se exige una URL ABSOLUTA con esquema http/https y host no
    vacío; cualquier otra cosa se rechaza pidiendo explícitamente el esquema."""
    with pytest.raises(ValidationError) as error:
        _construir(ambiente="production", frontend_url=url)
    mensaje = str(error.value)
    assert "FRONTEND_URL" in mensaje
    assert "https://" in mensaje  # el mensaje dice QUÉ hacer: incluir el esquema


@pytest.mark.parametrize(
    "url",
    [
        "http://[::1]:3000",     # loopback IPv6
        "https://[::1]",
        "http://127.0.0.2:3000",  # todo 127.0.0.0/8 es loopback, no solo .1
        "http://127.255.255.254",
        "http://localhost./",     # FQDN con punto final
        "http://LOCALHOST:3000",  # mayúsculas
        "http://0.0.0.0:3000",    # dirección de bind, no de destino
        "http://[::]:3000",
    ],
)
def test_produccion_rechaza_frontend_url_loopback_o_no_enrutable(url):
    """La lista literal original (`localhost`, `127.0.0.1`) solo atrapaba dos
    escrituras exactas: `http://[::1]:3000`, `http://127.0.0.2:3000` y
    `http://localhost./` apuntan al MISMO destino inútil y pasaban.

    Ahora la detección usa `ipaddress`, que cubre `127.0.0.0/8` y `::1` de una
    sola vez, más el caso no-IP (`localhost`, con o sin punto final).

    `0.0.0.0` y `::` (unspecified) también se rechazan: son direcciones de
    BIND, no de destino. Un navegador no puede abrirlas de forma útil, así que
    dentro de un correo son tan inservibles como localhost."""
    with pytest.raises(ValidationError) as error:
        _construir(ambiente="production", frontend_url=url)
    assert "FRONTEND_URL" in str(error.value)


@pytest.mark.parametrize(
    "url",
    [
        "https://cataclub.com",
        "https://cataclub.com/",        # barra final
        "https://cataclub.com:8443",    # host con puerto
        "https://app.cataclub.com",     # subdominio
        "https://cataclub.com/app",     # con path base
        "http://cataclub.com",          # http también es absoluta y enrutable
        "https://200.107.60.10",        # IP pública literal
    ],
)
def test_produccion_acepta_una_frontend_url_publica(url):
    """El endurecimiento no puede volverse un falso positivo: toda URL
    absoluta http/https con un host público real tiene que arrancar sin
    pelea, con o sin puerto, subdominio, path o barra final."""
    ajustes = _construir(ambiente="production", frontend_url=url)
    assert ajustes.frontend_url == url


def test_produccion_reporta_todos_los_problemas_en_un_solo_error():
    """El validador acumula en `faltantes` a propósito: el operador arregla
    todo de una vez en lugar de descubrir un problema por arranque."""
    with pytest.raises(ValidationError) as error:
        _construir(
            ambiente="production",
            cors_origenes_raw="",
            smtp_host="mailpit",
            frontend_url="http://localhost:3000",
        )
    mensaje = str(error.value)
    assert "CORS_ORIGENES" in mensaje
    assert "SMTP_HOST" in mensaje
    assert "FRONTEND_URL" in mensaje


def test_produccion_reporta_juntos_los_dos_problemas_que_antes_pasaban():
    """El caso que motivó este arreglo, extremo a extremo: `mailpit.internal`
    y `cataclub.com` son ambos valores que el guardia literal ACEPTABA. Ahora
    los dos tienen que aparecer en el MISMO error de arranque, para que el
    operador arregle todo de una vez."""
    with pytest.raises(ValidationError) as error:
        _construir(
            ambiente="production",
            smtp_host="mailpit.internal",
            frontend_url="cataclub.com",
        )
    mensaje = str(error.value)
    assert "SMTP_HOST" in mensaje
    assert "FRONTEND_URL" in mensaje
