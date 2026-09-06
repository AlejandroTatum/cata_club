#!/usr/bin/env bash
# Post-chequeos compartidos entre `deploy.sh` y `rollback-release.sh`: recrear
# el borde de Caddy, probar `/health/ready` a través de él y verificar que
# celery-worker/celery-beat respondan (issue #1064: el rollback corría con
# menos candados que un deploy). Este archivo se `source`ea, nunca se
# ejecuta directamente: asume que quien lo importa ya definió `log`, `die`,
# `STACK_DIR` y `COMPOSE_FILES`.

# Mismo idioma que `load_image_tag`. El contenedor backend NO recibe `DOMINIO`
# (solo lo declara el servicio `caddy` en docker-compose.prod.yml), y la sonda
# del borde lo necesita para presentar el SNI y el Host del bloque `{$DOMINIO}`
# del Caddyfile: sin eso Caddy no matchea el sitio y la prueba mediría otra
# cosa. Se lee del mismo `.env` y se pasa al `exec` explícitamente, sin tocar
# ningún archivo de Compose. `DOMINIO_INDEXABLE=` no matchea este patrón.
load_dominio() {
  if [ -z "${DOMINIO:-}" ] && [ -f "$STACK_DIR/.env" ]; then
    DOMINIO="$(sed -n 's/^DOMINIO=//p' "$STACK_DIR/.env" | head -1)"
    export DOMINIO
  fi
}

# Recrea SOLO caddy para que vuelva a compilar el Caddyfile del host.
#
# `--no-deps` es obligatorio: sin él, Compose arrastra a `frontend` (y por su
# `depends_on`, al resto) a una recreación que este refresco no necesita.
#
# NUNCA `-v`, `--renew-anon-volumes` ni `down`: `caddy_data` guarda los
# certificados de Let's Encrypt y su emisión tiene límite semanal, así que
# perderlos deja el sitio sin certificado válido por días
# (docker-compose.prod.yml, junto a los volúmenes nombrados).
refrescar_caddy() {
  log "Refrescando el borde público: recreación acotada de caddy"
  docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate --no-deps caddy
  esperar_servicio_saludable caddy "$(printf '%s\n' \
    "       Sin caddy sano no hay borde público: el sitio entero queda" \
    "       inalcanzable aunque backend y frontend estén corriendo.")"
}

# Prueba `/health/ready` POR EL BORDE, que es lo que consume el monitor
# externo. `do_checks` ya lo probaba dentro del contenedor backend
# (127.0.0.1:8000), lo cual esquiva Caddy por completo -- por eso el deploy del
# incidente quedó en verde con el borde sirviendo una configuración vieja.
#
# Se sondea desde el contenedor backend (tiene python) hacia el servicio
# `caddy` por la red interna de Compose: sin DNS público y sin certificado
# válido para ese nombre, de ahí el `server_hostname` explícito y la
# verificación desactivada. Acá NO se está probando TLS, se está probando el
# enrutamiento.
#
# El bloque del sitio es `{$DOMINIO}`, así que la petición tiene que presentar
# ese SNI y ese Host o Caddy no matchea el sitio y la prueba mediría otra cosa.
#
# Exigir JSON, no solo un 200: cuando la ruta del backend no está en la config
# activa, la petición cae en el catch-all del frontend y Next.js contesta su
# propia página de error -- que puede ser un 200 perfectamente legible para un
# chequeo que solo mire el código de estado.
verificar_readiness_publica() {
  load_dominio
  [ -n "${DOMINIO:-}" ] || die "$(printf '%s\n' \
    "falta DOMINIO para probar /health/ready por el borde público." \
    "       Es la misma variable que ${STACK_DIR}/.env ya le da a caddy" \
    "       (docker-compose.prod.yml): sin ella no hay Host que presentar.")"
  log "Validación: /health/ready por el borde público (a través de Caddy)"
  if ! docker compose "${COMPOSE_FILES[@]}" exec -T -e DOMINIO="$DOMINIO" backend python -c '
import json, os, socket, ssl, sys
dominio = os.environ["DOMINIO"]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
with socket.create_connection(("caddy", 443), timeout=10) as raw:
    with ctx.wrap_socket(raw, server_hostname=dominio) as sock:
        sock.sendall(
            f"GET /health/ready HTTP/1.1\r\nHost: {dominio}\r\n"
            "Connection: close\r\n\r\n".encode()
        )
        datos = b""
        while True:
            trozo = sock.recv(4096)
            if not trozo:
                break
            datos += trozo
cabecera, _, cuerpo = datos.partition(b"\r\n\r\n")
estado = cabecera.split(b"\r\n", 1)[0].decode(errors="replace")
if " 200 " not in estado:
    raise SystemExit(f"/health/ready por el borde respondió {estado!r}")
texto = cuerpo.decode(errors="replace").strip()
if texto[:1] not in "{[":
    raise SystemExit(f"/health/ready por el borde devolvió HTML del frontend, no JSON: {texto[:120]!r}")
json.loads(texto)
'; then
    die "$(printf '%s\n' \
      "/health/ready no responde JSON por el borde público." \
      "       El detalle está arriba. Si devolvió HTML, la ruta del backend no" \
      "       está en la configuración ACTIVA de Caddy y la petición cayó en el" \
      "       catch-all del frontend: el monitor externo estaría leyendo un 404" \
      "       de Next.js como si fuera un sitio sano. Revisá:" \
      "         docker compose ${COMPOSE_FILES[*]} logs caddy")"
  fi
}

