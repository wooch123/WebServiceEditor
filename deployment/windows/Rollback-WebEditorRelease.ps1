[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [Parameter(Mandatory = $true)]
  [string]$RollbackReleaseRoot,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)) { throw "Run the WebEditor rollback as Administrator" }

function Test-ReleasePayload([string]$Root, [bool]$AllowReportFiles) {
  $rootFull = [IO.Path]::GetFullPath($Root)
  $manifestPath = Join-Path $rootFull "release-manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Rollback release manifest is missing"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if (
    $manifest.schemaVersion -ne 2 -or
    $manifest.platform -ne "win32-x64" -or
    $manifest.releaseId -notmatch "^[a-f0-9]{64}$" -or
    $manifest.sourceCommit -notmatch "^[a-f0-9]{40}$" -or
    $manifest.sourceTreeClean -ne $true -or
    $manifest.metadataSchemaVersion -lt 1
  ) { throw "Rollback release manifest is invalid" }

  $reparsePoints = @(Get-ChildItem -LiteralPath $rootFull -Force -Recurse | Where-Object {
    ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
  })
  if ($reparsePoints.Count -ne 0) {
    throw "Rollback release contains a symbolic link or reparse point"
  }

  $records = @($manifest.files)
  if ($manifest.fileCount -ne $records.Count -or $records.Count -eq 0) {
    throw "Rollback release manifest file count is invalid"
  }
  $rootPrefix = $rootFull.TrimEnd("\") + "\"
  $paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($record in $records) {
    $portablePath = [string]$record.path
    if ([string]::IsNullOrWhiteSpace($portablePath) -or -not $paths.Add($portablePath)) {
      throw "Rollback release manifest contains an empty or duplicate path"
    }
    $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $portablePath.Replace("/", "\")))
    if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Rollback release manifest path escapes its root"
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw "Rollback release file is missing: $portablePath"
    }
    $actualHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($record.sha256 -notmatch "^[a-f0-9]{64}$" -or $actualHash -ne $record.sha256) {
      throw "Rollback release checksum mismatch: $portablePath"
    }
  }

  $payloadFiles = @(Get-ChildItem -LiteralPath $rootFull -File -Recurse | Where-Object {
    if ($_.FullName -eq $manifestPath) { return $false }
    if ($AllowReportFiles) {
      $reportsPrefix = (Join-Path $rootFull "reports").TrimEnd("\") + "\"
      if ($_.FullName.StartsWith($reportsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        return $false
      }
    }
    return $true
  })
  if ($payloadFiles.Count -ne $records.Count) {
    throw "Rollback release payload contains an unmanifested or missing file"
  }
  foreach ($file in $payloadFiles) {
    $portablePath = $file.FullName.Substring($rootFull.Length + 1).Replace("\", "/")
    if (-not $paths.Contains($portablePath)) {
      throw "Rollback release payload contains an unmanifested file: $portablePath"
    }
  }
  return $manifest
}

function Wait-WebEditorReady() {
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $response = Invoke-RestMethod -Uri "http://127.0.0.1:3210/api/v1/ready" -TimeoutSec 2
      if ($response.status -eq "ready") { return }
    } catch { Start-Sleep -Seconds 1 }
  }
  throw "WebEditor did not become ready after rollback"
}

$installFull = [IO.Path]::GetFullPath($InstallRoot).TrimEnd("\")
$rollbackFull = [IO.Path]::GetFullPath($RollbackReleaseRoot).TrimEnd("\")
if ($installFull -eq $rollbackFull) { throw "Rollback release must be separate from InstallRoot" }
$installPrefix = $installFull + "\"
if ($rollbackFull.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Rollback release cannot be stored inside InstallRoot"
}
if (-not (Test-Path -LiteralPath $installFull -PathType Container)) {
  throw "Current WebEditor installation is missing"
}

$currentManifest = Test-ReleasePayload $installFull $true
$rollbackManifest = Test-ReleasePayload $rollbackFull $false
if ($currentManifest.releaseId -eq $rollbackManifest.releaseId) {
  throw "Rollback release must differ from the installed release"
}

$installParent = Split-Path -Parent $installFull
$operationId = [Guid]::NewGuid().ToString("N")
$stageRoot = Join-Path $installParent ".webeditor-rollback-incoming-$operationId"
$previousInstallRoot = "$installFull.replaced-$operationId"
$failedAttemptRoot = "$installFull.rollback-failed-$operationId"
foreach ($path in @($stageRoot, $previousInstallRoot, $failedAttemptRoot)) {
  if (Test-Path -LiteralPath $path) { throw "Rollback staging target already exists: $path" }
}
Copy-Item -LiteralPath $rollbackFull -Destination $stageRoot -Recurse
$stagedManifest = Test-ReleasePayload $stageRoot $false
if ($stagedManifest.releaseId -ne $rollbackManifest.releaseId) {
  throw "Staged rollback identity changed during copy"
}

$metadataPath = Join-Path $env:ProgramData "WebEditor\metadata\webeditor.sqlite"
$schemaJson = & (Join-Path $stageRoot "runtime\node.exe") `
  (Join-Path $stageRoot "app\server\dist\deployment\metadata-version-cli.js") `
  "--operation=inspect" `
  "--metadata-db=$metadataPath"
if ($LASTEXITCODE -ne 0) { throw "Rollback release cannot open the current metadata schema" }
$schemaInspection = $schemaJson | ConvertFrom-Json
if (
  $schemaInspection.applicationIdValid -ne $true -or
  $schemaInspection.quickCheck -ne "ok" -or
  $schemaInspection.supportedSchemaVersion -ne $stagedManifest.metadataSchemaVersion -or
  $schemaInspection.userVersion -gt $stagedManifest.metadataSchemaVersion
) { throw "Rollback release metadata compatibility check failed" }

$backupJson = & (Join-Path $installFull "deployment\windows\Backup-WebEditor.ps1") `
  -InstallRoot $installFull
if ($LASTEXITCODE -ne 0) { throw "Pre-rollback backup failed" }
$backupReport = $backupJson | ConvertFrom-Json
if ($backupReport.result -ne "PASS" -or $backupReport.verification.result -ne "PASS") {
  throw "Pre-rollback backup is not verified"
}

$currentMoved = $false
$candidateActivated = $false
Set-Location $installParent
try {
  Stop-Service -Name "cloudflared"
  (Get-Service -Name "cloudflared").WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
  Stop-Service -Name "WebEditor"
  (Get-Service -Name "WebEditor").WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
  Move-Item -LiteralPath $installFull -Destination $previousInstallRoot
  $currentMoved = $true
  Move-Item -LiteralPath $stageRoot -Destination $installFull
  $candidateActivated = $true
  Start-Service -Name "WebEditor"
  Wait-WebEditorReady
  Start-Service -Name "cloudflared"
  (Get-Service -Name "cloudflared").WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
  $publicOrigin = "https://webeditor.dove9999.com"
  $publicHealth = Invoke-RestMethod -Uri "$publicOrigin/api/v1/health" -TimeoutSec 30
  if ($publicHealth.status -ne "ok") { throw "Public HTTPS health failed after rollback" }

  if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $installFull "reports\release\rollback-report.json"
  }
  $report = [ordered]@{
    schemaVersion = 1
    result = "PASS"
    evidenceComplete = $true
    generatedAt = [DateTime]::UtcNow.ToString("o")
    operationId = $operationId
    fromReleaseId = [string]$currentManifest.releaseId
    toReleaseId = [string]$stagedManifest.releaseId
    sourceCommit = [string]$stagedManifest.sourceCommit
    metadata = [ordered]@{
      userVersion = [int]$schemaInspection.userVersion
      supportedSchemaVersion = [int]$schemaInspection.supportedSchemaVersion
      applicationIdValid = $true
      quickCheck = "ok"
    }
    preRollbackBackup = [ordered]@{
      result = [string]$backupReport.result
      backupId = [string]$backupReport.backup.id
      checksum = [string]$backupReport.backup.contentChecksum
      verified = $backupReport.verification.result -eq "PASS"
    }
    services = [ordered]@{
      originReady = $true
      tunnelRunning = $true
      publicHttpsHealth = [string]$publicHealth.status
    }
    previousInstallPreserved = $true
    previousInstallPath = $previousInstallRoot
    liveDataReplaced = $false
    rollbackVerified = $true
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
  $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  $report | ConvertTo-Json -Depth 20
} catch {
  if ($currentMoved) {
    Stop-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    Stop-Service -Name "WebEditor" -ErrorAction SilentlyContinue
    if ($candidateActivated -and (Test-Path -LiteralPath $installFull)) {
      Move-Item -LiteralPath $installFull -Destination $failedAttemptRoot
    }
    if (Test-Path -LiteralPath $previousInstallRoot) {
      Move-Item -LiteralPath $previousInstallRoot -Destination $installFull
    }
    Start-Service -Name "WebEditor"
    Wait-WebEditorReady
    Start-Service -Name "cloudflared"
  } else {
    if ((Get-Service -Name "WebEditor").Status -ne "Running") {
      Start-Service -Name "WebEditor"
    }
    Wait-WebEditorReady
    if ((Get-Service -Name "cloudflared").Status -ne "Running") {
      Start-Service -Name "cloudflared"
    }
  }
  throw
}
