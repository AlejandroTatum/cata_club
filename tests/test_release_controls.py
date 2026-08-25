"""Focused contracts for production release controls."""

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def run_script(script: str, *args: str, env: dict[str, str] | None = None):
    return subprocess.run(
        ["bash", str(ROOT / script), *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
    )


def test_install_cron_requires_confirmation_before_modifying_crontab(tmp_path):
    cron_file = tmp_path / "crontab"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "crontab").write_text(
        "#!/usr/bin/env bash\n"
        'if [ "${1:-}" = "-l" ]; then [ -f "$CRON_FILE" ] && cat "$CRON_FILE"; exit 0; fi\n'
        'if [ "${1:-}" = "-" ]; then cat > "$CRON_FILE"; exit 0; fi\n'
        "exit 1\n"
    )
    (bin_dir / "crontab").chmod(0o755)

    refused = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        env={"CRON_FILE": str(cron_file), "PATH": f"{bin_dir}:{os.environ['PATH']}"},
    )

    assert refused.returncode == 2
    assert "--confirm-install-cron" in refused.stderr
    assert not cron_file.exists()

    installed = run_script(
        "scripts/deploy/deploy.sh",
        "install-cron",
        "--confirm-install-cron",
        env={"CRON_FILE": str(cron_file), "PATH": f"{bin_dir}:{os.environ['PATH']}"},
    )

    assert installed.returncode == 0, installed.stderr
    installed_cron = cron_file.read_text()
    assert "backup-db.sh" in installed_cron
    assert "check-backup-freshness.sh" in installed_cron


def _deploy_env(tmp_path, db_running: bool) -> tuple[dict[str, str], Path, Path]:
    """Deploy fixture: stack, backups, releases and a docker stub that logs argv."""
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\n")
    backups = tmp_path / "backups"
    backups.mkdir()
    records = tmp_path / "releases"
    docker_log = tmp_path / "docker.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        'printf \'%s\\n\' "$*" >> "$DOCKER_LOG"\n'
        'case " $* " in\n'
        '  *" --images backend "*) echo "registry.example/cata-backend:${IMAGE_TAG}"; if [ "${MULTI_IMAGE_OUTPUT:-0}" = "1" ]; then echo "registry.example/cata-frontend:${IMAGE_TAG}"; fi ;;\n'
        '  *" manifest inspect "*) [ "$3" = "registry.example/cata-backend:${IMAGE_TAG}" ] || exit 1 ;;\n'
        '  *" --status running "*) if [ "${DB_RUNNING:-0}" = "1" ]; then echo db; fi ;;\n'
        "esac\n"
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)
    env = {
        "STACK_DIR": str(stack),
        "BACKUP_DIR": str(backups),
        "RELEASE_RECORD_DIR": str(records),
        "IMAGE_TAG": "abcdef1",
        "MIGRATION_COMPATIBILITY": "none",
        "DOCKER_LOG": str(docker_log),
        "DB_RUNNING": "1" if db_running else "0",
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }
    return env, backups, docker_log


def test_first_deploy_passes_without_any_previous_backup(tmp_path):
    """First provision: the db has never started, so no dump can exist and the
    freshness alarm must not abort the documented day-one path."""
    env, backups, _ = _deploy_env(tmp_path, db_running=False)

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "no hay nada que respaldar" in result.stdout
    assert not list(backups.glob("*.dump"))


def test_deploy_resolves_single_backend_image_when_compose_emits_multiple_lines(tmp_path):
    """Docker Compose >= 5.5 can emit more than one image line for
    `config --images backend`; deploy must resolve a single backend reference
    or `docker manifest inspect` rejects the newline and aborts the deploy."""
    env, _, _ = _deploy_env(tmp_path, db_running=False)
    env["MULTI_IMAGE_OUTPUT"] = "1"

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "Desplegando imágenes con SHA abcdef1" in result.stdout


def test_deploy_backs_up_the_database_before_starting_new_images(tmp_path):
    """With a running db, deploy must dump BEFORE `up -d` (which migrates)."""
    env, backups, docker_log = _deploy_env(tmp_path, db_running=True)

    result = run_script("scripts/deploy/deploy.sh", env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert list(backups.glob("cataclub_*.dump"))
    lines = docker_log.read_text().splitlines()
    dump_calls = [i for i, line in enumerate(lines) if "pg_dump" in line]
    up_calls = [i for i, line in enumerate(lines) if "up -d" in line]
    assert dump_calls, "deploy nunca ejecutó pg_dump"
    assert up_calls, "deploy nunca ejecutó up -d"
    assert dump_calls[0] < up_calls[0], "el backup debe correr antes de up -d"


def test_preflight_requires_explicitly_safe_migration_attestation(tmp_path):
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\n")

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "manual-review-required",
        },
    )

    assert result.returncode == 1
    assert "MIGRATION_COMPATIBILITY" in result.stderr
    assert "manual-review-required" in result.stderr


def test_preflight_accepts_an_explicitly_backward_compatible_release(tmp_path):
    backup = tmp_path / "backups"
    backup.mkdir()
    (backup / "cataclub_today.dump").write_text("dump")
    stack = tmp_path / "stack"
    stack.mkdir()
    (stack / ".env").write_text("IMAGE_TAG=abcdef1\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        'case " $* " in *" --images backend "*) echo registry.example/cata-backend:${IMAGE_TAG};; esac\n'
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)

    result = run_script(
        "scripts/ops/preflight-production.sh",
        env={
            "STACK_DIR": str(stack),
            "BACKUP_DIR": str(backup),
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "Preflight OK" in result.stdout
    assert "registry.example/cata-backend:abcdef1" in result.stdout


def test_record_release_writes_auditable_current_record_without_credentials(tmp_path):
    records = tmp_path / "releases"
    stack = tmp_path / "stack"
    stack.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(
        "#!/usr/bin/env bash\n"
        'case " $* " in *" --images backend "*) echo registry.example/cata-backend:${IMAGE_TAG};; esac\n'
        "exit 0\n"
    )
    (bin_dir / "docker").chmod(0o755)

    result = run_script(
        "scripts/ops/record-release.sh",
        env={
            "IMAGE_TAG": "abcdef1",
            "MIGRATION_COMPATIBILITY": "backward-compatible",
            "RELEASE_RECORD_DIR": str(records),
            "STACK_DIR": str(stack),
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
        },
    )

    assert result.returncode == 0, result.stderr
    current = records / "current.env"
    assert current.exists()
    content = current.read_text()
    assert "IMAGE_TAG=abcdef1" in content
    assert "MIGRATION_COMPATIBILITY=backward-compatible" in content
    assert "IMAGE_REFERENCE=registry.example/cata-backend:abcdef1" in content
    assert (records / "abcdef1.env").exists()
    assert "PASSWORD" not in content
    assert "TOKEN" not in content
