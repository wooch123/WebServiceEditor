# ADR 0022: Windows production service, tunnel, and offline recovery

Status: accepted

## Context

Phase 22 must turn the verified local application into a reboot-safe Windows
deployment. The Fastify origin must remain local-only, Cloudflare Tunnel must
be the only public path, and backups must cover metadata plus every isolated
Test and Production runtime database without stopping the service.

## Decision

- The release bundles the production server, web assets, a pinned Node runtime,
  operator-supplied WinSW and `cloudflared` binaries, and a checksummed release
  manifest. Manifest v2 also binds the source commit, clean-tree state, payload
  identity, and maximum metadata schema version. WinSW runs the Node process as
  the automatic `WebEditor` Windows service with restart-on-failure and delayed
  startup.
- The origin remains bound to `127.0.0.1:3210`. Authentication, secure cookies,
  the HTTPS public origin, and the administrator password are mandatory service
  settings stored below `%ProgramData%\WebEditor\config` with inheritance
  removed and access limited to SYSTEM and Administrators. The administrator
  password is additionally encrypted with Windows DPAPI in LocalMachine scope;
  it is never stored as plaintext in the service environment file.
- The official `cloudflared service install <TOKEN>` path installs the Tunnel
  service. The installer adds a dependency on `WebEditor`, so Tunnel startup
  cannot precede the origin service. The remotely managed Tunnel route must
  point `webeditor.dove9999.com` to `http://127.0.0.1:3210`.
- Task Scheduler runs a full backup every day and an isolated restore drill
  every week as SYSTEM. The scheduled backup briefly stops Tunnel first and
  origin second, then restarts origin through Ready before Tunnel. SQLite files
  additionally use the SQLite online backup API; copied payloads are
  checksummed, integrity checked, and never restored over live data by the
  drill.
- The final deployment report is valid only after a later Windows boot is
  observed, both services are running automatically, Health and Ready pass,
  HTTPS passes, only loopback owns the origin listener, scheduled recovery
  tasks exist, and the latest backup and restore drill both pass.
- Rollback accepts only a different, fully checksummed release whose read-only
  metadata inspector proves the live application ID, `quick_check`, and schema
  compatibility. It first creates and verifies an offline backup, stages and
  revalidates the complete candidate, stops Tunnel before origin, preserves the
  replaced installation under a unique sibling path, and swaps paths without
  deleting data. Origin must reach Ready before Tunnel and public HTTPS are
  restored. A failed candidate is also preserved and the previous installation
  is moved back before services restart. Only that real Windows drill may emit
  `reports/release/rollback-report.json` with passing evidence.

## Consequences

- Repository tests and non-Windows simulation can prove packaging, security,
  backup consistency, and report validation, but cannot claim reboot evidence.
- Installation fails closed when required binaries, release checksums, secrets,
  service state, or backup evidence are missing. Reinstallation never deletes
  `%ProgramData%\WebEditor` project data or backups.
- A release built from a dirty source tree is recorded but rejected by the
  installer. A rollback is rejected when the candidate cannot read the current
  metadata schema; the script never migrates or overwrites live data while
  deciding compatibility.
- WinSW and Cloudflare Tunnel are external components. Their binaries are not
  downloaded implicitly; an operator supplies reviewed binaries and the build
  records their SHA-256 values in the release manifest.
