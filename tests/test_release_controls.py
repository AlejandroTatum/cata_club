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
    assert "backup-db.sh" in cron_file.read_text()


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