# Issue #791, punto 3. `docker compose ps -a` de la línea anterior solo
# IMPRIME: nada leía esa salida, así que una imagen que rompe el arranque de
# celery-worker o celery-beat dejaba el deploy en verde y
# `record-release.sh` anotaba el release como bueno con las tareas
# asíncronas (vencimientos, mora, las bandejas de salida de correo) muertas
# en silencio. `docker-compose.yml` YA declara un healthcheck bien diseñado
# para cada uno (`inspect ping -d` para el worker, freshness del
# `celerybeat-schedule` para beat); lo que faltaba era que algo los leyera.
#
# Fuera de Swarm, Compose no reinicia un contenedor por quedar `unhealthy`
# -- solo por salir --, así que sin este candado un contenedor enfermo podía
# quedar así indefinidamente sin que nada lo notara.
check_celery() {
  local consecuencia
  consecuencia="$(printf '%s\n' \
    "       Sin worker/beat sanos, los avisos de vencimiento, de mora y las" \
    "       bandejas de salida de correo quedan sin procesar en silencio.")"
  log "Validación: salud de celery-worker y celery-beat"
  esperar_servicio_saludable celery-worker "$consecuencia"
  esperar_servicio_saludable celery-beat "$consecuencia"
  # Round-trip real, no solo el `Health` cacheado de Docker (que puede tener
  # hasta un `interval` de atraso): un ping de control disparado ACÁ, desde
  # el mismo contenedor backend que encola las tareas reales, prueba que el
  # broker está alcanzable y que el worker sigue respondiendo en este
  # instante. Mínimo razonable para un gate de deploy (no un sistema de
  # monitoreo): un round-trip de encolar-y-esperar una tarea de negocio real
  # tendría efectos secundarios en producción, y agregar una tarea nueva
  # solo para esto es más superficie de la que este chequeo justifica.
  log "Validación: round-trip de celery-worker (ping real al broker)"
  if ! docker compose "${COMPOSE_FILES[@]}" exec -T backend \
      uv run celery -A app.infraestructura.tareas.celery_app inspect ping \
      --timeout "${CELERY_PING_TIMEOUT_SEGUNDOS:-10}" >/dev/null; then
    die "$(printf '%s\n' \
      "celery-worker no respondió al ping de control (broker/cola de" \
      "       tareas). Los avisos de vencimiento, de mora y las bandejas de" \
      "       salida de correo dependen de este worker. Revisá:" \
      "         docker compose ${COMPOSE_FILES[*]} logs celery-worker")"
  fi
}

