[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [SecureString]$AdminPassword,
  [Parameter(Mandatory = $true)]
  [SecureString]$TunnelToken,
  [string]$AdminUsername = "admin",
  [string]$PublicOrigin = "https://webeditor.dove9999.com",
  [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
  $InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)) { throw "Run the WebEditor installer as Administrator" }
if ($AdminUsername -notmatch "^[A-Za-z0-9._-]{3,64}$") { throw "Invalid administrator username" }
$origin = [Uri]$PublicOrigin
if ($origin.Scheme -ne "https" -or -not [string]::IsNullOrEmpty($origin.PathAndQuery.Trim('/'))) {
  throw "PublicOrigin must be an HTTPS origin without a path"
}

function Convert-SecureValue([SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Protect-LocalMachineValue([string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  try {
    $protected = [Security.Cryptography.ProtectedData]::Protect(
      $bytes,
      $null,
      [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [Convert]::ToBase64String($protected)
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

$adminPasswordValue = Convert-SecureValue $AdminPassword
$tunnelTokenValue = Convert-SecureValue $TunnelToken
if ($adminPasswordValue.Length -lt 8 -or $adminPasswordValue.Contains("`n") -or $adminPasswordValue.Contains("`r")) {
  throw "Administrator password must contain at least eight characters and no line breaks"
}
if ([string]::IsNullOrWhiteSpace($tunnelTokenValue) -or $tunnelTokenValue.Contains("`n") -or $tunnelTokenValue.Contains("`r")) {
  throw "Cloudflare Tunnel token is invalid"
}

$requiredFiles = @(
  "runtime\node.exe",
  "app\server\dist\main.js",
  "app\web\dist\index.html",
  "app\webeditor_project_corpus_v3.json",
  "webeditor-service.exe",
  "webeditor-service.xml",
  "cloudflared\cloudflared.exe",
  "release-manifest.json"
)
foreach ($relativePath in $requiredFiles) {
  $path = Join-Path $InstallRoot $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Release file is missing: $relativePath"
  }
}
$releaseManifest = Get-Content -LiteralPath (Join-Path $InstallRoot "release-manifest.json") -Raw | ConvertFrom-Json
if (
  $releaseManifest.schemaVersion -ne 2 -or
  $releaseManifest.platform -ne "win32-x64" -or
  $releaseManifest.releaseId -notmatch "^[a-f0-9]{64}$" -or
  $releaseManifest.sourceCommit -notmatch "^[a-f0-9]{40}$" -or
  $releaseManifest.sourceTreeClean -ne $true -or
  $releaseManifest.metadataSchemaVersion -lt 1
) {
  throw "Release manifest is invalid"
}
$manifestRecords = @($releaseManifest.files)
if ($releaseManifest.fileCount -ne $manifestRecords.Count -or $manifestRecords.Count -eq 0) {
  throw "Release manifest file count is invalid"
}
$installRootFullPath = [IO.Path]::GetFullPath($InstallRoot)
$installRootPrefix = $installRootFullPath.TrimEnd("\") + "\"
$reparsePoints = @(Get-ChildItem -LiteralPath $installRootFullPath -Force -Recurse | Where-Object {
  ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
})
if ($reparsePoints.Count -ne 0) {
  throw "Release payload contains a symbolic link or reparse point"
}
$manifestPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($record in $manifestRecords) {
  $portablePath = [string]$record.path
  if ([string]::IsNullOrWhiteSpace($portablePath) -or -not $manifestPaths.Add($portablePath)) {
    throw "Release manifest contains an empty or duplicate path"
  }
  $candidate = [IO.Path]::GetFullPath((Join-Path $InstallRoot $record.path.Replace("/", "\")))
  if (-not $candidate.StartsWith($installRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Release manifest path escapes InstallRoot"
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "Release manifest file is missing: $($record.path)"
  }
  $actualHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $record.sha256) {
    throw "Release checksum mismatch: $($record.path)"
  }
}
$actualPayloadFiles = @(Get-ChildItem -LiteralPath $InstallRoot -File -Recurse |
  Where-Object { $_.FullName -ne (Join-Path $InstallRoot "release-manifest.json") })
if ($actualPayloadFiles.Count -ne $manifestRecords.Count) {
  throw "Release payload contains an unmanifested or missing file"
}
foreach ($file in $actualPayloadFiles) {
  $portablePath = $file.FullName.Substring($installRootFullPath.Length + 1).Replace("\", "/")
  if (-not $manifestPaths.Contains($portablePath)) {
    throw "Release payload contains an unmanifested file: $portablePath"
  }
}
$externalBinaryPaths = [ordered]@{
  node = Join-Path $InstallRoot "runtime\node.exe"
  winsw = Join-Path $InstallRoot "webeditor-service.exe"
  cloudflared = Join-Path $InstallRoot "cloudflared\cloudflared.exe"
}
foreach ($binaryName in $externalBinaryPaths.Keys) {
  $expectedHash = [string]$releaseManifest.externalBinaries.$binaryName
  $actualHash = (Get-FileHash -LiteralPath $externalBinaryPaths[$binaryName] -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expectedHash -notmatch "^[a-f0-9]{64}$" -or $actualHash -ne $expectedHash) {
    throw "Release external binary checksum mismatch: $binaryName"
  }
}
if ($null -ne (Get-Service -Name "WebEditor" -ErrorAction SilentlyContinue)) {
  throw "WebEditor service is already installed"
}
if ($null -ne (Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue)) {
  throw "cloudflared service is already installed; review it before installation"
}

$dataRoot = Join-Path $env:ProgramData "WebEditor"
$configRoot = Join-Path $dataRoot "config"
foreach ($path in @(
  $configRoot,
  (Join-Path $dataRoot "metadata"),
  (Join-Path $dataRoot "projects"),
  (Join-Path $dataRoot "system-backups"),
  (Join-Path $dataRoot "reports"),
  (Join-Path $dataRoot "logs")
)) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
& icacls.exe $dataRoot /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not secure the WebEditor data directory" }

$settings = @(
  "WEBEDITOR_PORT=3210",
  "WEBEDITOR_METADATA_DB_PATH=$(Join-Path $dataRoot 'metadata\webeditor.sqlite')",
  "WEBEDITOR_STORAGE_ROOT=$(Join-Path $dataRoot 'projects')",
  "WEBEDITOR_CORPUS_MANIFEST_PATH=$(Join-Path $InstallRoot 'app\webeditor_project_corpus_v3.json')",
  "WEBEDITOR_AUTH_REQUIRED=true",
  "WEBEDITOR_ADMIN_USERNAME=$AdminUsername",
  "WEBEDITOR_PUBLIC_ORIGIN=$($origin.AbsoluteUri.TrimEnd('/'))",
  "WEBEDITOR_SECURE_COOKIES=true",
  "WEBEDITOR_SESSION_HOURS=8"
)
[IO.File]::WriteAllLines((Join-Path $configRoot "service.env"), $settings)
@{
  schemaVersion = 1
  adminPasswordDpapi = Protect-LocalMachineValue $adminPasswordValue
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $configRoot "secrets.json") -Encoding UTF8

$bootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString("o")
@{
  schemaVersion = 1
  installedAt = [DateTime]::UtcNow.ToString("o")
  bootAtInstall = $bootTime
  installRoot = $InstallRoot
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $configRoot "install-state.json") -Encoding UTF8

& (Join-Path $InstallRoot "webeditor-service.exe") install
if ($LASTEXITCODE -ne 0) { throw "WebEditor Windows service installation failed" }
Start-Service -Name "WebEditor"
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:3210/api/v1/ready" -TimeoutSec 2
    if ($response.status -eq "ready") { $ready = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw "WebEditor did not become ready" }

& (Join-Path $InstallRoot "cloudflared\cloudflared.exe") service install $tunnelTokenValue
if ($LASTEXITCODE -ne 0) { throw "cloudflared Windows service installation failed" }
Stop-Service -Name "cloudflared" -ErrorAction SilentlyContinue
& sc.exe config cloudflared start= delayed-auto depend= WebEditor | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not configure cloudflared startup ordering" }
Start-Service -Name "cloudflared"

$backupAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
  '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
  (Join-Path $InstallRoot "deployment\windows\Backup-WebEditor.ps1") +
  '" -InstallRoot "' + $InstallRoot + '"'
)
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "02:15"
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "WebEditor-DailyBackup" -Action $backupAction -Trigger $backupTrigger -Settings $taskSettings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

$drillAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
  '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
  (Join-Path $InstallRoot "deployment\windows\RestoreDrill-WebEditor.ps1") +
  '" -InstallRoot "' + $InstallRoot + '"'
)
$drillTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "03:00"
Register-ScheduledTask -TaskName "WebEditor-WeeklyRestoreDrill" -Action $drillAction -Trigger $drillTrigger -Settings $taskSettings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

& (Join-Path $InstallRoot "deployment\windows\Backup-WebEditor.ps1") -InstallRoot $InstallRoot | Out-Null
& (Join-Path $InstallRoot "deployment\windows\RestoreDrill-WebEditor.ps1") -InstallRoot $InstallRoot | Out-Null

$adminPasswordValue = $null
$tunnelTokenValue = $null
Write-Output "WebEditor is installed. Reboot Windows, then run Test-WebEditorDeployment.ps1 -RequireRebootEvidence."
