[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $env:ProgramData "WebEditor\config\service.env"
$secretsPath = Join-Path $env:ProgramData "WebEditor\config\secrets.json"
$nodePath = Join-Path $InstallRoot "runtime\node.exe"
$entryPath = Join-Path $InstallRoot "app\server\dist\main.js"
$allowed = @(
  "WEBEDITOR_PORT",
  "WEBEDITOR_METADATA_DB_PATH",
  "WEBEDITOR_STORAGE_ROOT",
  "WEBEDITOR_CORPUS_MANIFEST_PATH",
  "WEBEDITOR_AUTH_REQUIRED",
  "WEBEDITOR_ADMIN_USERNAME",
  "WEBEDITOR_PUBLIC_ORIGIN",
  "WEBEDITOR_SECURE_COOKIES",
  "WEBEDITOR_SESSION_HOURS"
)

foreach ($path in @($configPath, $secretsPath, $nodePath, $entryPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required WebEditor service file is missing: $path"
  }
}

foreach ($line in [IO.File]::ReadAllLines($configPath)) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $separator = $line.IndexOf("=")
  if ($separator -lt 1) { throw "Invalid WebEditor service setting" }
  $name = $line.Substring(0, $separator)
  $value = $line.Substring($separator + 1)
  if ($allowed -notcontains $name -or $value.Contains("`r") -or $value.Contains("`n")) {
    throw "Unsupported WebEditor service setting: $name"
  }
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
}

$secrets = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
if ($secrets.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace($secrets.adminPasswordDpapi)) {
  throw "WebEditor encrypted service secret is invalid"
}
$protectedBytes = [Convert]::FromBase64String($secrets.adminPasswordDpapi)
$passwordBytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $protectedBytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::LocalMachine
)
try {
  [Environment]::SetEnvironmentVariable(
    "WEBEDITOR_ADMIN_PASSWORD",
    [Text.Encoding]::UTF8.GetString($passwordBytes),
    "Process"
  )
} finally {
  [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
  [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
}

& $nodePath $entryPath
exit $LASTEXITCODE
