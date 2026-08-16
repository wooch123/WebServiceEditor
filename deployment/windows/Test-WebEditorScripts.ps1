[CmdletBinding()]
param(
  [string]$ScriptRoot = $PSScriptRoot,
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
$resolvedRoot = (Resolve-Path -LiteralPath $ScriptRoot).Path
$scripts = @(Get-ChildItem -LiteralPath $resolvedRoot -Filter "*.ps1" -File | Sort-Object Name)
if ($scripts.Count -ne 8) { throw "Windows deployment script inventory is not exact" }

$records = foreach ($script in $scripts) {
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    $script.FullName,
    [ref]$tokens,
    [ref]$errors
  )
  if ($errors.Count -gt 0) {
    $messages = @($errors | ForEach-Object { $_.Message }) -join "; "
    throw "PowerShell parser rejected $($script.Name): $messages"
  }
  [ordered]@{
    name = $script.Name
    sha256 = (Get-FileHash -LiteralPath $script.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    tokenCount = $tokens.Count
    parseErrorCount = 0
  }
}

$report = [ordered]@{
  schemaVersion = 1
  result = "PASS"
  evidenceComplete = $true
  generatedAt = [DateTime]::UtcNow.ToString("o")
  powershellVersion = $PSVersionTable.PSVersion.ToString()
  scriptCount = $records.Count
  scripts = @($records)
}
if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
  $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
}
$report | ConvertTo-Json -Depth 10
