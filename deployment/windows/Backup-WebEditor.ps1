[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$dataRoot = Join-Path $env:ProgramData "WebEditor"
$nodePath = Join-Path $InstallRoot "runtime\node.exe"
$cliPath = Join-Path $InstallRoot "app\server\dist\deployment\offline-backup-cli.js"
$metadataPath = Join-Path $dataRoot "metadata\webeditor.sqlite"
$storageRoot = Join-Path $dataRoot "projects"
$backupRoot = Join-Path $dataRoot "system-backups"
$reportRoot = Join-Path $dataRoot "reports"
New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null

$originService = Get-Service -Name "WebEditor"
$tunnelService = Get-Service -Name "cloudflared"
if ($originService.Status -ne "Running" -or $tunnelService.Status -ne "Running") {
  throw "WebEditor and cloudflared must be running before the scheduled backup"
}
$created = $null
$verified = $null
try {
  Stop-Service -Name "cloudflared"
  (Get-Service -Name "cloudflared").WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
  Stop-Service -Name "WebEditor"
  (Get-Service -Name "WebEditor").WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))

  $createdJson = & $nodePath $cliPath `
    "--operation=create" `
    "--metadata-db=$metadataPath" `
    "--storage-root=$storageRoot" `
    "--backup-root=$backupRoot"
  if ($LASTEXITCODE -ne 0) { throw "Offline backup creation failed" }
  $created = $createdJson | ConvertFrom-Json

  $verifiedJson = & $nodePath $cliPath `
    "--operation=verify" `
    "--metadata-db=$metadataPath" `
    "--storage-root=$storageRoot" `
    "--backup-root=$backupRoot" `
    "--backup-id=$($created.id)"
  if ($LASTEXITCODE -ne 0) { throw "Offline backup verification failed" }
  $verified = $verifiedJson | ConvertFrom-Json
} finally {
  if ((Get-Service -Name "WebEditor").Status -ne "Running") {
    Start-Service -Name "WebEditor"
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $response = Invoke-RestMethod -Uri "http://127.0.0.1:3210/api/v1/ready" -TimeoutSec 2
      if ($response.status -eq "ready") { $ready = $true; break }
    } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw "WebEditor did not recover after the scheduled backup" }
  if ((Get-Service -Name "cloudflared").Status -ne "Running") {
    Start-Service -Name "cloudflared"
  }
}
if ($null -eq $created -or $null -eq $verified) {
  throw "Offline backup did not produce verified evidence"
}

$report = [ordered]@{
  schemaVersion = 1
  result = "PASS"
  evidenceComplete = $true
  generatedAt = [DateTime]::UtcNow.ToString("o")
  serviceQuiesced = $true
  startupOrderRestored = $true
  backup = $created
  verification = $verified
}
$report | ConvertTo-Json -Depth 20 | Set-Content `
  -LiteralPath (Join-Path $reportRoot "backup-latest.json") `
  -Encoding UTF8
$report | ConvertTo-Json -Depth 20
