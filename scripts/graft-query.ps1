[CmdletBinding()]
param (
    [Parameter(Position=0)]
    [string]$Action,

    [Parameter(Position=1)]
    [string]$Query,

    [switch]$h,
    [switch]$Help,
    [switch]$Gui
)

$ErrorActionPreference = "Stop"

# Locate Repository Root
$repoRoot = if (Test-Path (Join-Path $PSScriptRoot "..\graft\.graph\wiring.json")) {
    (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    (Get-Location).Path
}

$jsonPath = Join-Path $repoRoot "graft\.graph\wiring.json"
$vizPath = Join-Path $repoRoot "graft\viz\index.html"

# Normalize action
if ($h -or $Help -or ($Action -and ($Action.TrimStart('-', '/') -in @("help", "h", "?", "man")))) {
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "             GRAFT ARCHITECTURE CLI & GUI HELP              " -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "`nUsage:" -ForegroundColor Yellow
    Write-Host "  .\scripts\graft-query.ps1 [command] [argument]`n" -ForegroundColor White

    Write-Host "Available Commands:" -ForegroundColor Yellow
    Write-Host "  map                    (Default) Display high-density Zero-Token Repo Map" -ForegroundColor Green
    Write-Host "  gui, viz, web, ui      Launch the interactive Web GUI visualizer in browser" -ForegroundColor Green
    Write-Host "  find <symbol>          Search symbol definitions, file locations & line spans" -ForegroundColor Green
    Write-Host "  callers <symbol>       Trace cross-file inbound callers (who calls what)" -ForegroundColor Green
    Write-Host "  stats                  Display total nodes, edges, and language metrics" -ForegroundColor Green
    Write-Host "  cards                  List all generated architectural markdown cards" -ForegroundColor Green
    Write-Host "  help, -h, -Help        Show this help reference screen`n" -ForegroundColor Green

    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host "  .\scripts\graft-query.ps1 gui" -ForegroundColor Gray
    Write-Host "  .\scripts\graft-query.ps1 map" -ForegroundColor Gray
    Write-Host "  .\scripts\graft-query.ps1 find <symbol_name>" -ForegroundColor Gray
    Write-Host "  .\scripts\graft-query.ps1 callers <symbol_name>" -ForegroundColor Gray
    Write-Host "  .\scripts\graft-build.ps1                 (Rebuild graph & visualizer via Docker)" -ForegroundColor Gray
    return
}

if ($Gui -or ($Action -and ($Action.TrimStart('-', '/') -in @("gui", "viz", "web", "ui")))) {
    if (-not (Test-Path $vizPath)) {
        Write-Warning "Visualizer HTML not found at '$vizPath'. Running graft-build first..."
        & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "graft-build.ps1")
    }
    if (Test-Path $vizPath) {
        Write-Host "Opening Graft Architecture Visualizer in browser..." -ForegroundColor Cyan
        Start-Process $vizPath
        Write-Host "Visualizer opened successfully: $vizPath" -ForegroundColor Green
    } else {
        Write-Error "Failed to locate or generate visualizer at: $vizPath"
    }
    return
}

$act = if ($Action) { $Action.ToLower().TrimStart('-', '/') } else { "map" }

if (-not (Test-Path $jsonPath)) {
    Write-Warning "graft/.graph/wiring.json not found. Please run .\scripts\graft-build.ps1 first."
    exit 1
}

$graph = Get-Content $jsonPath -Raw | ConvertFrom-Json

