[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputRoot,
  [Parameter(Mandatory = $true)]
  [string]$WinSWPath,
  [Parameter(Mandatory = $true)]
  [string]$CloudflaredPath,
  [string]$NodePath = ""
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$outputPath = [IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $outputPath) {
  throw "OutputRoot must not already exist"
}
if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $NodePath = (Get-Command node.exe -ErrorAction Stop).Source
}
foreach ($path in @($WinSWPath, $CloudflaredPath, $NodePath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required release binary is missing: $path"
  }
}

& (Join-Path $PSScriptRoot "Test-WebEditorScripts.ps1") | Out-Null

Push-Location $repositoryRoot
try {
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "Production dependency installation failed" }
  & pnpm build
  if ($LASTEXITCODE -ne 0) { throw "Production build failed" }

  $schemaInfoJson = & $NodePath `
    (Join-Path $repositoryRoot "apps\server\dist\deployment\metadata-version-cli.js") `
    "--operation=supported"
  if ($LASTEXITCODE -ne 0) { throw "Could not read the supported metadata schema version" }
  $schemaInfo = $schemaInfoJson | ConvertFrom-Json
  if ($schemaInfo.supportedSchemaVersion -lt 1) {
    throw "Supported metadata schema version is invalid"
  }
  $sourceCommit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch "^[a-f0-9]{40}$") {
    throw "Could not identify the release source commit"
  }
  $sourceStatus = @(& git status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the release source tree" }
  $sourceTreeClean = $sourceStatus.Count -eq 0

  New-Item -ItemType Directory -Path $outputPath | Out-Null
  & pnpm --filter "@webeditor/server" deploy --prod --legacy (Join-Path $outputPath "app\server")
  if ($LASTEXITCODE -ne 0) { throw "Production server deployment failed" }
  New-Item -ItemType Directory -Force -Path (Join-Path $outputPath "app\web\dist") | Out-Null
  Copy-Item -Path (Join-Path $repositoryRoot "apps\web\dist\*") -Destination (Join-Path $outputPath "app\web\dist") -Recurse
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "webeditor_project_corpus_v3.json") -Destination (Join-Path $outputPath "app")
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "webeditor_theme_presets_v3.json") -Destination (Join-Path $outputPath "app")
  New-Item -ItemType Directory -Force -Path (Join-Path $outputPath "deployment\windows") | Out-Null
  Copy-Item -Path (Join-Path $repositoryRoot "deployment\windows\*") -Destination (Join-Path $outputPath "deployment\windows") -Recurse
  New-Item -ItemType Directory -Path (Join-Path $outputPath "runtime") | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $outputPath "cloudflared") | Out-Null
  Copy-Item -LiteralPath $NodePath -Destination (Join-Path $outputPath "runtime\node.exe")
  Copy-Item -LiteralPath $WinSWPath -Destination (Join-Path $outputPath "webeditor-service.exe")
  Copy-Item -LiteralPath (Join-Path $repositoryRoot "deployment\windows\webeditor-service.xml") -Destination $outputPath
  Copy-Item -LiteralPath $CloudflaredPath -Destination (Join-Path $outputPath "cloudflared\cloudflared.exe")

  $reparsePoints = @(Get-ChildItem -LiteralPath $outputPath -Force -Recurse | Where-Object {
    ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
  })
  if ($reparsePoints.Count -ne 0) {
    throw "Release payload contains a symbolic link or reparse point"
  }

  $records = @(Get-ChildItem -LiteralPath $outputPath -File -Recurse |
    Sort-Object FullName |
    ForEach-Object {
      [ordered]@{
        path = $_.FullName.Substring($outputPath.Length + 1).Replace("\", "/")
        size = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    })
  $releaseIdentity = ($records | ForEach-Object {
    "$($_.path)|$($_.size)|$($_.sha256)"
  }) -join "`n"
  $releaseIdentityBytes = [Text.Encoding]::UTF8.GetBytes($releaseIdentity)
  $releaseHasher = [Security.Cryptography.SHA256]::Create()
  try {
    $releaseId = [BitConverter]::ToString(
      $releaseHasher.ComputeHash($releaseIdentityBytes)
    ).Replace("-", "").ToLowerInvariant()
  } finally {
    $releaseHasher.Dispose()
    [Array]::Clear($releaseIdentityBytes, 0, $releaseIdentityBytes.Length)
  }
  $manifest = [ordered]@{
    schemaVersion = 2
    generatedAt = [DateTime]::UtcNow.ToString("o")
    platform = "win32-x64"
    appVersion = (Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json).version
    releaseId = $releaseId
    sourceCommit = $sourceCommit
    sourceTreeClean = $sourceTreeClean
    metadataSchemaVersion = [int]$schemaInfo.supportedSchemaVersion
    files = $records
    fileCount = $records.Count
    externalBinaries = [ordered]@{
      node = (Get-FileHash -LiteralPath $NodePath -Algorithm SHA256).Hash.ToLowerInvariant()
      winsw = (Get-FileHash -LiteralPath $WinSWPath -Algorithm SHA256).Hash.ToLowerInvariant()
      cloudflared = (Get-FileHash -LiteralPath $CloudflaredPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $outputPath "release-manifest.json") -Encoding UTF8
} finally {
  Pop-Location
}

Write-Output $outputPath
