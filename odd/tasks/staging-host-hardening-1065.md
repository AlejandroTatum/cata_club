# Feature: staging host hardening (#1065)

Issue: AlejandroTatum/cata_club#1065 — chore(ops): endurecer el acceso al
host: segunda clave, sudo acotado y fail2ban.

Owner decisions (2026-09-17):

- Sudo policy: **Alternative A** (passworded sudo). Remove `(ALL) NOPASSWD:
  ALL`; the deploy account password (currently locked) is set by the owner
  interactively. Nothing automated uses sudo, so A has zero automation
  friction.
- Second operator key: **deferred**. Issue stays open with that criterion
  explicit until a real second operator exists (out-of-band fingerprint
  verification is inherently human).
- fail2ban: **execute now** from the operator's machine, following
  provisioning.md Etapa 4 (drop-in `sshd-journal.local`, mandatory smoke;
  if the jail is blind, stop and report — ssh.socket is enabled, the
  "unverified mechanism" scenario).

Baseline (Etapa 0, read-only, 2026-09-17):

- `deploy@staging.cataclub.com`, key auth; groups: deploy, sudo, docker.
- `sudo -l`: `(ALL : ALL) ALL` + `(ALL) NOPASSWD: ALL`; `passwd -S deploy` → `L`.
- sshd effective: port 22, permitrootlogin no, passwordauthentication no,
  pubkey yes. `ssh` active/disabled; **`ssh.socket` enabled**.
- fail2ban not running (package presence to confirm).
- authorized_keys: 1 key (operator), 700/600 correct.
- 2268 failed/invalid SSH attempts in 24h.

Done before this feature (repo side, #1116 + #1206): runbook no longer
names the host user; leak-guard test added; full staged runbook in
provisioning.md marked "runbook, not record".

## Tasks

- [x] H1: fail2ban Etapa 4 — DONE 2026-09-17.
      Pre-checks: no package, no jail.d/, no jail.local, no [sshd] anywhere
      (clean slate). Install: apt fail2ban 1.0.2. Drop-in
      /etc/fail2ban/jail.d/sshd-journal.local (maxretry 5, findtime 10m,
      bantime 1h incremental max 1w, backend systemd) with no-clobber guard;
      `fail2ban-client -t` OK (allowipv6 warning cosmetic). enable+restart;
      active+enabled.
      Smoke (adapted, documented): PasswordAuthentication=no makes the
      runbook's wrong-password probe impossible, and failed-key-on-valid-user
      only logs `Connection closed by authenticating user` which mode=normal
      ignores by design. Equivalent probe: 3 invalid-user attempts from
      operator IP → Total failed 2→5, Currently failed 2→3 (counted live).
      Background invalid-user noise kept counting (2→8 over minutes) — the
      journalmatch `_SYSTEMD_UNIT=sshd.service` matches via alias although
      entries carry `ssh.service`. Action pipeline proven without risking the
      operator IP: manual `banip 192.0.2.10` (RFC 5737 TEST-NET, same
      convention as repo tests) → kernel nft set `addr-set-sshd` contained
      it → unban clean. No natural ban within minutes (distributed noise,
      few attempts per IP). sshd and ssh.socket never touched; control
      master session never at risk.
- [x] H2: sudo Etapa 5A — DONE 2026-09-17.
      Owner set deploy password interactively (verified `passwd -S deploy`
      → `P` 2026-09-17, agent never saw it). NOPASSWD source located:
      `/etc/sudoers.d/deploy` line 1 (single line, dedicated file);
      root's entry in `90-cloud-init-users` left untouched (console path,
      out of scope). Backup: `/root/deploy.sudoers.bak-20260917`.
      File rewritten comment-only via tee (in-place, preserves root:root
      0440) with motive + issue reference; `sudo chown` after it failed
      asking for a password — which itself proved sudo had re-parsed and
      NOPASSWD was dead at write time. `sudo -n true` → "a password is
      required" ✔. Owner verified from a fresh session: `sudo -k id` →
      uid=0(root); final chain: `visudo -c` all files parsed OK, stat →
      `root root 440`.

      INCIDENT (recovered): the password the owner believed set did not
      match what the host stored (set-time typo; interactive prompts, blind
      typing). With NOPASSWD gone, in-band sudo reset was impossible.
      Owner-authorized one-shot recovery via docker (deploy is in docker
      group; docker = root-equivalent): first attempt without `docker run
      -t` failed (pam_unix needs /dev/tty → "Password change has been
      aborted"), interactive retry over two pty layers hung on paste;
      deterministic path that worked: `ssh deploy@host 'docker run --rm -i
      -v /:/host alpine:3 chroot /host /usr/sbin/chpasswd'` with the
      owner pasting `deploy:<password>` blind + Ctrl-D. Also: an entry in
      the owner's manager held an SSH private key, not a password — root
      cause of the original set-time confusion. Lesson for the doc: set
      passwords by PASTE from the manager, never blind typing.
- [ ] H3: provisioning.md — turn "Estado: runbook, no registro" into an
      execution record with evidence; Etapa 5 resolved as A; second-key
      criterion explicitly deferred. Comment on #1065 with evidence.
- [ ] H4: PR (lane: smallest covering; docs+tests only), auto-merge
      squash, post-merge main CI green.

## Evidence log

(append per task)
