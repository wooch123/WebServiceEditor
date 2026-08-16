# WebEditor Windows production deployment

This directory builds and installs the Phase 22 Windows package. Run all build
and install commands from an elevated PowerShell session on the target Windows
PC. The install keeps the origin on `127.0.0.1:3210`; the public route is the
Cloudflare Tunnel only.

## Prerequisites

- Windows 10/11 x64 or Windows Server 2016+
- Node.js 22.13 or newer and pnpm 11 for the release build
- A reviewed WinSW executable from the official WinSW release
- A reviewed `cloudflared.exe` from the official Cloudflare release
- A remotely managed Tunnel whose public hostname is
  `webeditor.dove9999.com` and whose service is `http://127.0.0.1:3210`

External binaries are supplied explicitly. The build never downloads or
silently upgrades them and records their SHA-256 values. Installation accepts
only a manifest built from a clean Git tree and bound to the exact source
commit, payload identity, and supported metadata schema.

## Build

The build first parses the complete deployment-script inventory with the local
PowerShell language parser and fails on any syntax error. To run that check
separately:

```powershell
.\deployment\windows\Test-WebEditorScripts.ps1
```

```powershell
.\deployment\windows\Build-WebEditorRelease.ps1 `
  -OutputRoot 'C:\Program Files\WebEditor' `
  -WinSWPath 'C:\Reviewed\WinSW-x64.exe' `
  -CloudflaredPath 'C:\Reviewed\cloudflared.exe'
```

## Install

Use secure prompts so neither the administrator password nor Tunnel token is
written into shell history.

```powershell
$adminPassword = Read-Host 'WebEditor administrator password' -AsSecureString
$tunnelToken = Read-Host 'Cloudflare Tunnel token' -AsSecureString
& 'C:\Program Files\WebEditor\deployment\windows\Install-WebEditor.ps1' `
  -AdminPassword $adminPassword `
  -TunnelToken $tunnelToken
```

The installer creates the automatic `WebEditor` service, installs the official
`cloudflared` service with a dependency on `WebEditor`, creates daily backup and
weekly restore-drill tasks, and runs an initial backup and drill. Project data,
metadata, logs, reports, and backups live under `%ProgramData%\WebEditor`.

## Reboot verification

Reboot Windows once after installation, then run:

```powershell
& 'C:\Program Files\WebEditor\deployment\windows\Test-WebEditorDeployment.ps1' `
  -InstallRoot 'C:\Program Files\WebEditor' `
  -RequireRebootEvidence `
  -ReportPath 'C:\Program Files\WebEditor\reports\deployment\windows-https-report.json'
```

The report passes only when a later boot is observed, both automatic services
are running, the listener is loopback-only, Health/Ready and public HTTPS pass,
and the scheduled backup and restore drill have passing evidence.

## Rollback drill

Keep a separately built and reviewed prior release outside the active install
directory. It must use release manifest schema 2 and support the live metadata
schema. Run the drill from an elevated prompt:

```powershell
& 'C:\Program Files\WebEditor\deployment\windows\Rollback-WebEditorRelease.ps1' `
  -InstallRoot 'C:\Program Files\WebEditor' `
  -RollbackReleaseRoot 'C:\Reviewed\WebEditor-previous' `
  -ReportPath 'C:\Program Files\WebEditor\reports\release\rollback-report.json'
```

The script verifies both inventories, creates and verifies an offline backup,
opens metadata read-only with the rollback candidate, and rejects an unknown
newer schema. It stops Tunnel before origin, preserves the current release,
starts the rollback origin through Ready, then restores Tunnel and public HTTPS.
If the candidate cannot start, it preserves that failed attempt and restores
the previous release. It does not delete either release or live data. Copy the
passing JSON report into the repository at the same `reports/release` path for
the final gate.
