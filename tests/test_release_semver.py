"""Contracts for the SemVer release scripts (`scripts/release/`).

`next-version.sh` computes the next `X.Y.Z` from the Conventional Commits in
`<last v* tag>..<sha>`; `tag-release.sh` verifies that production serves exactly
that sha and version before it creates and pushes ONLY the annotated tag.
Everything runs against throwaway git repositories, never the real checkout.
"""

import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
NEXT_VERSION = ROOT / "scripts" / "release" / "next-version.sh"
TAG_RELEASE = ROOT / "scripts" / "release" / "tag-release.sh"


def _git_env(home: Path) -> dict[str, str]:
    return {
        **os.environ,
        "HOME": str(home),
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_AUTHOR_NAME": "Test",
        "GIT_AUTHOR_EMAIL": "test@example.test",
        "GIT_COMMITTER_NAME": "Test",
        "GIT_COMMITTER_EMAIL": "test@example.test",
        "NO_PROXY": "127.0.0.1,localhost",
        "no_proxy": "127.0.0.1,localhost",
    }


class Repo:
    """A throwaway git repository with a small commit/tag vocabulary."""

    def __init__(self, path: Path):
        self.path = path
        self.env = _git_env(path.parent)
        path.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "tag.gpgsign", "false")
        self._n = 0

    def git(self, *args: str, check: bool = True) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.path,
            env=self.env,
            capture_output=True,
            text=True,
        )
        if check:
            assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    def commit(self, subject: str, body: str | None = None) -> str:
        self._n += 1
        (self.path / "file.txt").write_text(f"{self._n}\n")
        self.git("add", "file.txt")
        args = ["commit", "-q", "-m", subject]
        if body:
            args += ["-m", body]
        self.git(*args)
        return self.head()

    def head(self) -> str:
        return self.git("rev-parse", "HEAD")

    def tag(self, name: str, *, annotated: bool = True, ref: str = "HEAD") -> None:
        if annotated:
            self.git("tag", "-a", name, "-m", name, ref)
        else:
            self.git("tag", name, ref)

    def run(self, script: Path, *args: str, env: dict[str, str] | None = None):
        return subprocess.run(
            ["bash", str(script), *args],
            cwd=self.path,
            env={**self.env, **(env or {})},
            capture_output=True,
            text=True,
        )


@pytest.fixture
def repo(tmp_path) -> Repo:
    r = Repo(tmp_path / "work")
    r.commit("chore: bootstrap")
    r.tag("v1.3.0")
    return r


def _next(repo: Repo, sha: str | None = None):
    return repo.run(NEXT_VERSION, sha or repo.head())


# --- next-version.sh (S2) ----------------------------------------------------


def test_patch_bump_when_there_is_only_a_fix(repo):
    repo.commit("fix(pagos): round the grace period")
    repo.commit("docs: explain the grace period")

    result = _next(repo)

    assert result.returncode == 0, result.stderr
    assert result.stdout == "1.3.1\n"


def test_minor_bump_when_any_commit_is_a_feat(repo):
    repo.commit("fix: a small thing")
    repo.commit("feat(socios): add the roster filter")
    repo.commit("fix: another small thing")

    result = _next(repo)

    assert result.returncode == 0, result.stderr
    assert result.stdout == "1.4.0\n"


@pytest.mark.parametrize("subject", ["feat!: drop the v1 API", "feat(api)!: drop the v1 API", "refactor!: rename"])
def test_major_bump_when_the_subject_has_a_bang_before_the_colon(repo, subject):
    repo.commit("fix: a small thing")
    repo.commit(subject)

    result = _next(repo)

    assert result.returncode == 0, result.stderr
    assert result.stdout == "2.0.0\n"


@pytest.mark.parametrize("footer", ["BREAKING CHANGE: the token format changed", "BREAKING-CHANGE: the token format changed"])
def test_major_bump_when_the_body_has_a_breaking_change_footer(repo, footer):
    repo.commit("fix: tweak the token", f"Some context.\n\n{footer}")

    result = _next(repo)

    assert result.returncode == 0, result.stderr
    assert result.stdout == "2.0.0\n"


