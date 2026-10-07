[CmdletBinding()]
param (
    [switch]$NoCache,
    [switch]$NoPrune
)

$ErrorActionPreference = "Stop"

# Locate Repository Root
$repoRoot = if (Test-Path (Join-Path $PSScriptRoot "..\docker\Dockerfile.graft")) {
    (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    (Get-Location).Path
}

$dockerfilePath = Join-Path $repoRoot "docker\Dockerfile.graft"
if (-not (Test-Path $dockerfilePath)) {
    $dockerfilePath = Join-Path $repoRoot "Dockerfile.graft"
}

Write-Host "Updating Graft Architecture Graph via Docker Buildx..." -ForegroundColor Cyan
Write-Host "Repository Root: $repoRoot" -ForegroundColor Gray

Set-Location $repoRoot

$buildArgs = @("-f", $dockerfilePath, "--target", "export", "--output", "type=local,dest=.")
if ($NoCache) {
    $buildArgs += "--no-cache"
}
$buildArgs += "."

& docker build @buildArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "Graft build failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "Graft architecture graph successfully updated in graft/ directory!" -ForegroundColor Green

# Automatically clean up dangling build layers to keep Docker pristine
if (-not $NoPrune) {
    Write-Host "Automatically cleaning up dangling build layers..." -ForegroundColor Gray
    docker image prune --filter "dangling=true" -f
}
