"""Contratos del flujo de rama de integración (issue #1505, CLAUDE.md regla 5).

Todo corre contra un repo temporal (bare `origin` + clon) y un `gh` falso en el
PATH que registra sus argumentos; nunca toca el `origin` ni el `gh` reales.
"""

import os
import re
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "feature_flow.sh"

FAKE_GH = """#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "pr view") echo "${GH_BASE:-}" ;;
  "pr checks") exit "${GH_CHECKS_RC:-0}" ;;
esac
exit 0
"""


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    env = {
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
    }
    os.environ.update(env)
    origin = tmp_path / "origin.git"
    work = tmp_path / "work"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    subprocess.run(["git", "clone", "-q", str(origin), str(work)], check=True, capture_output=True)
    git(work, "checkout", "-q", "-b", "main")
    (work / "a.txt").write_text("a\n")
    git(work, "add", "a.txt")
    git(work, "commit", "-q", "-m", "init")
    git(work, "push", "-q", "-u", "origin", "main")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(FAKE_GH)
    gh.chmod(0o755)
    return work


def flow(repo: Path, *args: str, **env: str):
    tmp = repo.parent
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        cwd=repo,
        env={
            **os.environ,
            "PATH": f"{tmp / 'bin'}:{os.environ['PATH']}",
            "GH_LOG": str(tmp / "gh.log"),
            **env,
        },
        capture_output=True,
        text=True,
    )


def gh_calls(repo: Path) -> list[str]:
    log = repo.parent / "gh.log"
    return log.read_text().splitlines() if log.exists() else []


def remote_branches(repo: Path) -> str:
    return git(repo, "ls-remote", "--heads", "origin")


def start_feature(repo: Path, feature: str = "demo") -> None:
    assert flow(repo, "feature-start", feature).returncode == 0


def start_slice(repo: Path, feature: str = "demo", slice_: str = "s1") -> None:
    start_feature(repo, feature)
    assert flow(repo, "slice-start", feature, slice_).returncode == 0


def test_no_args_and_unknown_subcommand_print_usage_exit_2(repo):
    for args in ((), ("bogus", "x")):
        r = flow(repo, *args)
        assert r.returncode == 2
        assert "usage" in r.stderr.lower()


@pytest.mark.parametrize("bad", ["Demo", "-x", "a_b", "a/b", "a b"])
def test_invalid_feature_names_rejected(repo, bad):
    r = flow(repo, "feature-start", bad)
    assert r.returncode != 0
    assert "invalid" in r.stderr.lower()
    assert "feat/" not in remote_branches(repo)


def test_feature_start_creates_and_pushes_branch_from_main(repo):
    assert flow(repo, "feature-start", "demo").returncode == 0
    assert git(repo, "branch", "--show-current") == "feat/demo"
    assert "refs/heads/feat/demo" in remote_branches(repo)
    assert git(repo, "rev-parse", "feat/demo") == git(repo, "rev-parse", "origin/main")


def test_feature_start_refuses_duplicates(repo):
    start_feature(repo)
    git(repo, "checkout", "-q", "main")
    r = flow(repo, "feature-start", "demo")  # existe local y remota
    assert r.returncode != 0 and "exists" in r.stderr
    git(repo, "branch", "-q", "-D", "feat/demo")
    r = flow(repo, "feature-start", "demo")  # solo remota
    assert r.returncode != 0 and "exists" in r.stderr


def test_slice_start_branches_from_integration_branch(repo):
    start_feature(repo)
    (repo / "b.txt").write_text("b\n")
    git(repo, "add", "b.txt")
    git(repo, "commit", "-q", "-m", "feature work")
    git(repo, "push", "-q")
    git(repo, "checkout", "-q", "main")
    assert flow(repo, "slice-start", "demo", "s1").returncode == 0
    assert git(repo, "branch", "--show-current") == "feat/demo-s1"
    assert git(repo, "rev-parse", "HEAD") == git(repo, "rev-parse", "origin/feat/demo")


def test_slice_start_requires_remote_integration_branch_and_clean_tree(repo):
    r = flow(repo, "slice-start", "demo", "s1")
    assert r.returncode != 0 and "feat/demo" in r.stderr
    start_feature(repo)
    (repo / "a.txt").write_text("dirty\n")
    r = flow(repo, "slice-start", "demo", "s1")
    assert r.returncode != 0 and "uncommitted" in r.stderr
    assert flow(repo, "slice-start", "demo", "Bad_Slice").returncode != 0


def test_slice_start_refuses_existing_slice(repo):
    start_slice(repo)
    git(repo, "checkout", "-q", "main")
    r = flow(repo, "slice-start", "demo", "s1")
    assert r.returncode != 0 and "exists" in r.stderr


def test_slice_pr_targets_integration_branch_without_auto_merge(repo):
    start_slice(repo)
    r = flow(repo, "slice-pr", "demo")
    assert r.returncode == 0, r.stderr
    assert "refs/heads/feat/demo-s1" in remote_branches(repo)
    calls = gh_calls(repo)
    assert any("pr create" in c and "--base feat/demo" in c for c in calls)
    assert not any("--auto" in c or "pr merge" in c for c in calls)