def test_major_wins_over_feat_and_fix(repo):
    repo.commit("feat: something new")
    repo.commit("fix: something old", "BREAKING CHANGE: contract change")
    repo.commit("fix: something else")

    result = _next(repo)

    assert result.stdout == "2.0.0\n"


@pytest.mark.parametrize(
    "subject,body",
    [
        ("fix: stop treating this as breaking change", None),
        ("fix: wow!", None),
        ("fix: handle the feat: prefix", None),
        ("fix: x", "We mention BREAKING CHANGE: in the middle of a sentence"),
        ("fix: x", "feat!: only a body line, not a subject"),
    ],
)
def test_bang_footer_and_feat_lookalikes_do_not_escalate(repo, subject, body):
    repo.commit(subject, body)

    result = _next(repo)

    assert result.returncode == 0, result.stderr
    assert result.stdout == "1.3.1\n"


def test_only_commits_after_the_last_tag_count(repo):
    repo.commit("feat!: old breaking change")
    repo.tag("v2.0.0")
    repo.commit("fix: after the release")

    result = _next(repo)

    assert result.stdout == "2.0.1\n"


def test_lightweight_tags_are_accepted(tmp_path):
    r = Repo(tmp_path / "w")
    r.commit("chore: bootstrap")
    r.tag("v1.3.0", annotated=False)
    r.commit("feat: x")

    assert _next(r).stdout == "1.4.0\n"


def test_the_sha_argument_selects_the_range_not_the_checked_out_head(repo):
    fix = repo.commit("fix: patch level")
    repo.commit("feat: a later feature")

    result = _next(repo, fix)

    assert result.stdout == "1.3.1\n"


def test_a_short_sha_is_accepted(repo):
    repo.commit("fix: a")
    short = repo.git("rev-parse", "--short=8", "HEAD")

    assert _next(repo, short).stdout == "1.3.1\n"


def test_prints_only_the_version_on_stdout(repo):
    repo.commit("fix: a")

    result = _next(repo)

    assert result.stdout.strip() == "1.3.1"
    assert len(result.stdout.splitlines()) == 1


def test_fails_asking_for_the_bootstrap_tag_when_no_tag_exists(tmp_path):
    r = Repo(tmp_path / "w")
    r.commit("feat: first")

    result = _next(r)

    assert result.returncode != 0
    assert result.stdout == ""
    assert "v1.3.0" in result.stderr
    assert "git tag -a" in result.stderr


def test_fails_when_there_are_zero_commits_since_the_tag(repo):
    result = _next(repo)

    assert result.returncode != 0
    assert result.stdout == ""
    assert "nada que publicar" in result.stderr.lower() or "nothing to release" in result.stderr.lower()


def test_a_tag_on_an_unreachable_side_branch_is_ignored(repo):
    base = repo.head()
    repo.git("checkout", "-q", "-b", "side")
    repo.commit("fix: only on the side branch")
    repo.tag("v9.0.0")
    repo.git("checkout", "-q", "main")
    repo.commit("feat: on main")

    result = _next(repo)

    assert result.returncode == 0, result.stderr
    assert result.stdout == "1.4.0\n", f"computed from the side tag, not v1.3.0 ({base})"


def test_fails_when_only_a_side_branch_tag_exists(tmp_path):
    r = Repo(tmp_path / "w")
    r.commit("chore: root")
    r.git("checkout", "-q", "-b", "side")
    r.commit("fix: side")
    r.tag("v1.3.0")
    r.git("checkout", "-q", "main")
    r.commit("feat: main")

    result = _next(r)

    assert result.returncode != 0
    assert result.stdout == ""
    assert "v1.3.0" in result.stderr


def test_prerelease_tags_are_not_release_baselines(repo):
    repo.commit("fix: a")
    repo.tag("v1.9.0-rc1")
    repo.commit("fix: b")

    result = _next(repo)

    assert result.stdout == "1.3.1\n"


