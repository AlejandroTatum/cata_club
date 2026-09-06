"""Focused contracts for backup and rollback safeguards."""

import os
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent


def run_script(script: str, *args: str, env: dict[str, str] | None = None):
    return subprocess.run(
        ["bash", str(ROOT / script), *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
    )


def test_backup_freshness_accepts_documented_option_and_rejects_invalid_age(tmp_path):
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")

    fresh = run_script(
        "scripts/ops/check-backup-freshness.sh",
        "--max-age-hours",
        "1",
        env={"BACKUP_DIR": str(backup)},
    )
    assert fresh.returncode == 0, fresh.stderr

    invalid = run_script(
        "scripts/ops/check-backup-freshness.sh",
        "--max-age-hours",
        "no-es-un-numero",
        env={"BACKUP_DIR": str(backup)},
    )
    assert invalid.returncode == 2
    assert "umbral" in invalid.stderr.lower()


def test_rollback_requires_confirmation_before_touching_compose(tmp_path):
    records = tmp_path / "releases"
    records.mkdir()
    (records / "current.env").write_text(
        "IMAGE_TAG=abcdef2\nMIGRATION_COMPATIBILITY=backward-compatible\n"
    )
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef2\n")

    result = run_script(
        "scripts/ops/rollback-release.sh",
        "abcdef1",
        env={
            "STACK_DIR": str(stack),
            "RELEASE_RECORD_DIR": str(records),
        },
    )

    assert result.returncode == 2
    assert "--confirm-rollback" in result.stderr


def test_rollback_replaces_current_record_only_after_guarded_compose_run(tmp_path):
    """Issue #1064: desde que el rollback corre `refrescar_caddy`, `check_celery`
    y `verificar_readiness_publica` tras el `up -d`, un stub de `docker` que
    solo `exit 0` incondicional deja a `esperar_servicio_saludable` esperando
    150s a un `caddy` que nunca reporta `healthy` -- el mismo problema que
    `_rollback_env` (tests/test_release_controls.py) ya resuelve con un stub
    por casos. Acá se reusa el mismo patrón `${VAR-default}`: sin overrides,
    Caddy y celery-worker/celery-beat salen sanos y el readiness por el borde
    contesta JSON, así que el camino feliz sigue terminando en 0."""
    records = tmp_path / "releases"
    records.mkdir()
    (records / "current.env").write_text(
        "IMAGE_TAG=abcdef2\nMIGRATION_COMPATIBILITY=backward-compatible\n"
    )
    (records / "abcdef1.env").write_text(
        "IMAGE_TAG=abcdef1\nMIGRATION_COMPATIBILITY=none\n"
    )
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text(
        "IMAGE_TAG=abcdef2\nDOMINIO=staging.example.test\n"
    )
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        'case " $* " in\n'
        '  *" ps --format json "*)\n'
        '    if [ -n "${CELERY_WORKER_STATE-running}" ]; then\n'
        '      printf \'{"Service":"celery-worker","State":"%s","Health":"%s"}\\n\' '
        '"${CELERY_WORKER_STATE-running}" "${CELERY_WORKER_HEALTH-healthy}"\n'
        '    fi\n'
        '    if [ -n "${CELERY_BEAT_STATE-running}" ]; then\n'
        '      printf \'{"Service":"celery-beat","State":"%s","Health":"%s"}\\n\' '
        '"${CELERY_BEAT_STATE-running}" "${CELERY_BEAT_HEALTH-healthy}"\n'
        '    fi\n'
        '    if [ -n "${CADDY_STATE-running}" ]; then\n'
        '      printf \'{"Service":"caddy","State":"%s","Health":"%s"}\\n\' '
        '"${CADDY_STATE-running}" "${CADDY_HEALTH-healthy}"\n'
        '    fi ;;\n'
        '  *borde*) if [ "${CADDY_SIRVE_HTML:-0}" = "1" ]; then\n'
        '      echo "/health/ready por el borde devolvió HTML del frontend, no JSON" >&2; exit 1\n'
        '    fi\n'
        '    echo \'{"estado": "listo"}\' ;;\n'
        '  *"inspect ping"*) exit "${CELERY_PING_EXIT:-0}" ;;\n'
        "esac\n"
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)

    result = run_script(
        "scripts/ops/rollback-release.sh",
        "abcdef1",
        "--confirm-rollback",
        env={
            "STACK_DIR": str(stack),
            "RELEASE_RECORD_DIR": str(records),
            "SERVICIO_HEALTH_MAX_INTENTOS": "1",
            "SERVICIO_HEALTH_INTERVALO_SEGUNDOS": "0",
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "IMAGE_TAG=abcdef1" in (records / "current.env").read_text()


def test_rollback_refuses_release_after_migration_requiring_manual_review(tmp_path):
    records = tmp_path / "releases"
    records.mkdir()
    (records / "current.env").write_text(
        "IMAGE_TAG=abcdef2\nMIGRATION_COMPATIBILITY=manual-review-required\n"
    )
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef2\n")

    result = run_script(
        "scripts/ops/rollback-release.sh",
        "abcdef1",
        "--confirm-rollback",
        env={
            "STACK_DIR": str(stack),
            "RELEASE_RECORD_DIR": str(records),
        },
    )

    assert result.returncode == 1
    assert "manual-review-required" in result.stderr
    assert "no ejecuta" in result.stderr


# ---------------------------------------------------------------------------
# Cifrado en reposo del dump lógico.
#
# El dump es el padrón completo de los chicos del club: nombre, cédula, fecha
# de nacimiento, tipo de sangre, alergias, condiciones médicas y contacto de
# emergencia. La app protege ese dato en tránsito; un dump en claro sobre el
# disco del droplet lo devuelve a cualquiera que lea el filesystem (un snapshot
# robado del VPS, un rsync mal apuntado, un admin que se va con su SSH).
#
# El marcador de abajo tiene la forma del dato real justamente para que la
# aserción "no aparece literal en el artefacto" signifique algo.
# ---------------------------------------------------------------------------

MARCADOR_EN_CLARO = "PGDMP|CEDULA-1728394|ALERGIA-PENICILINA|O-NEGATIVO|1998-03-14"

requiere_age = pytest.mark.skipif(
    shutil.which("age") is None or shutil.which("age-keygen") is None,
    reason="requiere `age` y `age-keygen` en PATH (CI los instala)",
)


def _par_de_claves_age(tmp_path: Path) -> tuple[Path, str]:
    """Genera una identidad age y devuelve (archivo de identidad, destinatario).

    Es el reparto que exige el modelo de amenaza: el host de backup se queda
    SOLO con el destinatario (clave pública); la identidad privada vive fuera.
    """
    identidad = tmp_path / "identidad.txt"
    resultado = subprocess.run(
        ["age-keygen", "-o", str(identidad)], capture_output=True, text=True
    )
    assert resultado.returncode == 0, resultado.stderr
    destinatario = next(
        linea.split(":", 1)[1].strip()
        for linea in resultado.stderr.splitlines()
        if linea.startswith("Public key:")
    )
    return identidad, destinatario


def _docker_que_emite_un_dump(bin_dir: Path, contenido: str) -> None:
    """`docker` de mentira para backup-db.sh: escribe el dump en stdout."""
    bin_dir.mkdir(parents=True, exist_ok=True)
    falso = bin_dir / "docker"
    falso.write_text(f"#!/usr/bin/env bash\nprintf '%s' {shlex.quote(contenido)}\n")
    falso.chmod(0o755)


def _docker_que_captura_el_restore(bin_dir: Path, destino: Path) -> None:
    """`docker` de mentira para restore-check.sh.

    Copia a `destino` el archivo EXACTO que se le entrega a `pg_restore`. Eso
    es lo que permite afirmar el round-trip: si esos bytes son idénticos a los
    que emitió `pg_dump`, el restore verificado de punta a punta que ya hacía
    este script sigue recibiendo lo mismo que antes del cifrado.
    """
    bin_dir.mkdir(parents=True, exist_ok=True)
    falso = bin_dir / "docker"
    falso.write_text(
        "#!/usr/bin/env bash\n"
        'args=("$@")\n'
        '[ "${1:-}" = "run" ] || exit 0\n'
        'montaje=""; previo=""; comando=""\n'
        'for a in "${args[@]}"; do\n'
        '  [ "$previo" = "-v" ] && montaje="$a"\n'
        '  case "$a" in pg_isready|pg_restore|psql) comando="$a" ;; esac\n'
        '  previo="$a"\n'
        "done\n"
        'ultimo="${args[$((${#args[@]} - 1))]}"\n'
        'case "$comando" in\n'
        "  pg_restore)\n"
        '    cp "${montaje%%:*}/$(basename "$ultimo")" "$FAKE_DOCKER_CAPTURE" ;;\n'
        "  psql)\n"
        '    case "$ultimo" in *alembic_version*) echo "b1c2d3e4f5a6" ;; *) echo 0 ;; esac ;;\n'
        "esac\n"
        "exit 0\n"
    )
    falso.chmod(0o755)


def _entorno_de_backup(tmp_path: Path, **extra: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    backups = tmp_path / "backups"
    backups.mkdir(exist_ok=True)
    entorno = {
        "BACKUP_DIR": str(backups),
        "BACKUP_STACK_DIR": str(tmp_path),
        # Hermético: nunca mirar el /etc real de la máquina que corre la suite.
        "BACKUP_AGE_RECIPIENTS_FILE": str(tmp_path / "no-existe" / "recipients.txt"),
        "BACKUP_AGE_RECIPIENTS": "",
        "BACKUP_ALLOW_PLAINTEXT": "",
        "AMBIENTE": "",
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }
    entorno.update(extra)
    return entorno


def _artefactos(backups: Path) -> list[str]:
    return sorted(p.name for p in backups.iterdir())


def test_backup_de_produccion_falla_sin_destinatario_y_no_escribe_texto_plano(tmp_path):
    """Sin clave configurada, un backup de producción NO puede caer a texto plano.

    Este es el agujero que se está cerrando: el script escribía el dump en
    claro y salía 0, así que nada en el sistema avisaba nunca.
    """
    _docker_que_emite_un_dump(tmp_path / "bin", MARCADOR_EN_CLARO)
    backups = tmp_path / "backups"

    resultado = run_script(
        "scripts/backup/backup-db.sh", env=_entorno_de_backup(tmp_path)
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "BACKUP_AGE_RECIPIENTS" in resultado.stderr
    assert _artefactos(backups) == []


def test_backup_de_produccion_ignora_el_escape_de_texto_plano(tmp_path):
    """El opt-in de desarrollo no debe existir en producción.

    Si `BACKUP_ALLOW_PLAINTEXT=1` alcanzara para saltear el cifrado, la
    compuerta duraría hasta el primer operador apurado copiando una variable
    de su `.env` local al droplet.
    """
    _docker_que_emite_un_dump(tmp_path / "bin", MARCADOR_EN_CLARO)
    backups = tmp_path / "backups"

    resultado = run_script(
        "scripts/backup/backup-db.sh",
        env=_entorno_de_backup(tmp_path, BACKUP_ALLOW_PLAINTEXT="1"),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "BACKUP_ALLOW_PLAINTEXT" in resultado.stderr
    assert _artefactos(backups) == []


def test_backup_local_exige_opt_in_explicito_para_el_texto_plano(tmp_path):
    """Fuera de producción el default sigue siendo fail-closed, pero hay salida.

    Negarle en silencio el backup a quien desarrolla es su propia forma de
    falla: el mensaje tiene que nombrar la variable que destraba el camino.
    """
    _docker_que_emite_un_dump(tmp_path / "bin", MARCADOR_EN_CLARO)
    backups = tmp_path / "backups"
    entorno_local = _entorno_de_backup(
        tmp_path, BACKUP_COMPOSE_FILES="-f docker-compose.yml"
    )

    sin_opt_in = run_script("scripts/backup/backup-db.sh", env=entorno_local)
    assert sin_opt_in.returncode != 0, sin_opt_in.stdout
    assert "BACKUP_ALLOW_PLAINTEXT" in sin_opt_in.stderr
    assert _artefactos(backups) == []

    con_opt_in = run_script(
        "scripts/backup/backup-db.sh",
        env={**entorno_local, "BACKUP_ALLOW_PLAINTEXT": "1"},
    )
    assert con_opt_in.returncode == 0, con_opt_in.stderr
    escritos = _artefactos(backups)
    assert len(escritos) == 1, escritos
    assert escritos[0].endswith(".dump")
    assert "SIN CIFRAR" in con_opt_in.stdout.upper()


@requiere_age
def test_el_artefacto_cifrado_no_contiene_texto_plano_del_dump(tmp_path):
    """El artefacto en disco no debe revelar nada del dump, y no debe quedar copia en claro."""
    _docker_que_emite_un_dump(tmp_path / "bin", MARCADOR_EN_CLARO)
    backups = tmp_path / "backups"
    identidad, destinatario = _par_de_claves_age(tmp_path)

    resultado = run_script(
        "scripts/backup/backup-db.sh",
        env=_entorno_de_backup(tmp_path, BACKUP_AGE_RECIPIENTS=destinatario),
    )
    assert resultado.returncode == 0, resultado.stderr

    artefactos = _artefactos(backups)
    assert artefactos, "no se escribió ningún backup"
    assert all(n.endswith(".dump.age") for n in artefactos), artefactos

    cifrado = (backups / artefactos[0]).read_bytes()
    assert MARCADOR_EN_CLARO.encode() not in cifrado
    assert b"CEDULA-1728394" not in cifrado
    assert b"ALERGIA-PENICILINA" not in cifrado

    descifrado = subprocess.run(
        ["age", "-d", "-i", str(identidad), str(backups / artefactos[0])],
        capture_output=True,
    )
    assert descifrado.returncode == 0, descifrado.stderr
    assert descifrado.stdout == MARCADOR_EN_CLARO.encode()


@requiere_age
def test_backup_de_produccion_avisa_con_un_solo_destinatario_pero_no_falla(tmp_path):
    """Un solo destinatario `age` en producción es un solo punto de fallo
    sobre el histórico entero de backups (issue #791), pero el backup de las
    03:30 no puede dejar de producirse por esto: solo avisa, y sigue
    cifrando y escribiendo el artefacto como siempre. El fail-closed real es
    `deploy.sh install-cron`, con el operador todavía en la terminal.
    """
    _docker_que_emite_un_dump(tmp_path / "bin", MARCADOR_EN_CLARO)
    backups = tmp_path / "backups"
    _, destinatario = _par_de_claves_age(tmp_path)

    resultado = run_script(
        "scripts/backup/backup-db.sh",
        env=_entorno_de_backup(
            tmp_path, BACKUP_AGE_RECIPIENTS=destinatario, AMBIENTE="production",
        ),
    )

    assert resultado.returncode == 0, resultado.stderr
    assert "un solo destinatario" in resultado.stdout.lower()
    artefactos = _artefactos(backups)
    assert artefactos, "el aviso no puede impedir que el backup se escriba"
    assert all(n.endswith(".dump.age") for n in artefactos), artefactos


@requiere_age
def test_el_backup_falla_si_el_destinatario_esta_configurado_pero_age_no_existe(tmp_path):
    """Herramienta ausente es una falla, nunca una degradación a texto plano.

    Se apunta `BACKUP_AGE_BIN` a un binario inexistente en vez de recortar el
    PATH: dónde quedó instalado `age` cambia entre el droplet, el runner de CI
    y la máquina de quien desarrolla, y un test que dependa de eso miente en
    alguna de las tres.
    """
    _docker_que_emite_un_dump(tmp_path / "bin", MARCADOR_EN_CLARO)
    _, destinatario = _par_de_claves_age(tmp_path)
    backups = tmp_path / "backups"

    resultado = run_script(
        "scripts/backup/backup-db.sh",
        env=_entorno_de_backup(
            tmp_path,
            BACKUP_AGE_RECIPIENTS=destinatario,
            BACKUP_AGE_BIN=str(tmp_path / "no-existe" / "age"),
        ),
    )

    assert resultado.returncode != 0, resultado.stdout
    assert "age" in resultado.stderr.lower()
    assert _artefactos(backups) == []


@requiere_age
def test_restore_check_hace_round_trip_sobre_el_artefacto_cifrado(tmp_path):
    """cifrar -> descifrar -> restaurar: pg_restore recibe los bytes originales.

    Si lo que llega a `pg_restore` es byte a byte lo que emitió `pg_dump`,
    entonces la verificación de punta a punta que restore-check.sh ya hacía
    (alembic_version + conteos contra un Postgres desechable) sigue valiendo
    exactamente igual sobre el artefacto cifrado.
    """
    _docker_que_emite_un_dump(tmp_path / "bin", MARCADOR_EN_CLARO)
    backups = tmp_path / "backups"
    identidad, destinatario = _par_de_claves_age(tmp_path)

    backup = run_script(
        "scripts/backup/backup-db.sh",
        env=_entorno_de_backup(tmp_path, BACKUP_AGE_RECIPIENTS=destinatario),
    )
    assert backup.returncode == 0, backup.stderr
    artefacto = backups / _artefactos(backups)[0]
    assert artefacto.name.endswith(".dump.age")

    capturado = tmp_path / "lo-que-recibio-pg-restore"
    _docker_que_captura_el_restore(tmp_path / "bin", capturado)

    restore = run_script(
        "scripts/backup/restore-check.sh",
        str(artefacto),
        "--identity",
        str(identidad),
        env={
            "PATH": f"{tmp_path / 'bin'}:{os.environ['PATH']}",
            "FAKE_DOCKER_CAPTURE": str(capturado),
        },
    )

    assert restore.returncode == 0, restore.stderr
    assert capturado.read_bytes() == MARCADOR_EN_CLARO.encode()
    # El descifrado transitorio no puede sobrevivir a la corrida.
    assert _artefactos(backups) == [artefacto.name]


@requiere_age
def test_restore_check_rechaza_un_artefacto_cifrado_sin_identidad(tmp_path):
    """Sin identidad no hay restore: mejor un error claro que un pg_restore de basura."""
    _docker_que_emite_un_dump(tmp_path / "bin", MARCADOR_EN_CLARO)
    backups = tmp_path / "backups"
    _, destinatario = _par_de_claves_age(tmp_path)

    backup = run_script(
        "scripts/backup/backup-db.sh",
        env=_entorno_de_backup(tmp_path, BACKUP_AGE_RECIPIENTS=destinatario),
    )
    assert backup.returncode == 0, backup.stderr
    artefacto = backups / _artefactos(backups)[0]

    restore = run_script(
        "scripts/backup/restore-check.sh",
        str(artefacto),
        env={
            "PATH": f"{tmp_path / 'bin'}:{os.environ['PATH']}",
            "BACKUP_AGE_IDENTITY": "",
        },
    )

    assert restore.returncode != 0
    assert "identity" in restore.stderr.lower() or "identidad" in restore.stderr.lower()


def test_la_frescura_ve_los_dumps_cifrados(tmp_path):
    """Renombrar el artefacto no puede apagar el monitoreo.

    check-backup-freshness.sh buscaba `cataclub_*.dump`. Con el artefacto
    cifrado (`.dump.age`) ese glob deja de encontrar nada y el chequeo pasa de
    "el dump está fresco" a "no hay ningún dump" — o peor, a un cron que
    alerta todos los días hasta que alguien lo silencia.
    """
    backups = tmp_path / "backups"
    backups.mkdir()
    (backups / "cataclub_2026-08-27.dump.age").write_bytes(b"age-encryption.org/v1\n")

    resultado = run_script(
        "scripts/ops/check-backup-freshness.sh",
        "--max-age-hours",
        "26",
        env={"BACKUP_DIR": str(backups)},
    )

    assert resultado.returncode == 0, resultado.stdout + resultado.stderr
    assert "cataclub_2026-08-27.dump.age" in resultado.stdout
