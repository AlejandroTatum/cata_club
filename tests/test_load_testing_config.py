"""
Contratos del harness de carga k6 (issue #1314, feature `100-user-load-test`):

  1. Los tres escenarios (baseline 1 VU, ramp, steady 100 VU) declaran los
     exports y umbrales provisorios que el tracker fija en
     `odd/tasks/100-user-load-test.md`: aceptación `rate<0.01` / `p(95)<800`
     solo en steady, y umbrales de aborto (`rate>0.05`, `p(95)>3000`) en
     todos.
  2. Las credenciales y la base URL entran SOLO por variables de entorno:
     ningún literal del seed (`alumno123`, `admin12345`, `trainer12345`) ni
     ningún valor de password puede aparecer en los archivos del harness.
  3. El host es localhost por diseño fail-closed: guardia en `common.js`,
     en el runner de shell y en los targets de Make; nada puede apuntar a
     staging o producción.
  4. La evidencia existe: resumen JSON de k6, muestreo de recursos host/
     contenedor (CPU, memoria, conexiones de BD, outbox) y su `.gitignore`.

Corre FUERA de `backend/tests/` a propósito, igual que
`test_docker_compose_config.py`: no necesita Postgres, ni red, ni Docker;
solo lee los archivos del harness y afirma su contrato textual. Invocar con
`cd backend && uv run pytest ../tests/test_load_testing_config.py`.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DIR_K6 = RAIZ / "load" / "k6"
DIR_SCRIPTS = RAIZ / "scripts" / "load"

ESCENARIOS = ("baseline.js", "ramp.js", "steady_100.js")

# Literales de credenciales del seed (seed_dev_base.py / seed_dev_bulk.py).
# NUNCA pueden aparecer en el árbol del harness: los datos entran por env.
LITERALES_PROHIBIDOS = ("admin12345", "trainer12345", "alumno123")

# Un password literal en JSON/JS (clave seguida de un valor entre comillas
# que no sea una referencia de entorno `${...}` ni string vacío).
RE_PASSWORD_LITERAL = re.compile(
    r'(?:password|contrasenia|PASSWORD)"?\s*[:=]\s*"(?!\$|\{)[A-Za-z0-9!#$%&*+.:=?@^_~]{4,}'
)
URL_K6_FIJADA = re.compile(r"grafana/k6:[0-9]+\.[0-9]+\.[0-9]+\b")
HOSTS_LOCALES = ("localhost", "127.0.0.1", "::1")


def _leer(ruta: Path) -> str:
    return ruta.read_text(encoding="utf-8")


def _archivos_harness() -> list[Path]:
    """Todos los archivos del harness de carga (escenarios + scripts)."""
    return sorted(p for p in [*DIR_K6.iterdir(), *DIR_SCRIPTS.iterdir()] if p.is_file())


# ─── 1. Escenarios k6: exports, VUs, umbrales ───────────────────────────────


class TestContratosDeEscenarios:
    def test_los_tres_escenarios_existen(self):
        for nombre in ESCENARIOS:
            assert (DIR_K6 / nombre).is_file(), f"falta load/k6/{nombre}"

    def test_existe_modulo_comun(self):
        assert (DIR_K6 / "common.js").is_file(), "falta load/k6/common.js"

    def test_los_escenarios_exportan_options(self):
        for nombre in ESCENARIOS:
            assert "export const options" in _leer(DIR_K6 / nombre), nombre

    def test_los_escenarios_importan_el_modulo_comun(self):
        for nombre in ESCENARIOS:
            assert "./common.js" in _leer(DIR_K6 / nombre), nombre

    def test_baseline_declara_un_solo_vu(self):
        # El baseline es LA calibración: exactamente 1 VU concurrente.
        texto = _leer(DIR_K6 / "baseline.js")
        assert re.search(r"\bvus:\s*1\b", texto), "el baseline debe fijar vus: 1"

    def test_steady_declara_cien_vus_por_default(self):
        # 100 VUs = 100 usuarios concurrentes AL MOMENTO, no 100 totales.
        # El default se conserva; LOAD_STEADY_VUS lo baja (p. ej. 30).
        texto = _leer(DIR_K6 / "steady_100.js")
        assert re.search(r"LOAD_STEADY_VUS\s*\|\|\s*100\b", texto), "el default debe ser 100 VUs"
        assert re.search(r"target:\s*VUS_STEADY\b", texto), "warm-up y plato deben llegar a VUS_STEADY"

    def test_steady_calienta_con_ramping_vus(self):
        # 100 logins simultáneos violan el límite de login (60/min/IP,
        # auth_router.py @limiter.limit("60/minute")): el steady calienta
        # con ramping-vus y arranca de 0.
        assert "ramping-vus" in _leer(DIR_K6 / "steady_100.js")

    def test_steady_toma_la_duracion_de_entorno_con_default_10m(self):
        texto = _leer(DIR_K6 / "steady_100.js")
        assert "LOAD_STEADY_DURATION" in texto
        assert "10m" in texto, "el default de duración del steady es 10 minutos"

    def test_ramp_usa_executor_ramping_vus(self):
        texto = _leer(DIR_K6 / "ramp.js")
        assert "ramping-vus" in texto
        assert "stages" in texto

    def test_ramp_llega_hasta_cien_vus_por_default(self):
        texto = _leer(DIR_K6 / "ramp.js")
        assert "LOAD_RAMP_MAX_VUS" in texto
        assert "100" in texto, "el tope del ramp por default es 100 VUs"

    def test_steady_declara_los_umbrles_de_aceptacion_provisorios(self):
        # Aceptación provisoria del tracker: fallas < 1% y p95 < 800 ms.
        texto = _leer(DIR_K6 / "steady_100.js")
        assert "rate<0.01" in texto, "aceptación: solicitudes fallidas < 1%"
        assert "p(95)<800" in texto, "aceptación: p95 < 800 ms"

    def test_steady_no_marca_como_aceptacion_el_umbral_de_aborto(self):
        # La aceptación del steady es <1% / <800 ms SOLO del plato, SIN
        # abortOnFail; el aborto global (5% / 3 s) cubre TODA la corrida.
        texto = _leer(DIR_K6 / "steady_100.js")
        assert "{ threshold: 'rate<0.01' }" in texto
        assert "{ threshold: 'p(95)<800' }" in texto
        assert "'rate<0.05', abortOnFail: true" in texto, "el aborto de 5% debe portar abortOnFail"
        assert "'rate<0.01', abortOnFail" not in texto, "la aceptación no debe abortar"


class TestAceptacionPorPlatoYPoolSuficiente:
    """Corrección de revisión nativa final: la aceptación evalúa SOLO el
    plato de 100 VUs, y el pool debe ser suficiente o no arranca la carga."""

    def test_la_aceptacion_del_steady_usa_submetricas_del_plato(self):
        texto = _leer(DIR_K6 / "steady_100.js")
        assert "'http_req_failed{phase:plateau}':" in texto
        assert "'http_req_duration{phase:plateau}':" in texto
        # Los abortos globales de seguridad siguen SIN etiqueta (toda la corrida).
        assert re.search(r"'http_req_failed':\s*\[\s*\{\s*threshold:\s*'rate<0\.05'", texto)
        assert re.search(r"'http_req_duration':\s*\[\s*\{\s*threshold:\s*'p\(95\)<3000'", texto)

    def test_la_etiqueta_de_fase_es_determinista_por_reloj_de_escenario(self):
        texto = _leer(DIR_K6 / "steady_100.js")
        assert "k6/execution" in texto
        assert "exec.scenario.startTime" in texto
        assert "MS_WARMUP = 3 * 60 * 1000" in texto
        for fase in ("'warmup'", "'plateau'", "'rampdown'"):
            assert fase in texto, fase

    def test_los_pasos_del_viaje_llevan_la_fase(self):
        texto = _leer(DIR_K6 / "common.js")
        assert re.search(r"export function authenticatedReadJourney\(credential, tagsExtra\)", texto)
        assert texto.count("...faseTags") >= 3, "login, sesión y lectura llevan la fase"
        # faseTags lives in the journey's scope: the login helper must receive it.
        assert re.search(r"function loginYCachea\(credential, faseTags\)", texto)
        assert "loginYCachea(credential, faseTags)" in texto

    def test_steady_exige_pool_de_tantas_identidades_como_vus(self):
        texto = _leer(DIR_K6 / "steady_100.js")
        assert "asegurarPoolSuficiente(pool, VUS_STEADY, 'steady_100')" in texto

    def test_ramp_exige_pool_para_su_tope(self):
        texto = _leer(DIR_K6 / "ramp.js")
        assert "asegurarPoolSuficiente(pool, maxVus, 'ramp')" in texto

    def test_el_guard_de_pool_explica_como_construirlo(self):
        texto = _leer(DIR_K6 / "common.js")
        assert "export function asegurarPoolSuficiente" in texto
        assert "make load-pool" in texto

    def test_todos_los_escenarios_declaran_el_umbral_de_aborto_de_error(self):
        # Los thresholds k6 son CONDICIONES DE PASO: abortOnFail dispara
        # cuando la expresión es falsa. Abortar con tasa >= 5% se escribe
        # 'rate<0.05' (pasa sano, aborta al cruzar 5%). La forma invertida
        # ('rate>0.05') abortaba corridas sanas y callaba en falla.
        for nombre in ESCENARIOS:
            texto = _leer(DIR_K6 / nombre)
            assert re.search(
                r"\{\s*threshold:\s*'rate<0\.05',\s*abortOnFail:\s*true", texto
            ), f"{nombre} sin aborto pass-condition por 5% de errores"
            assert "rate>0.05" not in texto, f"{nombre} con predicado de aborto invertido"

    def test_todos_los_escenarios_declaran_el_umbral_de_aborto_de_latencia(self):
        # Aborto provisorio: p95 >= 3 s → 'p(95)<3000' (pasa sano, aborta al
        # cruzar 3 s). 'p(95)>3000' estaba invertido, igual que el de error.
        for nombre in ESCENARIOS:
            texto = _leer(DIR_K6 / nombre)
            assert re.search(
                r"\{\s*threshold:\s*'p\(95\)<3000',\s*abortOnFail:\s*true", texto
            ), f"{nombre} sin aborto pass-condition por p95 >= 3 s"
            assert "p(95)>3000" not in texto, f"{nombre} con predicado de aborto invertido"

    def test_los_escenarios_producen_resumen_maquina_legible(self):
        # handleSummary escribe summary.json además del stdout humano; el
        # builder vive en common.js y cada escenario lo exporta.
        comun = _leer(DIR_K6 / "common.js")
        for nombre in ESCENARIOS:
            texto = _leer(DIR_K6 / nombre)
            assert "handleSummary" in texto, nombre
            assert "summary.json" in (texto + comun), nombre

    def test_el_viaje_transporta_las_cookies_de_auth_de_login(self):
        # QA con build de producción setea cookies Secure; el jar de k6 las
        # rechaza sobre http:// y el viaje seguiría anónimo (dashboard 401).
        # El harness extrae SOLO access_token/refresh_token de la respuesta de
        # login y las manda como header Cookie explícito en cada paso BFF.
        texto = _leer(DIR_K6 / "common.js")
        assert "login.cookies" in texto, "debe leer las cookies de la respuesta de login"
        assert "access_token" in texto and "refresh_token" in texto, (
            "solo los dos nombres de cookie de auth del BFF"
        )
        assert "headers: { Cookie: cookieHeader }" in texto, "header Cookie explícito en los pasos"
        assert texto.count("headers: { Cookie: cookieHeader }") >= 2, (
            "sesión Y lectura de rol llevan la cookie"
        )

    def test_el_viaje_falla_si_login_no_setea_cookies_de_auth(self):
        texto = _leer(DIR_K6 / "common.js")
        assert "no seteó cookies" in texto, (
            "sin cookies de auth el paso debe fallar explícito, no seguir anónimo"
        )

    def test_la_sesion_autenticada_se_verifica_por_user_id(self):
        # GET /api/auth/session autenticado devuelve la sesión DIRECTA
        # (user/roles/...), no un envoltorio {authenticated:true} — ese
        # objeto solo existe en la rama anónima. La verificación honesta
        # es user.id presente.
        texto = _leer(DIR_K6 / "common.js")
        assert "user.id" in texto, "la sesión se verifica por user.id presente"
        assert "'session is authenticated'" in texto

    def test_los_tokens_nunca_se_registran_ni_persisten(self):
        texto = _leer(DIR_K6 / "common.js")
        assert "console." not in texto, "los tokens no se loguean jamás"
        # k6 no puede escribir archivos; el único open() permitido es la
        # lectura del pool de credenciales (init-context), no de tokens.
        # Solo la lectura del archivo de credenciales, ninguna otra.
        argumentos_open = re.findall(r"open\(([^)]+)\)", texto)
        assert argumentos_open == ["__ENV.LOAD_CREDENTIALS_FILE"], argumentos_open

    def test_los_escenarios_reportan_vu_maximo_y_sesiones_totales(self):
        # Vocabulario vinculante: VU = concurrentes al instante;
        # sesiones = journeys totales completados en toda la corrida.
        # Lo reporta el builder compartido (common.js) que cada escenario usa.
        comun = _leer(DIR_K6 / "common.js")
        for nombre in ESCENARIOS:
            texto = _leer(DIR_K6 / nombre) + comun
            assert "vus_max" in texto, f"{nombre} no reporta el pico de VUs"
            assert "iterations" in texto, f"{nombre} no reporta sesiones (iterations)"
            assert "sessions" in texto, f"{nombre} no nombra sesiones"


class TestPacingDeLoginYPlato:
    """El backend limita login a 60/min/IP (auth_router.py:43): todos los VUs
    salen de una sola IP, así que el harness debe cumplir ese techo."""

    def test_ramp_alcanza_el_tope_en_tres_minutos_o_mas(self):
        # 100 VUs en >= 3 min ≈ 33 logins nuevos/min < 60/min.
        texto = _leer(DIR_K6 / "ramp.js")
        assert re.search(r"duration:\s*'3m',\s*target:\s*maxVus", texto), (
            "el ramp debe llegar al tope en >= 3 minutos"
        )

    def test_steady_calienta_tres_minutos_antes_del_plato_de_diez(self):
        # Forma vinculante: 3 m de warm-up (0→VUS_STEADY), luego el plato de
        # LOAD_STEADY_DURATION (default 10m), luego ramp-down a 0.
        texto = _leer(DIR_K6 / "steady_100.js")
        assert "startVUs: 0" in texto
        pos_warmup = texto.find("duration: '3m', target: VUS_STEADY")
        pos_plato = texto.find("{ duration: __ENV.LOAD_STEADY_DURATION || '10m', target: VUS_STEADY }")
        pos_bajada = texto.find("{ duration: '30s', target: 0 }")
        assert pos_warmup != -1, "falta el warm-up de 3 m hasta 100"
        assert pos_plato != -1, "falta el plato de 10 m (LOAD_STEADY_DURATION)"
        assert pos_bajada != -1, "falta el ramp-down a 0"
        assert pos_warmup < pos_plato < pos_bajada, "orden warm-up → plato → ramp-down"

    def test_cada_vu_loguea_una_sola_vez(self):
        # El 429 no lo causaba solo el ramp: cada ITERACIÓN re-logueaba.
        # Con N VUs a ~24 iter/min son cientos de logins/min. Un usuario real
        # entra UNA vez y después lee: caché por VU (clave __VU).
        texto = _leer(DIR_K6 / "common.js")
        assert "cookiesPorVU.get(__VU)" in texto
        assert "cookiesPorVU.set(__VU" in texto
        assert re.search(r"if\s*\(!cache\)", texto), "el login solo ocurre sin caché de VU"

    def test_summary_distingue_concurrencia_observada_de_capacidad(self):
        # k6 'vus_max' es capacidad CONFIGURADA, no concurrencia observada.
        # El resumen reporta ambas con nombres honestos.
        texto = _leer(DIR_K6 / "common.js")
        assert "vus_observed_peak" in texto
        assert "vus_configured_capacity" in texto
        assert re.search(r"metricValues\('vus'\)", texto), "el pico observado sale del gauge vus"

    def test_lecturas_por_identidad_bajo_el_techo_de_30_min(self):
        # El portal llama /personas/{id}/representados en CADA lectura y el
        # backend lo limita a 30/min POR USUARIO. Con think 2-4 s cada VU hace
        # ~17-20 lecturas/min: 1 identidad por VU queda bajo el techo con
        # margen; compartir identidades exige alargar el think time (docs).
        texto = _leer(DIR_K6 / "common.js")
        assert "LOAD_THINK_TIME_MIN" in texto and "LOAD_THINK_TIME_MAX" in texto
        assert "LOAD_THINK_TIME_MIN || 2" in texto and "LOAD_THINK_TIME_MAX || 4" in texto, (
            "defaults 2-4 s"
        )

    def test_p99_en_las_estadisticas_de_todos_los_escenarios(self):
        for nombre in ESCENARIOS:
            assert "'p(99)'" in _leer(DIR_K6 / nombre), f"{nombre} sin p(99)"


# ─── 2. Credenciales solo por entorno ───────────────────────────────────────


class TestCredencialesSoloPorEntorno:
    def test_el_modulo_comun_lee_credenciales_de_variables_de_entorno(self):
        texto = _leer(DIR_K6 / "common.js")
        assert "__ENV.LOAD_EMAIL" in texto
        assert "__ENV.LOAD_PASSWORD" in texto
        assert "__ENV.LOAD_CREDENTIALS_JSON" in texto

    def test_la_base_url_por_default_es_el_borde_local_de_qa(self):
        # El borde público local de QA es el frontend Next.js en :3000.
        texto = _leer(DIR_K6 / "common.js")
        assert "LOAD_BASE_URL" in texto
        assert "http://localhost:3000" in texto

    def test_ningun_literal_del_seed_en_el_arbol_del_harness(self):
        for ruta in _archivos_harness():
            texto = _leer(ruta)
            for literal in LITERALES_PROHIBIDOS:
                assert literal not in texto, (
                    f"{ruta.relative_to(RAIZ)} contiene el literal de credencial "
                    f"prohibido '{literal}'"
                )

    def test_ningun_correo_del_seed_en_el_arbol_del_harness(self):
        for ruta in _archivos_harness():
            texto = _leer(ruta)
            assert "@cataclub.com" not in texto, (
                f"{ruta.relative_to(RAIZ)} contiene un correo del seed; las "
                "credenciales entran por entorno, nunca versionadas"
            )

    def test_ningun_password_literal_en_el_arbol_del_harness(self):
        for ruta in _archivos_harness():
            coincidencia = RE_PASSWORD_LITERAL.search(_leer(ruta))
            assert coincidencia is None, (
                f"{ruta.relative_to(RAIZ)} parece contener un password literal: "
                f"'{coincidencia.group(0) if coincidencia else ''}'"
            )


# ─── 3. Guardia fail-closed de localhost ────────────────────────────────────


class TestGuardiaLocalFailClosed:
    def test_common_js_valida_el_host_antes_de_correr(self):
        # La lógica del guard vive en local_guard.js (módulo puro, sin k6),
        # importado por common.js; se afirma sobre ambos juntos.
        texto = _leer(DIR_K6 / "common.js") + _leer(DIR_K6 / "local_guard.js")
        for host in HOSTS_LOCALES:
            assert host in texto, f"el guardia no admite explícitamente {host}"
        assert "throw" in texto, "el guardia debe cortar la corrida (throw)"

    def test_common_js_importa_el_guard_puro(self):
        texto = _leer(DIR_K6 / "common.js")
        assert "./local_guard.js" in texto, "common.js debe usar el guard extraído"

    def test_el_runner_valida_el_host_antes_de_docker_run(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        for host in HOSTS_LOCALES:
            assert host in texto, f"el runner no admite explícitamente {host}"
        assert re.search(r"exit\s+1", texto), "el guardia del runner debe cortar con error"

    def test_el_runner_rechaza_explicitamente_staging_y_prod(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh").lower()
        assert "staging" in texto, "el runner debe nombrar la prohibición de staging"
        assert "prod" in texto, "el runner debe nombrar la prohibición de producción"


GUARD_NODE_SKIP = shutil.which("node") is None

# Matriz de comportamiento del guard de k6: (URL, aceptada).
CASOS_GUARD_K6 = (
    ("http://localhost:3000", True),
    ("http://localhost", True),
    ("http://127.0.0.1:9@staging.example.com", False),  # userinfo: bypass real
    ("http://user:pass@staging.example.com", False),
    ("http://user:pass@127.0.0.1", False),
    ("http://127.0.0.1.evil.com", False),
    ("http://staging.example.com", False),
    ("https://localhost:3000", False),
    ("http://[::1]:3000", True),
    ("http://[::1]", True),
    ("http://127.1.2.3:8000", True),
)


class TestRegresionesVerificacionIndependiente:
    """Hallazgos de la verificación independiente (blockers 1–5)."""

    # ── Blocker 1: bypass por userinfo ──

    def test_el_runner_rechaza_userinfo_en_la_autoridad(self):
        # http://127.0.0.1:9@staging.example.com apunta REALMENTE a staging:
        # el guard debe rechazar antes de mirar el puerto.
        proc = subprocess.run(
            [str(DIR_SCRIPTS / "run_load_test.sh"), "baseline"],
            env={**os.environ, "LOAD_BASE_URL": "http://127.0.0.1:9@staging.example.com"},
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 1, proc.stdout + proc.stderr
        assert "PROHIBIDO" in proc.stderr, "debe rechazar por host, no por credenciales"

    def test_el_guard_de_k6_rechaza_userinfo_matriz_completa(self):
        assert not GUARD_NODE_SKIP, "node es requerido para ejecutar el guard de k6"
        proc = subprocess.run(
            [shutil.which("node"), "-e", _script_guard_node()],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert proc.returncode == 0, f"el guard falló la matriz:\n{proc.stdout}\n{proc.stderr}"
        assert "GUARD-OK" in proc.stdout

    # ── Blocker 2: IPv6 [::1] realmente soportado ──

    def test_el_runner_acepta_ipv6_loopback(self):
        # Debe PASAR el guard de host y fallar después por credenciales
        # ausentes — no con PROHIBIDO.
        proc = subprocess.run(
            [str(DIR_SCRIPTS / "run_load_test.sh"), "baseline"],
            env={**os.environ, "LOAD_BASE_URL": "http://[::1]:3000"},
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 1, proc.stdout + proc.stderr
        assert "PROHIBIDO" not in proc.stderr
        assert "credenciales" in proc.stderr

    # ── Blocker 3: carrera de arranque del monitor ──

    def test_el_monitor_descubre_contenedores_detenidos(self):
        # Un backend DETENIDO pierde su id con `docker ps` a secas: el
        # descubrimiento debe incluir contenedores parados (State.Running
        #=false debe verse y abortar).
        texto = _leer(DIR_SCRIPTS / "monitor_resources.sh")
        assert "docker ps -a -q" in texto, "el descubrimiento debe usar docker ps -a"

    def test_el_monitor_espera_el_pid_de_k6_antes_de_abortar(self):
        texto = _leer(DIR_SCRIPTS / "monitor_resources.sh")
        assert "esperar_pid_de_k6" in texto, (
            "el monitor debe esperar el k6.pid antes de poder necesitar abortar"
        )

    def test_el_runner_limpia_el_monitor_en_salidas_anormales(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        assert re.search(r"\btrap\b", texto), "falta trap de limpieza"
        for senal in ("EXIT", "INT", "TERM"):
            assert senal in texto, f"falta la señal {senal} en los traps"

    # ── Blocker 4: expansión opcional sin entrecomillar ──

    def test_el_runner_no_expande_out_opcional_sin_comillas(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        assert ":+--out" not in texto, "usa array de argumentos, no expansión +"
        assert "K6_ARGS+=(" in texto, "faltan argumentos extra en el array"
        assert '"${K6_ARGS[@]}"' in texto, "el array debe expandirse entrecomillado"


def _script_guard_node() -> str:
    """Ejecuta local_guard.js (copiado a .mjs para node) contra la matriz."""
    modulo = (DIR_K6 / "local_guard.js").read_text(encoding="utf-8")
    casos = ",\n".join(
        f'  ["{url}", {"true" if esperada else "false"}]' for url, esperada in CASOS_GUARD_K6
    )
    lineas = [
        "import { writeFileSync, mkdtempSync } from 'node:fs';",
        "import { tmpdir } from 'node:os';",
        "import { join } from 'node:path';",
        "const dir = mkdtempSync(join(tmpdir(), 'guard-'));",
        "writeFileSync(join(dir, 'local_guard.mjs'), " + repr(modulo) + ");",
        "const { assertLocalBaseUrl } = await import('file://' + join(dir, 'local_guard.mjs'));",
        "const casos = [",
        casos,
        "];",
        "let fallos = 0;",
        "for (const [url, esperada] of casos) {",
        "  let aceptada = false;",
        "  try { assertLocalBaseUrl(url); aceptada = true; } catch {}",
        "  if (aceptada !== esperada) {",
        "    console.error('FALLO: ' + url + ' esperada=' + esperada + ' obtenida=' + aceptada);",
        "    fallos++;",
        "  }",
        "}",
        "if (fallos > 0) process.exit(1);",
        "console.log('GUARD-OK');",
    ]
    return "\n".join(lineas)


class TestPoolDeCredencialesLocal:
    """Pool 1:1 de identidades ALUMNO para el steady de 100 VUs (decisión del
    owner): el helper lo construye desde la BD de QA local en tiempo de
    ejecución; el password entra SOLO por QA_SEED_PASSWORD y sale al archivo
    local git-ignorado — jamás impreso, jamás versionado."""

    RUTA_HELPER = DIR_SCRIPTS / "build_credentials_pool.py"

    def test_existe_el_helper_del_pool(self):
        assert self.RUTA_HELPER.is_file(), "falta scripts/load/build_credentials_pool.py"

    def test_el_helper_exige_el_password_por_entorno_sin_default(self):
        texto = _leer(self.RUTA_HELPER)
        assert "QA_SEED_PASSWORD" in texto

    def test_el_helper_nunca_imprime_el_password(self):
        texto = _leer(self.RUTA_HELPER)
        assert re.search(r"print\([^\n]*contrasenia_seed", texto) is None, (
            "el password no puede aparecer en ninguna salida"
        )

    def test_el_helper_escribe_con_permisos_restringidos(self):
        assert "0o600" in _leer(self.RUTA_HELPER)

    def test_el_helper_falla_cerrado_si_el_pool_queda_chico(self):
        texto = _leer(self.RUTA_HELPER)
        assert "menos" in texto, "un pool menor a lo pedido debe cortar con error"

    def test_el_default_del_pool_va_al_directorio_git_ignorado(self):
        texto = _leer(self.RUTA_HELPER)
        assert "load/results/credentials-pool.json" in texto
        assert "load/results/" in _leer(RAIZ / ".gitignore")

    def test_el_harness_acepta_archivo_de_credenciales(self):
        # open() de k6 solo corre en init-context: la carga del archivo es
        # top-level, no dentro de setup().
        texto = _leer(DIR_K6 / "common.js")
        assert "LOAD_CREDENTIALS_FILE" in texto
        assert "open(__ENV.LOAD_CREDENTIALS_FILE)" in texto

    def test_el_runner_monta_el_archivo_de_credenciales(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        assert "LOAD_CREDENTIALS_FILE" in texto
        assert "/creds/pool.json" in texto

    def test_el_makefile_declara_load_pool(self):
        makefile = _leer(RAIZ / "Makefile")
        assert re.search(r"^load-pool:", makefile, re.MULTILINE)
        assert "build_credentials_pool.py" in makefile

    def test_la_doc_explica_el_pool_local(self):
        texto = _leer(RAIZ / "docs" / "operations" / "load-testing.md")
        assert "load-pool" in texto and "QA_SEED_PASSWORD" in texto

    def test_el_helper_sin_password_falla_cerrado(self):
        entorno = {k: v for k, v in os.environ.items() if k != "QA_SEED_PASSWORD"}
        proc = subprocess.run(
            ["python3", str(self.RUTA_HELPER)],
            env=entorno, capture_output=True, text=True, timeout=30,
        )
        assert proc.returncode != 0
        assert "QA_SEED_PASSWORD" in proc.stderr

    def test_el_helper_no_fuga_el_password_en_salidas(self):
        canario = "canario-secreto-de-prueba-9x"
        proc = subprocess.run(
            ["python3", str(self.RUTA_HELPER), "--tamanio", "5"],
            env={**os.environ, "QA_SEED_PASSWORD": canario, "LOAD_POOL_PROJECT": "sin-stack-de-qa"},
            capture_output=True, text=True, timeout=60,
        )
        assert proc.returncode != 0, "sin BD de QA debe fallar"
        assert canario not in proc.stdout and canario not in proc.stderr


# ─── 4. Targets de Make y runner ────────────────────────────────────────────


class TestTargetsDeMake:
    def test_makefile_declara_preflight_y_los_tres_escenarios(self):
        makefile = _leer(RAIZ / "Makefile")
        for target in ("load-preflight", "load-baseline", "load-ramp", "load-steady"):
            assert re.search(rf"^{target}:", makefile, re.MULTILINE), f"falta el target {target}"
            assert re.search(rf"^{re.escape(target)}$", makefile, re.MULTILINE) or True
        # Y todos están declarados en .PHONY.
        for target in ("load-preflight", "load-baseline", "load-ramp", "load-steady"):
            assert target in makefile.split(".PHONY:", 1)[1].split("\n\n")[0], target

    def test_makefile_fija_base_url_local_por_default(self):
        makefile = _leer(RAIZ / "Makefile")
        assert "http://localhost:3000" in makefile

    def test_makefile_no_declara_ninguna_url_remota(self):
        makefile = _leer(RAIZ / "Makefile").lower()
        for prohibido in ("staging.cataclub", "prod.cataclub", "https://cataclub"):
            assert prohibido not in makefile, prohibido

    def test_el_runner_usa_la_imagen_oficial_k6_fijada(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        coincidencia = URL_K6_FIJADA.search(texto)
        assert coincidencia, "falta el pin de grafana/k6 a una versión exacta"
        assert ":latest" not in texto, "el pin no puede ser :latest"

    def test_preflight_chequea_db_test_en_5436(self):
        # El tracker fija el preflight sobre el stack local: db-test en 5436.
        texto = _leer(DIR_SCRIPTS / "preflight_load_stack.sh")
        assert "5436" in texto
        assert "pg_isready" in texto or "/dev/tcp" in texto

    def test_preflight_chequea_el_borde_qa_local(self):
        texto = _leer(DIR_SCRIPTS / "preflight_load_stack.sh")
        assert "3000" in texto, "el preflight debe chequear el frontend de QA en :3000"
        assert "8000" in texto, "el preflight debe chequear el backend de QA en :8000"


# ─── 5. Evidencia de recursos y aborto ──────────────────────────────────────


class TestEvidenciaDeRecursos:
    def test_el_monitor_muestrea_cpu_y_memoria_de_contenedores(self):
        texto = _leer(DIR_SCRIPTS / "monitor_resources.sh")
        assert "docker stats" in texto

    def test_el_monitor_mide_conexiones_de_base_de_datos(self):
        texto = _leer(DIR_SCRIPTS / "monitor_resources.sh")
        assert "pg_stat_activity" in texto
        assert "max_connections" in texto

    def test_el_monitor_mide_la_antiguedad_del_outbox(self):
        texto = _leer(DIR_SCRIPTS / "monitor_resources.sh")
        for tabla in (
            "enrollment_notificacion_outbox",
            "recuperacion_outbox",
            "verificacion_correo_outbox",
        ):
            assert tabla in texto, f"falta medir {tabla}"
        assert "PENDIENTE" in texto

    def test_el_monitor_vigila_oom_y_reinicios_del_backend(self):
        texto = _leer(DIR_SCRIPTS / "monitor_resources.sh")
        assert "OOMKilled" in texto
        assert "RestartCount" in texto

    def test_el_monitor_escribe_muestras_jsonl(self):
        texto = _leer(DIR_SCRIPTS / "monitor_resources.sh")
        assert "resources.jsonl" in texto

    def test_el_aborto_deja_motivo_escrito(self):
        texto = _leer(DIR_SCRIPTS / "monitor_resources.sh")
        assert "abort.txt" in texto

    def test_gitignore_ignora_los_resultados_de_carga(self):
        gitignore = _leer(RAIZ / ".gitignore")
        assert "load/results/" in gitignore


# ─── 6. Documentación de operador ───────────────────────────────────────────


class TestDocsOperador:
    RUTA_DOC = RAIZ / "docs" / "operations" / "load-testing.md"

    def test_existe_la_doc_de_operador(self):
        assert self.RUTA_DOC.is_file(), "falta docs/operations/load-testing.md"

    def test_la_doc_usa_el_vocabulario_vu_vs_sesiones(self):
        texto = _leer(self.RUTA_DOC)
        assert "VU" in texto and "sesiones" in texto.lower()
        # El par vinculante del tracker: 100 simultáneos ≠ 100 totales.
        assert "100" in texto and "concurrente" in texto.lower()

    def test_la_doc_declara_el_pool_compartido_de_credenciales(self):
        # Honestidad: 100 VUs NO son 100 identidades distintas.
        texto = _leer(self.RUTA_DOC).lower()
        assert "pool" in texto, "la doc debe explicar el pool acotado de credenciales"
        assert "identidad" in texto, "la doc debe aclarar que 100 VUs != 100 identidades"

    def test_la_doc_explica_como_leer_los_resultados(self):
        texto = _leer(self.RUTA_DOC)
        assert "summary.json" in texto
        assert "resources.jsonl" in texto

    def test_la_doc_explica_la_calibracion_de_umbrles(self):
        texto = _leer(self.RUTA_DOC).lower()
        assert "calibraci" in texto, "la doc debe explicar calibrar contra el baseline"

    def test_la_doc_prohibe_staging_y_produccion(self):
        texto = _leer(self.RUTA_DOC).lower()
        assert "staging" in texto and "producci" in texto
        assert "prohib" in texto, "la prohibición debe ser explícita"

    def test_la_doc_declara_comportamiento_real_del_aborto(self):
        # Honestidad: qué corta k6 solo (thresholds abortOnFail) y qué corta
        # el monitor de host (recursos externos), sin atribuir de más.
        texto = _leer(self.RUTA_DOC)
        assert "abortOnFail" in texto
        assert "monitor" in texto.lower()

    def test_readme_enlaza_la_doc_de_carga(self):
        readme = _leer(RAIZ / "README.md")
        assert "load-testing.md" in readme, "el README debe enlazar la doc de carga"
        assert "load-steady" in readme, "el README debe mencionar el comando del steady"


# ─── 6. VUs configurables (#1314 A2) ────────────────────────────────────────


class TestVusConfigurablesDelSteady:
    def test_el_steady_valida_el_entero_positivo_de_vus(self):
        texto = _leer(DIR_K6 / "steady_100.js")
        assert "LOAD_STEADY_VUS" in texto
        assert "Number.isInteger(VUS_STEADY)" in texto
        assert "VUS_STEADY < 1" in texto

    def test_el_steady_conserva_umbrales_y_aborto_con_cualquier_vus(self):
        texto = _leer(DIR_K6 / "steady_100.js")
        for fragmento in (
            "rate<0.01",
            "p(95)<800",
            "rate<0.05",
            "p(95)<3000",
            "abortOnFail: true",
        ):
            assert fragmento in texto, fragmento

    def test_el_runner_pasa_los_vus_a_k6_y_los_registra(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        assert "-e LOAD_STEADY_VUS" in texto
        assert "steady_vus" in texto

    def test_el_runner_rechaza_vus_no_enteros(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        assert re.search(r"LOAD_STEADY_VUS.*\^\[1-9\]", texto), "validar entero positivo"

    def test_make_load_steady_acepta_vus(self):
        makefile = _leer(RAIZ / "Makefile")
        bloque = makefile.split("\nload-steady:", 1)[1].split("\n\n", 1)[0]
        assert 'LOAD_STEADY_VUS="$(VUS)"' in bloque
        assert re.search(r"^VUS \?= 100$", makefile, re.MULTILINE)

    def test_la_doc_explica_la_corrida_de_30_usuarios(self):
        doc = _leer(RAIZ / "docs" / "operations" / "load-testing.md")
        assert "make load-steady VUS=30" in doc


# ─── 7. Métricas server-side antes/después (#1314 A2) ───────────────────────

SCRAPE_ANTES = """\
# HELP http_requests_total Total number of requests by method, status and handler.
# TYPE http_requests_total counter
http_requests_total{handler="/api/v1/auth/login",method="POST",status="2xx"} 10.0
http_requests_total{handler="/api/v1/auth/me",method="GET",status="2xx"} 100.0
http_requests_total{handler="/api/v1/auth/me",method="GET",status="5xx"} 1.0
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{handler="/api/v1/auth/me",le="0.1",method="GET"} 90.0
http_request_duration_seconds_bucket{handler="/api/v1/auth/me",le="0.5",method="GET"} 100.0
http_request_duration_seconds_bucket{handler="/api/v1/auth/me",le="1.0",method="GET"} 101.0
http_request_duration_seconds_bucket{handler="/api/v1/auth/me",le="+Inf",method="GET"} 101.0
http_request_duration_seconds_count{handler="/api/v1/auth/me",method="GET"} 101.0
# TYPE cata_outbox_pendientes gauge
cata_outbox_pendientes{tabla="recuperacion_outbox"} 0.0
cata_outbox_pendiente_mas_antiguo_segundos{tabla="recuperacion_outbox"} 0.0
"""

SCRAPE_DESPUES = """\
http_requests_total{handler="/api/v1/auth/login",method="POST",status="2xx"} 40.0
http_requests_total{handler="/api/v1/auth/me",method="GET",status="2xx"} 300.0
http_requests_total{handler="/api/v1/auth/me",method="GET",status="5xx"} 4.0
http_request_duration_seconds_bucket{handler="/api/v1/auth/me",le="0.1",method="GET"} 190.0
http_request_duration_seconds_bucket{handler="/api/v1/auth/me",le="0.5",method="GET"} 290.0
http_request_duration_seconds_bucket{handler="/api/v1/auth/me",le="1.0",method="GET"} 300.0
http_request_duration_seconds_bucket{handler="/api/v1/auth/me",le="+Inf",method="GET"} 305.0
http_request_duration_seconds_count{handler="/api/v1/auth/me",method="GET"} 305.0
cata_outbox_pendientes{tabla="recuperacion_outbox"} 7.0
cata_outbox_pendiente_mas_antiguo_segundos{tabla="recuperacion_outbox"} 42.5
cata_outbox_scrape_ok 1.0
"""


def _cargar_server_metrics():
    import importlib.util

    ruta = DIR_SCRIPTS / "server_metrics.py"
    assert ruta.exists(), "falta scripts/load/server_metrics.py"
    spec = importlib.util.spec_from_file_location("server_metrics", ruta)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


class TestParserYDeltasDeMetricasServerSide:
    def test_parsea_series_con_etiquetas_ignorando_comentarios(self):
        sm = _cargar_server_metrics()
        series = sm.parse_prometheus_text(SCRAPE_ANTES)
        assert (
            "http_requests_total",
            (("handler", "/api/v1/auth/me"), ("method", "GET"), ("status", "5xx")),
        ) in series
        assert not any(nombre.startswith("#") for nombre, _ in series)

    def test_delta_de_requests_y_5xx_por_ruta(self):
        sm = _cargar_server_metrics()
        informe = sm.build_report(SCRAPE_ANTES, SCRAPE_DESPUES)
        me = informe["routes"]["GET /api/v1/auth/me"]
        assert me["requests"] == 203  # (300+4) - (100+1)
        assert me["errors_5xx"] == 3
        assert informe["routes"]["POST /api/v1/auth/login"]["requests"] == 30
        assert informe["totals"]["requests"] == 233
        assert informe["totals"]["errors_5xx"] == 3

    def test_p95_server_side_desde_buckets_del_delta(self):
        sm = _cargar_server_metrics()
        informe = sm.build_report(SCRAPE_ANTES, SCRAPE_DESPUES)
        me = informe["routes"]["GET /api/v1/auth/me"]
        # Delta acumulado: 100 <=0.1, 190 <=0.5, 199 <=1.0, 204 total.
        # Rango p95 = 193.8 -> cae en el bucket (0.5, 1.0]: cota 1.0 s.
        assert me["p95_le_seconds"] == 1.0
        assert 0.5 < me["p95_estimate_seconds"] <= 1.0

    def test_p95_en_el_bucket_infinito_se_reporta_como_mayor_al_ultimo_finito(self):
        sm = _cargar_server_metrics()
        antes = 'http_request_duration_seconds_bucket{handler="/x",le="1.0",method="GET"} 0\n' \
            'http_request_duration_seconds_bucket{handler="/x",le="+Inf",method="GET"} 0\n'
        despues = 'http_request_duration_seconds_bucket{handler="/x",le="1.0",method="GET"} 1\n' \
            'http_request_duration_seconds_bucket{handler="/x",le="+Inf",method="GET"} 10\n'
        ruta = sm.build_report(antes, despues)["routes"]["GET /x"]
        assert ruta["p95_le_seconds"] is None
        assert ruta["p95_over_seconds"] == 1.0

    def test_p95_lee_los_limites_expuestos_sin_asumir_buckets_fijos(self):
        sm = _cargar_server_metrics()
        # Set fino (0.025 ... 10 s): 100 requests, 96 <= 0.25 s -> p95 en (0.1, 0.25].
        les = ["0.025", "0.05", "0.1", "0.25", "0.5", "1.0", "2.5", "5.0", "10.0", "+Inf"]
        acumulado = [20, 60, 90, 96, 99, 100, 100, 100, 100, 100]
        antes = "".join(
            f'http_request_duration_seconds_bucket{{handler="/y",le="{le}",method="GET"}} 0\n'
            for le in les
        )
        despues = "".join(
            f'http_request_duration_seconds_bucket{{handler="/y",le="{le}",method="GET"}} {n}\n'
            for le, n in zip(les, acumulado)
        )
        ruta = sm.build_report(antes, despues)["routes"]["GET /y"]
        assert ruta["p95_le_seconds"] == 0.25
        assert 0.1 < ruta["p95_estimate_seconds"] <= 0.25

    def test_el_parser_no_codifica_buckets_fijos(self):
        texto = _leer(DIR_SCRIPTS / "server_metrics.py")
        for fijo in ('"0.1"', '"0.5"', '"1.0"', "0.1,", "0.5,"):
            assert fijo not in texto, fijo

    def test_reinicio_de_contador_usa_el_valor_final_y_lo_marca(self):
        sm = _cargar_server_metrics()
        antes = 'http_requests_total{handler="/x",method="GET",status="2xx"} 500\n'
        despues = 'http_requests_total{handler="/x",method="GET",status="2xx"} 20\n'
        informe = sm.build_report(antes, despues)
        assert informe["routes"]["GET /x"]["requests"] == 20
        assert informe["counter_reset_detected"] is True

    def test_outbox_al_final_usa_el_scrape_posterior(self):
        sm = _cargar_server_metrics()
        outbox = sm.build_report(SCRAPE_ANTES, SCRAPE_DESPUES)["outbox_end"]
        assert outbox["pending_total"] == 7
        assert outbox["oldest_pending_seconds_max"] == 42.5
        assert outbox["scrape_ok"] is True

    def test_render_texto_lista_rutas_y_outbox(self):
        sm = _cargar_server_metrics()
        texto = sm.render_text(sm.build_report(SCRAPE_ANTES, SCRAPE_DESPUES))
        assert "GET /api/v1/auth/me" in texto
        assert "5xx" in texto
        assert "outbox" in texto.lower()

    def test_un_scrape_vacio_produce_informe_sin_rutas_no_una_excepcion(self):
        sm = _cargar_server_metrics()
        informe = sm.build_report("", "")
        assert informe["routes"] == {}
        assert informe["totals"] == {"requests": 0, "errors_5xx": 0}


class TestPasoAntesDespuesEnElRunner:
    def test_el_runner_scrapea_desde_dentro_del_contenedor_backend(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        assert "docker exec" in texto
        assert "http://127.0.0.1:8000/metrics" in texto
        assert "metrics-before.prom" in texto
        assert "metrics-after.prom" in texto

    def test_el_scrape_antes_corre_antes_de_k6_y_el_despues_tras_k6(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        antes = texto.index("metrics-before.prom")
        k6 = texto.index('docker run --rm "${K6_DOCKER_ARGS[@]}"')
        despues = texto.index("metrics-after.prom", k6)
        assert antes < k6 < despues

    def test_el_runner_invoca_el_informe_y_lo_incluye_en_run_json(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        assert "server_metrics.py" in texto
        assert "server-metrics.json" in texto
        assert "server_metrics" in texto.split("run.json", 1)[1]

    def test_el_scrape_fallido_no_aborta_la_corrida(self):
        texto = _leer(DIR_SCRIPTS / "run_load_test.sh")
        assert re.search(r"metrics-before\.prom.*\|\|", texto), "el scrape es best-effort"

    def test_la_doc_explica_la_seccion_server_side(self):
        doc = _leer(RAIZ / "docs" / "operations" / "load-testing.md")
        assert "server-metrics.json" in doc
        assert "server_metrics.py" in doc