def test_unknown_sha_fails_without_output(repo):
    result = _next(repo, "0" * 40)

    assert result.returncode != 0
    assert result.stdout == ""


def test_requires_a_sha_argument(repo):
    result = repo.run(NEXT_VERSION)

    assert result.returncode != 0
    assert result.stdout == ""


# --- tag-release.sh (S7) -----------------------------------------------------


class HealthServer:
    def __init__(self):
        self.body = "{}"
        self.status = 200
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                payload = outer.body.encode()
                self.send_response(outer.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/api/health"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def serve(self, **payload) -> None:
        self.body = json.dumps(payload)


@pytest.fixture
def health():
    server = HealthServer()
    server.thread.start()
    yield server
    server.server.shutdown()
    server.server.server_close()


@pytest.fixture
def released(repo, tmp_path) -> Repo:
    """The repo from `repo` plus a `fix` commit and a bare `origin` that already
    carries the bootstrap tag."""
    remote = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True, env=repo.env)
    repo.git("remote", "add", "origin", str(remote))
    repo.git("push", "-q", "origin", "main", "refs/tags/v1.3.0")
    repo.commit("fix: the release candidate")
    repo.remote = remote
    return repo


def _remote_tags(repo: Repo) -> list[str]:
    out = subprocess.run(
        ["git", "ls-remote", "--tags", str(repo.remote)],
        env=repo.env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return sorted(line.split("\t")[1] for line in out.splitlines())


def _tag(repo: Repo, health: HealthServer, sha: str | None = None):
    return repo.run(TAG_RELEASE, sha or repo.head(), health.url)


def test_tags_and_pushes_only_the_tag_when_production_serves_that_sha_and_version(released, health):
    sha = released.head()
    health.serve(sha=sha, version="1.3.1")

    result = _tag(released, health, sha)

    assert result.returncode == 0, result.stdout + result.stderr
    assert released.git("cat-file", "-t", "refs/tags/v1.3.1") == "tag", "must be annotated"
    assert released.git("rev-parse", "refs/tags/v1.3.1^{commit}") == sha
    assert _remote_tags(released) == [
        "refs/tags/v1.3.0",
        "refs/tags/v1.3.0^{}",
        "refs/tags/v1.3.1",
        "refs/tags/v1.3.1^{}",
    ]
    # Only the tag travels: the candidate commit stays unpublished.
    heads = subprocess.run(
        ["git", "ls-remote", "--heads", str(released.remote)],
        env=released.env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert sha not in heads


@pytest.mark.parametrize(
    "payload,needle",
    [
        pytest.param({"sha": "f" * 40, "version": "1.3.1"}, "sha", id="sha-mismatch"),
        pytest.param({"sha": "{sha}", "version": "1.4.0"}, "version", id="version-mismatch"),
        pytest.param({"sha": "{sha}", "version": "unversioned"}, "version", id="unversioned"),
        pytest.param({"sha": "{sha}"}, "version", id="no-version"),
        pytest.param({"version": "1.3.1"}, "sha", id="no-sha"),
        pytest.param({"sha": "{short}", "version": "1.3.1"}, "sha", id="short-sha"),
    ],
)
def test_refuses_and_creates_no_tag_when_production_does_not_match(released, health, payload, needle):
    sha = released.head()
    health.serve(
        **{k: v.format(sha=sha, short=sha[:7]) for k, v in payload.items()}
    )

    result = _tag(released, health, sha)

    assert result.returncode != 0
    assert needle in result.stderr
    assert released.git("tag", "-l", "v1.3.1") == ""
    assert _remote_tags(released) == ["refs/tags/v1.3.0", "refs/tags/v1.3.0^{}"]


def test_refuses_when_the_health_body_is_not_json(released, health):
    health.body = "<html>nope</html>"

    result = _tag(released, health)

    assert result.returncode != 0
    assert released.git("tag", "-l", "v1.3.1") == ""


def test_refuses_when_the_health_endpoint_fails(released, health):
    health.status = 502
    health.serve(sha=released.head(), version="1.3.1")

    result = _tag(released, health)

    assert result.returncode != 0
    assert released.git("tag", "-l", "v1.3.1") == ""


def test_refuses_when_the_tag_already_exists_locally(released, health):
    sha = released.head()
    released.tag("v1.3.1")
    health.serve(sha=sha, version="1.3.1")

    result = _tag(released, health, sha)

    # The existing tag makes the range empty or the tag a duplicate: either way,
    # nothing new is pushed.
    assert result.returncode != 0
    assert _remote_tags(released) == ["refs/tags/v1.3.0", "refs/tags/v1.3.0^{}"]


def test_refuses_when_the_tag_already_exists_on_the_remote(released, health):
    sha = released.head()
    other = subprocess.run(
        ["git", "clone", "-q", str(released.remote), str(released.path.parent / "other")],
        env=released.env,
        capture_output=True,
        text=True,
    )
    assert other.returncode == 0, other.stderr
    clone = Repo.__new__(Repo)
    clone.path = released.path.parent / "other"
    clone.env = released.env
    clone.git("config", "commit.gpgsign", "false")
    clone.git("config", "tag.gpgsign", "false")
    (clone.path / "x.txt").write_text("x")
    clone.git("add", "x.txt")
    clone.git("commit", "-q", "-m", "fix: someone else")
    clone.git("tag", "-a", "v1.3.1", "-m", "v1.3.1")
    clone.git("push", "-q", "origin", "refs/tags/v1.3.1")
    health.serve(sha=sha, version="1.3.1")

    result = _tag(released, health, sha)

    assert result.returncode != 0
    assert "v1.3.1" in result.stderr
    assert released.git("tag", "-l", "v1.3.1") == "", "no stale local tag may be left behind"


def test_does_not_tag_when_there_is_no_bootstrap_tag(tmp_path, health):
    r = Repo(tmp_path / "w")
    sha = r.commit("feat: first")
    health.serve(sha=sha, version="1.4.0")

    result = _tag(r, health, sha)

    assert result.returncode != 0
    assert "v1.3.0" in result.stderr
    assert r.git("tag", "-l") == ""


def test_requires_sha_and_health_url(released):
    assert released.run(TAG_RELEASE).returncode != 0
    assert released.run(TAG_RELEASE, released.head()).returncode != 0


# --- Make targets (S3, S7) ---------------------------------------------------


def _make(*args: str):
    return subprocess.run(
        ["make", "-C", str(ROOT), *args],
        capture_output=True,
        text=True,
    )


def test_release_version_target_requires_sha():
    result = _make("release-version")

    assert result.returncode != 0
    assert "SHA" in result.stderr


def test_release_tag_target_requires_sha_and_health_url():
    assert "SHA" in _make("release-tag", "HEALTH_URL=http://x.invalid").stderr
    assert "HEALTH_URL" in _make("release-tag", "SHA=abc").stderr
    assert _make("release-tag", "HEALTH_URL=http://x.invalid").returncode != 0
    assert _make("release-tag", "SHA=abc").returncode != 0


def test_release_targets_call_the_release_scripts():
    version = _make("-n", "release-version", "SHA=abc123").stdout
    tag = _make("-n", "release-tag", "SHA=abc123", "HEALTH_URL=https://x.invalid/api/health").stdout

    assert "scripts/release/next-version.sh" in version
    assert "APP_VERSION=" in version
    assert "scripts/release/tag-release.sh" in tag
    assert "https://x.invalid/api/health" in tag


def test_release_targets_are_in_the_help():
    helptext = _make("help").stdout

    assert "release-version" in helptext
    assert "release-tag" in helptext


def test_release_version_target_fails_closed_when_the_script_fails():
    # An unknown sha makes next-version.sh fail: the target must not print a
    # bare `APP_VERSION=` and exit 0.
    result = _make("release-version", "SHA=" + "0" * 40)

    assert result.returncode != 0
    assert "APP_VERSION=" not in result.stdout
