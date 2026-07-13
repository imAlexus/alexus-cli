[CmdletBinding()]
param(
  [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repository = "imAlexus/alexus-cli"
$MinimumNodeMajor = 22
$Headers = @{
  Accept = "application/vnd.github+json"
  "User-Agent" = "Alexus-Installer"
  "X-GitHub-Api-Version" = "2022-11-28"
}

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-Release {
  $endpoint = if ($Version -eq "latest") {
    "https://api.github.com/repos/$Repository/releases/latest"
  } else {
    $tag = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }
    "https://api.github.com/repos/$Repository/releases/tags/$tag"
  }

  Invoke-RestMethod -Uri $endpoint -Headers $Headers
}

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "Questo installer supporta Windows. Su Linux/macOS installa il pacchetto npm della release."
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  throw "Node.js 22+ non è installato o non è nel PATH. Scaricalo da https://nodejs.org/ e rilancia questo comando."
}

$nodeVersion = (& $node.Source --version).Trim().TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt $MinimumNodeMajor) {
  throw "Node.js $nodeVersion non è supportato. Installa Node.js 22 o superiore."
}

Write-Step "Recupero della release Alexus"
$release = Get-Release
$packageVersion = $release.tag_name.TrimStart("v")
$packageName = "alexus-cli-$packageVersion.tgz"
$checksumName = "$packageName.sha256"
$packageAsset = $release.assets | Where-Object name -eq $packageName | Select-Object -First 1
$checksumAsset = $release.assets | Where-Object name -eq $checksumName | Select-Object -First 1

if (-not $packageAsset -or -not $checksumAsset) {
  throw "La release $($release.tag_name) non contiene gli asset di installazione richiesti."
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "alexus-install-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
  $packageFile = Join-Path $tempRoot $packageName
  $checksumFile = Join-Path $tempRoot $checksumName

  Write-Step "Download di Alexus $packageVersion"
  Invoke-WebRequest -Uri $packageAsset.browser_download_url -OutFile $packageFile -Headers $Headers
  Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumFile -Headers $Headers

  $expectedHash = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split "\s+")[0].ToUpperInvariant()
  $actualHash = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "Checksum SHA-256 non valido. Download interrotto."
  }

  Write-Step "Installazione globale tramite npm"
  & $npm.Source install --global $packageFile --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm non ha completato l'installazione." }

  $npmPrefix = (& $npm.Source prefix --global).Trim()
  $alexusCommand = Join-Path $npmPrefix "alexus.cmd"
  if (-not (Test-Path -LiteralPath $alexusCommand)) {
    throw "Installazione completata, ma alexus.cmd non è stato trovato in $npmPrefix."
  }

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathParts = @($currentUserPath -split ";" | Where-Object { $_ })
  if ($pathParts -notcontains $npmPrefix) {
    [Environment]::SetEnvironmentVariable("Path", (($pathParts + $npmPrefix) -join ";"), "User")
    $env:Path = "$env:Path;$npmPrefix"
    Write-Step "Aggiunto $npmPrefix al PATH utente"
  }

  $installedVersion = (& $alexusCommand --version).Trim()
  Write-Host ""
  Write-Host "Alexus CLI $installedVersion installato correttamente." -ForegroundColor Green
  Write-Host "Configura OPENROUTER_API_KEY, poi esegui: alexus init"
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
