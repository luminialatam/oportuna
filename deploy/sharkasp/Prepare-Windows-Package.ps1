param(
  [Parameter(Mandatory = $true)] [ValidateSet('Smoke', 'Production')] [string] $Mode,
  [Parameter(Mandatory = $true)] [ValidateRange(1, 99)] [int] $ExpectedNodeMajor,
  [Parameter(Mandatory = $true)] [string] $OutputZip
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { throw 'Ejecuta este empaquetador en Windows x64.' }

$nodePlatform = & node -p "process.platform"
$nodeArch = & node -p "process.arch"
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodePlatform -ne 'win32' -or $nodeArch -ne 'x64') { throw 'El Node de empaquetado debe ser Windows x64.' }
if ($nodeMajor -ne $ExpectedNodeMajor) { throw "La versión mayor de Node local ($nodeMajor) no coincide con la confirmada por SharkASP ($ExpectedNodeMajor)." }
if ($nodeMajor -lt 18) { throw 'Oportuna requiere Node 18 o superior (fetch global del backend). Confirma una versión compatible con SharkASP.' }

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$frontendBuild = Join-Path $projectRoot 'dist'
$backendBuild = Join-Path $projectRoot 'dist-server'
if (-not (Test-Path (Join-Path $frontendBuild 'index.html'))) { throw 'Falta dist/index.html; ejecuta npm run build en el proyecto antes.' }
$entry = if ($Mode -eq 'Smoke') { 'server/src/sharkAspSmokeServer.js' } else { 'server/src/index.js' }
if (-not (Test-Path (Join-Path $backendBuild $entry))) { throw "Falta el entrypoint compilado dist-server/$entry." }

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("oportuna-sharkasp-" + [guid]::NewGuid().ToString('N'))
$archive = [System.IO.Path]::GetFullPath($OutputZip)
try {
  New-Item -ItemType Directory -Path $stage | Out-Null
  Copy-Item $frontendBuild (Join-Path $stage 'dist') -Recurse
  Copy-Item $backendBuild (Join-Path $stage 'dist-server') -Recurse
  Copy-Item (Join-Path $PSScriptRoot 'sharkasp-bootstrap.mjs') $stage
  Copy-Item (Join-Path $projectRoot 'package.json') $stage
  Copy-Item (Join-Path $projectRoot 'package-lock.json') $stage

  $templateName = if ($Mode -eq 'Smoke') { 'web.config.template' } else { 'web.config.production.template' }
  $configTemplate = Join-Path $PSScriptRoot $templateName
  $config = Get-Content -Raw $configTemplate
  Set-Content -Path (Join-Path $stage 'web.config') -Value $config -Encoding UTF8

  Push-Location $stage
  try {
    & npm.cmd ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm ci --omit=dev falló para Windows x64.' }
    $argonPrebuilds = Join-Path $stage 'node_modules/argon2/prebuilds'
    if (Test-Path $argonPrebuilds) {
      Get-ChildItem $argonPrebuilds -Directory | Where-Object { $_.Name -ne 'win32-x64' } | Remove-Item -Recurse -Force
      if (-not (Test-Path (Join-Path $argonPrebuilds 'win32-x64/argon2.glibc.node'))) { throw 'Falta el binario Argon2 precompilado para Windows x64.' }
    } else { throw 'No se encontraron prebuilds de Argon2 en las dependencias.' }
  } finally { Pop-Location }

  if (Test-Path $archive) { Remove-Item $archive -Force }
  $archiveDirectory = Split-Path -Parent $archive
  if (-not (Test-Path $archiveDirectory)) { New-Item -ItemType Directory -Path $archiveDirectory -Force | Out-Null }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal
  Write-Output "Paquete generado: $archive"
  Write-Output "Modo: $Mode; Node Windows x64 mayor $nodeMajor; node_modules de producción incluidos."
  Write-Output 'processPath=node, según la configuración funcional de SharkASP.'
  Write-Output 'No se copiaron .env, credenciales, bases ni respaldos. TRUST_PROXY_HOPS debe configurarse en el entorno privado del sitio.'
} finally {
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}