def test_slice_pr_refuses_main_and_integration_branch(repo):
    start_feature(repo)
    assert flow(repo, "slice-pr", "demo").returncode != 0  # en feat/demo
    git(repo, "checkout", "-q", "main")
    assert flow(repo, "slice-pr", "demo").returncode != 0
    assert gh_calls(repo) == []


def test_slice_merge_refuses_base_main(repo):
    r = flow(repo, "slice-merge", "demo", "7", GH_BASE="main")
    assert r.returncode != 0 and "feat/demo" in r.stderr
    assert not any("pr merge" in c for c in gh_calls(repo))


def test_slice_merge_refuses_failing_or_pending_checks(repo):
    r = flow(repo, "slice-merge", "demo", "7", GH_BASE="feat/demo", GH_CHECKS_RC="8")
    assert r.returncode != 0 and "checks" in r.stderr.lower()
    assert any("pr checks 7 --required" in c for c in gh_calls(repo))
    assert not any("pr merge" in c for c in gh_calls(repo))


def test_slice_merge_squashes_when_green(repo):
    r = flow(repo, "slice-merge", "demo", "7", GH_BASE="feat/demo")
    assert r.returncode == 0, r.stderr
    merges = [c for c in gh_calls(repo) if "pr merge" in c]
    assert merges == ["pr merge 7 --squash --delete-branch"]


def test_slice_merge_rejects_non_numeric_pr(repo):
    assert flow(repo, "slice-merge", "demo", "abc", GH_BASE="feat/demo").returncode != 0


def test_feature_sync_merges_main_and_pushes(repo):
    start_feature(repo)
    (repo / "f.txt").write_text("f\n")
    git(repo, "add", "f.txt")
    git(repo, "commit", "-q", "-m", "feature work")
    git(repo, "push", "-q")
    git(repo, "checkout", "-q", "main")
    (repo / "m.txt").write_text("m\n")
    git(repo, "add", "m.txt")
    git(repo, "commit", "-q", "-m", "main moves")
    git(repo, "push", "-q")
    git(repo, "checkout", "-q", "feat/demo")
    r = flow(repo, "feature-sync", "demo")
    assert r.returncode == 0, r.stderr
    assert (repo / "m.txt").exists()
    assert git(repo, "rev-parse", "HEAD") == git(repo, "rev-parse", "origin/feat/demo")
    assert len(git(repo, "rev-list", "--parents", "-n1", "HEAD").split()) == 3  # merge commit


def test_feature_sync_refuses_wrong_branch_and_dirty_tree(repo):
    start_feature(repo)
    git(repo, "checkout", "-q", "main")
    assert flow(repo, "feature-sync", "demo").returncode != 0
    git(repo, "checkout", "-q", "feat/demo")
    (repo / "a.txt").write_text("dirty\n")
    assert flow(repo, "feature-sync", "demo").returncode != 0


def test_feature_sync_stops_on_conflict(repo):
    start_feature(repo)
    (repo / "a.txt").write_text("feature\n")
    git(repo, "commit", "-q", "-am", "feature edit")
    git(repo, "push", "-q")
    git(repo, "checkout", "-q", "main")
    (repo / "a.txt").write_text("main\n")
    git(repo, "commit", "-q", "-am", "main edit")
    git(repo, "push", "-q")
    git(repo, "checkout", "-q", "feat/demo")
    r = flow(repo, "feature-sync", "demo")
    assert r.returncode != 0 and "resolve" in r.stderr.lower()
    assert (repo / ".git" / "MERGE_HEAD").exists()  # no aborta en silencio


def test_feature_pr_opens_pr_to_main_and_enables_auto_squash(repo):
    start_feature(repo)
    r = flow(repo, "feature-pr", "demo")
    assert r.returncode == 0, r.stderr
    calls = gh_calls(repo)
    assert any("pr create" in c and "--base main" in c and "--head feat/demo" in c for c in calls)
    assert "pr merge --auto --squash feat/demo" in calls


def test_feature_pr_requires_remote_branch(repo):
    assert flow(repo, "feature-pr", "demo").returncode != 0
    assert gh_calls(repo) == []


def test_script_never_forces_or_rebases():
    text = SCRIPT.read_text()
    code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
    assert not re.search(r"--force|--force-with-lease|\bpush\b[^\n]*\s-f\b|\brebase\b", code)


FEATURE_TARGETS = [
    "feature-start", "slice-start", "slice-pr",
    "slice-merge", "feature-sync", "feature-pr",
]


@pytest.mark.parametrize("target", FEATURE_TARGETS)
def test_makefile_declares_target_with_help_comment(target):
    makefile = (ROOT / "Makefile").read_text()
    assert re.search(rf"^{target}:.*?## \S", makefile, re.M)
    phony = re.search(r"\.PHONY:((?:.|\\\n)*?)\n\n", makefile).group(1)
    assert re.search(rf"(?<![\w-]){target}(?![\w-])", phony)


def test_makefile_target_without_required_variable_fails_clearly():
    r = subprocess.run(
        ["make", "-C", str(ROOT), "slice-merge", "FEATURE=demo"],
        capture_output=True, text=True,
    )
    assert r.returncode != 0 and "PR is required" in r.stderr