# Sondea `docker compose ps --format json` hasta ver `Health: healthy` para
# el servicio pedido, o aborta. Un poll acotado -- no una sola lectura -- es
# necesario: justo después de `up -d` el contenedor recién creado está
# `starting` (celery-worker declara `start_period: 90s` porque arranca el
# runtime de uv, importa la app entera y conecta con Redis antes de poder
# contestar el ping), así que una sola lectura fallaría en CADA deploy sano.
# Servicio ausente (nunca llegó a crearse) da `Health` vacío -> mismo
# camino de falla que "unhealthy", no un pase silencioso.
#
# El segundo argumento es la CONSECUENCIA que se imprime al abortar: qué queda
# roto sin ese servicio. Lo aporta cada llamador porque no es la misma para
# celery (tareas asíncronas mudas) que para caddy (el sitio entero fuera de
# línea), y un mensaje genérico no le sirve a nadie a las tres de la mañana.
#
# SIN filtro posicional de servicio (`ps --format json <servicio>`): no es
# un contrato estable entre versiones de Compose, y agregarlo suma un
# segundo modo de falla version-dependiente además del de la forma de
# salida (ver `como_lista` más abajo). Se pide SIEMPRE el listado completo
# y se filtra del lado de Python por el campo `Service`.
#
# `ps --format json` tampoco tiene una forma de salida estable: Compose
# reciente emite JSON Lines (un objeto por línea); versiones más viejas
# emiten un único array JSON. `como_lista` acepta las dos, y cualquier otra
# cosa -- salida vacía, un escalar suelto, basura no-JSON -- resuelve a
# lista vacía en vez de propagar una excepción que mate a python3 (eso
# dejaría `salud` en `""` por la razón EQUIVOCADA -- "no pude interpretar
# la salida" en vez de "el servicio no está sano" -- pero el resultado
# tiene que seguir siendo fail-closed en los dos casos: nunca un pase
# silencioso).
#
# Regla ante más de un registro para el mismo servicio: sano solo si TODOS
# los registros que matchean están 'healthy'. Un solo registro enfermo tira
# abajo el servicio entero, aunque otro luzca bien -- fail-closed también
# ante la ambigüedad de cuál de los dos es "el" contenedor real.
#
# Alcanzabilidad verificada, no supuesta: `ps` (sin `-a`/`--all`, que este
# script nunca pasa) NO lista contenedores `exited` -- `docker compose ps
# --help` es explícito: "-a, --all Show all stopped containers". Un
# contenedor `exited` de un intento previo NO puede producir un segundo
# registro acá; esa justificación era incorrecta y se retira. Tampoco hay
# HOY ningún `deploy.replicas` ni `--scale` para celery-worker/celery-beat
# en ningún compose de este repo (verificado con `rg`). El caso SÍ se
# activaría el día que alguien agregue `deploy.replicas` a
# docker-compose.prod.yml para escalar el worker -- un cambio que no toca
# este script y que nadie tendría motivo de recordar que también le compete
# a este healthcheck. La regla se mantiene (y se fija con tests) porque es
# una comparación de un conjunto, no una feature nueva: barata de conservar,
# cara de perder en silencio si alguien la "simplifica" a `in` en vez de
# `==` -- que es exactamente lo que pasó una vez, sin que ningún test lo
# notara.
esperar_servicio_saludable() {
  local servicio="$1" consecuencia="$2" intentos=0
  local max_intentos="${SERVICIO_HEALTH_MAX_INTENTOS:-30}"
  local intervalo="${SERVICIO_HEALTH_INTERVALO_SEGUNDOS:-5}"
  local salud=""
  command -v python3 >/dev/null 2>&1 || die "falta python3 para verificar la salud de $servicio"
  # `while [ cond ]` (no `[ cond ] && break`): con `set -e`, un `&&` a nivel
  # de sentencia tumba el script entero apenas la condición izquierda es
  # falsa -- el mismo motivo por el que `check_chatbot_config` arma `exigir`
  # con `if`, no con `&&`, un poco más abajo en este archivo.
  while [ "$intentos" -lt "$max_intentos" ]; do
    salud="$(docker compose "${COMPOSE_FILES[@]}" ps --format json 2>/dev/null \
      | python3 -c 'import json, sys


def como_lista(bruto):
    bruto = bruto.strip()
    if not bruto:
        return []
    datos = None
    try:
        datos = json.loads(bruto)
    except Exception:
        datos = None
    if isinstance(datos, list):
        return [item for item in datos if isinstance(item, dict)]
    if isinstance(datos, dict):
        return [datos]
    if datos is not None:
        # Un JSON válido pero de forma inesperada (string, numero, bool,
        # null suelto): no es una lista de contenedores interpretable.
        return []
    # No parseó como un único documento JSON: probar JSON Lines. Cada
    # línea se intenta por separado y las que no parsean se descartan --
    # basura intercalada no debe tumbar a las líneas buenas ni al proceso.
    registros = []
    for linea in bruto.splitlines():
        linea = linea.strip()
        if not linea:
            continue
        try:
            objeto = json.loads(linea)
        except Exception:
            continue
        if isinstance(objeto, dict):
            registros.append(objeto)
    return registros


servicio_pedido = sys.argv[1]
coincidencias = [
    r for r in como_lista(sys.stdin.read()) if r.get("Service") == servicio_pedido
]
if not coincidencias:
    print("")
else:
    estados = {str(r.get("Health", "")) for r in coincidencias}
    print("healthy" if estados == {"healthy"} else ",".join(sorted(estados)))
' "$servicio")"
    if [ "$salud" = "healthy" ]; then
      return 0
    fi
    intentos=$((intentos + 1))
    if [ "$intentos" -lt "$max_intentos" ]; then
      sleep "$intervalo"
    fi
  done
  die "$(printf '%s\n' \
    "$servicio no reportó healthcheck 'healthy' tras $((max_intentos * intervalo))s" \
    "       (último estado: '${salud:-sin healthcheck o el servicio no está corriendo}')." \
    "$consecuencia" \
    "       Revisá:" \
    "         docker compose ${COMPOSE_FILES[*]} ps -a" \
    "         docker compose ${COMPOSE_FILES[*]} logs $servicio")"
}
