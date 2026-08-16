[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [switch]$RequireRebootEvidence,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
$dataRoot = Join-Path $env:ProgramData "WebEditor"
$configPath = Join-Path $dataRoot "config\service.env"
$installStatePath = Join-Path $dataRoot "config\install-state.json"
$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($configPath)) {
  $separator = $line.IndexOf("=")
  if ($separator -gt 0) {
    $settings[$line.Substring(0, $separator)] = $line.Substring($separator + 1)
  }
}
$port = [int]$settings["WEBEDITOR_PORT"]
$publicOrigin = [Uri]$settings["WEBEDITOR_PUBLIC_ORIGIN"]
if ($publicOrigin.Scheme -ne "https") { throw "Public origin is not HTTPS" }

$originService = Get-CimInstance Win32_Service -Filter "Name='WebEditor'"
$tunnelService = Get-CimInstance Win32_Service -Filter "Name='cloudflared'"
if ($null -eq $originService -or $null -eq $tunnelService) {
  throw "Required Windows services are not installed"
}
if ($originService.State -ne "Running" -or $tunnelService.State -ne "Running") {
  throw "Required Windows services are not running"
}
if ($originService.StartMode -ne "Auto" -or $tunnelService.StartMode -ne "Auto") {
  throw "Required Windows services are not automatic"
}
$startupOrdered = @((Get-Service -Name "cloudflared").ServicesDependedOn.Name) -contains "WebEditor"
if (-not $startupOrdered) { throw "cloudflared does not depend on WebEditor" }

$allowedAclSids = @("S-1-5-18", "S-1-5-32-544")
foreach ($securedPath in @(
  $dataRoot,
  (Join-Path $dataRoot "config"),
  (Join-Path $dataRoot "metadata"),
  (Join-Path $dataRoot "projects"),
  (Join-Path $dataRoot "system-backups"),
  (Join-Path $dataRoot "reports"),
  (Join-Path $dataRoot "logs")
)) {
  $acl = Get-Acl -LiteralPath $securedPath
  if (-not $acl.AreAccessRulesProtected) {
    throw "WebEditor data ACL inherits unexpected permissions: $securedPath"
  }
  $unexpectedRules = @($acl.Access | Where-Object {
    if ($_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { return $false }
    $sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    return $allowedAclSids -notcontains $sid
  })
  if ($unexpectedRules.Count -ne 0) {
    throw "WebEditor data ACL grants an unexpected principal: $securedPath"
  }
}

$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port)
if ($listeners.Count -eq 0) { throw "WebEditor origin is not listening" }
$nonLoopback = @($listeners | Where-Object {
  $_.LocalAddress -notin @("127.0.0.1", "::1")
})
if ($nonLoopback.Count -ne 0) { throw "WebEditor origin is not loopback-only" }

$health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 15
$ready = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/ready" -TimeoutSec 30
$publicHealth = Invoke-RestMethod -Uri "$($publicOrigin.AbsoluteUri.TrimEnd('/'))/api/v1/health" -TimeoutSec 30
if ($health.status -ne "ok" -or $ready.status -ne "ready" -or $publicHealth.status -ne "ok") {
  throw "Health, Ready, or HTTPS verification failed"
}

$backupTask = Get-ScheduledTask -TaskName "WebEditor-DailyBackup"
$drillTask = Get-ScheduledTask -TaskName "WebEditor-WeeklyRestoreDrill"
foreach ($task in @($backupTask, $drillTask)) {
  if ($task.State -eq "Disabled" -or $task.Principal.UserId -notin @("SYSTEM", "S-1-5-18")) {
    throw "WebEditor recovery task is disabled or does not run as SYSTEM: $($task.TaskName)"
  }
}
$backupReport = Get-Content -LiteralPath (Join-Path $dataRoot "reports\backup-latest.json") -Raw | ConvertFrom-Json
$drillReport = Get-Content -LiteralPath (Join-Path $dataRoot "reports\restore-drill-latest.json") -Raw | ConvertFrom-Json
if ($backupReport.result -ne "PASS" -or $drillReport.result -ne "PASS") {
  throw "Backup or restore drill evidence is not passing"
}

$installState = Get-Content -LiteralPath $installStatePath -Raw | ConvertFrom-Json
$currentBoot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime()
$installedBoot = [DateTime]::Parse($installState.bootAtInstall).ToUniversalTime()
$rebootVerified = $currentBoot -gt $installedBoot
if ($RequireRebootEvidence -and -not $rebootVerified) {
  throw "A Windows reboot after installation has not been observed"
}

$report = [ordered]@{
  schemaVersion = 1
  result = if ($RequireRebootEvidence) { "PASS" } else { "PENDING_REBOOT" }
  evidenceComplete = [bool]$RequireRebootEvidence
  generatedAt = [DateTime]::UtcNow.ToString("o")
  host = $env:COMPUTERNAME
  publicOrigin = $publicOrigin.AbsoluteUri.TrimEnd("/")
  origin = [ordered]@{
    host = "127.0.0.1"
    port = $port
    loopbackOnly = $true
    health = $health.status
    ready = $ready.status
  }
  services = [ordered]@{
    webeditor = [ordered]@{ state = $originService.State; startMode = $originService.StartMode }
    cloudflared = [ordered]@{ state = $tunnelService.State; startMode = $tunnelService.StartMode }
    startupOrdered = $startupOrdered
  }
  security = [ordered]@{ dataAclRestricted = $true }
  https = [ordered]@{ status = $publicHealth.status; hostname = $publicOrigin.Host }
  recovery = [ordered]@{
    dailyTask = $backupTask.TaskName
    weeklyDrillTask = $drillTask.TaskName
    dailyTaskState = [string]$backupTask.State
    weeklyDrillTaskState = [string]$drillTask.State
    tasksRunAsSystem = $true
    backupStatus = $backupReport.result
    restoreDrillStatus = $drillReport.result
  }
  rebootVerified = $rebootVerified
}
$recoveryReportPath = Join-Path $InstallRoot "reports\recovery\backup-restore-report.json"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $recoveryReportPath) | Out-Null
@{
  schemaVersion = 1
  result = "PASS"
  evidenceComplete = $true
  generatedAt = [DateTime]::UtcNow.ToString("o")
  backup = $backupReport
  restoreDrill = $drillReport
} | ConvertTo-Json -Depth 24 | Set-Content -LiteralPath $recoveryReportPath -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  $ReportPath = Join-Path $InstallRoot "reports\deployment\windows-https-report.json"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 20
