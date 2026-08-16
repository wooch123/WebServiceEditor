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

$backup = Get-ChildItem -LiteralPath $backupRoot -Directory |
  Where-Object { -not $_.Name.StartsWith(".incoming-") } |
  Sort-Object Name -Descending |
  Select-Object -First 1
if ($null -eq $backup) { throw "No verified offline backup is available" }

$drillJson = & $nodePath $cliPath `
  "--operation=restore-drill" `
  "--metadata-db=$metadataPath" `
  "--storage-root=$storageRoot" `
  "--backup-root=$backupRoot" `
  "--backup-id=$($backup.Name)"
if ($LASTEXITCODE -ne 0) { throw "Offline restore drill failed" }
$drill = $drillJson | ConvertFrom-Json
if ($drill.result -ne "PASS") { throw "Offline restore drill did not pass" }

New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null
$report = [ordered]@{
  schemaVersion = 1
  result = "PASS"
  evidenceComplete = $true
  generatedAt = [DateTime]::UtcNow.ToString("o")
  backupId = $backup.Name
  restoreDrill = $drill
  liveDataChanged = $false
}
$report | ConvertTo-Json -Depth 20 | Set-Content `
  -LiteralPath (Join-Path $reportRoot "restore-drill-latest.json") `
  -Encoding UTF8
$report | ConvertTo-Json -Depth 20
