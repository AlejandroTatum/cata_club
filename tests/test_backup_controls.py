"""Focused contracts for backup and rollback safeguards."""

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
    (stack / ".env").write_text("IMAGE_TAG=abcdef2\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text("#!/usr/bin/env bash\nexit 0\n")
    (bin_dir / "docker").chmod(0o755)

    result = run_script(
        "scripts/ops/rollback-release.sh",
        "abcdef1",
        "--confirm-rollback",
        env={
            "STACK_DIR": str(stack),
            "RELEASE_RECORD_DIR": str(records),
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