switch ($act) {
    "map" {
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "                GRAFT ZERO-TOKEN REPO MAP                   " -ForegroundColor Cyan
        Write-Host "============================================================" -ForegroundColor Cyan
        Write-Host "Nodes: $($graph.meta.nodeCount) | Edges: $($graph.meta.edgeCount) | Languages: $($graph.meta.languages -join ', ')" -ForegroundColor Gray
        
        Write-Host "`n[1] DIRECTORY CLUSTERS (Subsystems):" -ForegroundColor Yellow
        $files = $graph.nodes | Where-Object { $_.kind -eq "file" }
        $symbols = $graph.nodes | Where-Object { $_.kind -ne "file" }
        
        $clusters = @{}
        foreach ($f in $files) {
            $dir = ($f.path -split '[/\\]')[0]
            if (-not $dir -or $dir -match '\.') { $dir = "root" }
            if (-not $clusters.ContainsKey($dir)) {
                $clusters[$dir] = @{ Files = 0; Symbols = 0; Samples = @() }
            }
            $clusters[$dir].Files++
            if ($clusters[$dir].Samples.Count -lt 4) {
                $clusters[$dir].Samples += ($f.path -split '[/\\]')[-1]
            }
        }
        foreach ($s in $symbols) {
            $dir = ($s.path -split '[/\\]')[0]
            if (-not $dir -or $dir -match '\.') { $dir = "root" }
            if ($clusters.ContainsKey($dir)) {
                $clusters[$dir].Symbols++
            }
        }

        foreach ($k in ($clusters.Keys | Sort-Object)) {
            $info = $clusters[$k]
            Write-Host ("  {0,-15} : {1,2} files, {2,3} symbols  [{3}...]" -f $k, $info.Files, $info.Symbols, ($info.Samples -join ', ')) -ForegroundColor White
        }

        Write-Host "`n[2] HUB SYMBOLS (Top In-Demand Functions & Classes):" -ForegroundColor Yellow
        $incomingCounts = @{}
        foreach ($e in $graph.edges) {
            if ($e.relation -eq "calls") {
                if (-not $incomingCounts.ContainsKey($e.target)) { $incomingCounts[$e.target] = 0 }
                $incomingCounts[$e.target]++
            }
        }
        $topHubs = $incomingCounts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 7
        foreach ($hub in $topHubs) {
            $node = $graph.nodes | Where-Object { $_.id -eq $hub.Key } | Select-Object -First 1
            if ($node) {
                Write-Host ("  {0,-30} ({1,2} callers) -> {2}:{3}" -f $node.name, $hub.Value, $node.path, $node.span) -ForegroundColor Green
            }
        }

        Write-Host "`n[3] COUPLING HOTSPOTS (Heavily Interconnected Files):" -ForegroundColor Yellow
        $fileTraffic = @{}
        foreach ($e in $graph.edges) {
            $srcFile = ($e.source -split '#')[0]
            $tgtFile = ($e.target -split '#')[0]
            if (-not $fileTraffic.ContainsKey($srcFile)) { $fileTraffic[$srcFile] = 0 }
            $fileTraffic[$srcFile]++
            if ($tgtFile -notmatch '^node:') {
                if (-not $fileTraffic.ContainsKey($tgtFile)) { $fileTraffic[$tgtFile] = 0 }
                $fileTraffic[$tgtFile]++
            }
        }
        $topHotspots = $fileTraffic.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 6
        foreach ($hs in $topHotspots) {
            Write-Host ("  {0,-40} : {1} relations" -f $hs.Key, $hs.Value) -ForegroundColor Magenta
        }

        Write-Host "`nTips:" -ForegroundColor Yellow
        Write-Host "  • View interactive web visualizer : .\scripts\graft-query.ps1 gui" -ForegroundColor Cyan
        Write-Host "  • Trace callers for a symbol     : .\scripts\graft-query.ps1 callers <symbol>" -ForegroundColor Cyan
        Write-Host "  • View CLI options & help        : .\scripts\graft-query.ps1 help`n" -ForegroundColor Cyan
    }
    "stats" {
        Write-Host "--- Graft Architecture Graph Summary ---" -ForegroundColor Cyan
        Write-Host "Total Nodes : $($graph.meta.nodeCount)"
        Write-Host "Total Edges : $($graph.meta.edgeCount)"
        Write-Host "Languages   : $($graph.meta.languages -join ', ')"
        Write-Host "`nCommands:" -ForegroundColor Yellow
        Write-Host "  .\scripts\graft-query.ps1 map     (Directory clusters, hubs & hotspots)"
        Write-Host "  .\scripts\graft-query.ps1 gui     (Interactive Web GUI visualizer)"
        Write-Host "  .\scripts\graft-query.ps1 find    (Search symbol definitions & line spans)"
        Write-Host "  .\scripts\graft-query.ps1 callers (Trace callers across the codebase)"
        Write-Host "  .\scripts\graft-query.ps1 help    (Full CLI command reference)"
    }
    "find" {
        if (-not $Query) {
            Write-Error "Please specify a query, e.g.: .\scripts\graft-query.ps1 find <symbol_name>"
            exit 1
        }
        $matches = $graph.nodes | Where-Object { $_.name -like "*$Query*" }
        if (-not $matches) {
            Write-Host "No matching symbols found for '$Query'." -ForegroundColor Yellow
            return
        }
        Write-Host "Found $($matches.Count) match(es) for '$Query':" -ForegroundColor Green
        foreach ($m in $matches) {
            Write-Host "`n[$($m.kind)] $($m.name)" -ForegroundColor Yellow
            Write-Host "  File : $($m.path)"
            Write-Host "  Span : $($m.span)"
            if ($m.signature) {
                Write-Host "  Sign : $($m.signature)" -ForegroundColor Cyan
            }
        }
    }
    "callers" {
        if (-not $Query) {
            Write-Error "Please specify a symbol name, e.g.: .\scripts\graft-query.ps1 callers <symbol_name>"
            exit 1
        }
        $matchingNodes = $graph.nodes | Where-Object { $_.name -like "*$Query*" }
        if (-not $matchingNodes) {
            Write-Host "No symbols matched '$Query'." -ForegroundColor Yellow
            return
        }
        foreach ($node in $matchingNodes) {
            Write-Host "`nTracing callers for [$($node.kind)] $($node.id)..." -ForegroundColor Cyan
            $callers = $graph.edges | Where-Object { $_.target -eq $node.id -and $_.relation -eq "calls" }
            if ($callers) {
                foreach ($c in $callers) {
                    Write-Host "  <-- Called by: $($c.source)" -ForegroundColor Green
                }
            } else {
                Write-Host "  (No direct callers recorded in AST edges)" -ForegroundColor Gray
            }
        }
    }
    "cards" {
        $cards = Get-ChildItem -Path (Join-Path $repoRoot "graft") -Filter "*.md" -Recurse | Where-Object { $_.Name -ne "INDEX.md" }
        Write-Host "Available Architectural Cards ($($cards.Count)):" -ForegroundColor Cyan
        foreach ($c in $cards) {
            $rel = $c.FullName.Substring((Join-Path $repoRoot "graft\").Length)
            Write-Host "  - graft\$rel" -ForegroundColor Gray
        }
    }
    default {
        Write-Host "Unknown action '$Action'. Type '.\scripts\graft-query.ps1 help' for available commands." -ForegroundColor Yellow
    }
}
