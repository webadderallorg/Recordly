<#
  recordly-export-patch-v2.ps1
  ----------------------------
  Applies TWO patches to Recordly (1 and 3 below), export only.

  PATCH 1 - export backend (the actual fix)
    Why: the default "auto" export path decodes frames through the renderer,
    which initialises WebGPU / Dawn over D3D12. On the affected machine (Windows,
    AMD GPU) that D3D12 device hangs (DXGI_ERROR_DEVICE_HUNG 0x887A0006), the GPU process is killed
    (exit_code=34), the screen flickers black and no file is written.
    The native "breeze" path renders through recordly-gpu-export.exe and never
    constructs the WebGPU renderer. Testing: breeze 12/12 pass, auto 0/4.
        :s?"auto":t.backendPreference??r   ->   :s?"breeze":t.backendPreference??r
    This is the normal (non-harness) branch and the only hard-coded "auto".

  PATCH 2 (historic note, not applied) - encoder probe resolution
    Why: encoder selection probes each candidate with a 64x64 @ 1 fps test
    encode. AMD's AMF encoder rejects that size ("encoder->Init() failed with
    error 5"), so selection always falls through to Media Foundation even
    though h264_amf is present and faster (measured: 6.86x vs 6.33x realtime).
        64x64 @ 1fps      ->  1280x720 @ 30fps
        Ug(64,64) buffer  ->  Ug(1280,720) buffer
    Verified that h264_amf accepts a 1280x720 RGBA rawvideo frame on stdin.

  PATCH 3 (v2) - compositor looping fix
    Why: with the Breeze backend, the native compositor decodes the source
    through the D3D11/DXVA Media Foundation source reader. On the affected AMD
    machine the exported video looped earlier footage instead of advancing.
    Passing --prefer-high-performance-adapter makes recordly-gpu-export.exe
    use the CPU-side source reader (DXVA disabled) and the high-performance
    adapter. Confirmed by re-exporting on the affected machine: no looping.
        "--surface-pool-size",String(a)]
          ->  "--surface-pool-size",String(a),"--prefer-high-performance-adapter"]

  Usage (must be elevated - it writes into Program Files):
    .\recordly-export-patch-v2.ps1 -Mode status
    .\recordly-export-patch-v2.ps1 -Mode apply
    .\recordly-export-patch-v2.ps1 -Mode revert

  NOT PATCHED, deliberately - encoder choice:
    The native compositor (recordly-gpu-export.exe) selects its H.264 encoder
    in C++ and exposes no option for it (its only encoder flag is
    --nvenc-sdk, NVIDIA-only). It hardcodes Media Foundation. Measured on the
    affected machine, that MF encoder is the SOFTWARE MFT: 7.09 CPU-seconds per
    wall-second, versus 8.08 for libx264 and 2.95 for the AMD hardware encoder
    h264_amf. So exports composite on the GPU but encode on the CPU.
    Rewiring the JS-side encoder probe to favour h264_amf was tried and
    reverted: the probe feeds the ffmpeg streaming path, which the Breeze
    static-layout export never takes, so it changed nothing here while adding
    risk to a fallback path. Note h264_amf is unreachable from the compositor
    without patching a signed native binary.

  A timestamped backup (app.asar.<yyyyMMdd-HHmmss>.bak) is written next to the
  original before anything is replaced, and every step is hash-verified.
  Re-run -Mode apply after each Recordly update: updates reship the original
  app.asar. Anchors are located by content, so renaming between releases is
  handled; a genuinely changed build reports "unknown" and refuses to patch.
#>

[CmdletBinding()]
param(
  [ValidateSet('status', 'apply', 'revert')]
  [string]$Mode = 'status',
  # For rehearsal against a copy of app.asar; never points at Program Files.
  [string]$AsarPath = '',
  [switch]$Rehearse
)

$ErrorActionPreference = 'Stop'

$Asar   = 'C:\Program Files\Recordly\resources\app.asar'
$Work   = Join-Path $env:TEMP 'recordly-export-patch'
$Packer = Join-Path $PSScriptRoot 'asar-pack.js'
$Q      = [char]34

if ($AsarPath) { $Asar = $AsarPath }

$Patches = @(
  @{ name = 'export-backend'; find = ':s?' + $Q + 'auto' + $Q + ':t.backendPreference??r'
     repl = ':s?' + $Q + 'breeze' + $Q + ':t.backendPreference??r' }
  @{ name = 'gpu-compositor-no-looping'; find = $Q + '--surface-pool-size' + $Q + ',String(a)];'
     repl = $Q + '--surface-pool-size' + $Q + ',String(a),' + $Q + '--prefer-high-performance-adapter' + $Q + '];' }
)

function Say($msg, $colour = 'Gray') { Write-Host $msg -ForegroundColor $colour }

function Test-Elevated {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-PatchEnv {
  # ConvertTo-Json unrolls a single-element array into a bare object, so force
  # the array shape back on.
  $json = ConvertTo-Json -InputObject $Patches -Compress -Depth 4
  if ($json.TrimStart() -notmatch '^\[') { $json = '[' + $json + ']' }
  $env:PATCHES_JSON = $json
}

function Invoke-Probe {
  Set-PatchEnv
  $out = & node $Packer probe $Asar 2>&1
  $code = $LASTEXITCODE
  $text = ($out | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
  $err = ($out | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) -join "`n"
  $pending = 0; $applied = 0; $unknown = 0
  if ($text -match 'summary: (\d+) pending, (\d+) applied, (\d+) unknown') {
    $pending = [int]$Matches[1]; $applied = [int]$Matches[2]; $unknown = [int]$Matches[3]
  } else { $unknown = 999 }
  [pscustomobject]@{ Text = ($text + "`n" + $err).Trim(); Code = $code
                     Pending = $pending; Applied = $applied; Unknown = $unknown }
}

function Assert-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required (used only to read/write the asar container) and was not found on PATH.'
  }
  if (-not (Test-Path $Packer)) { throw "Missing helper: $Packer" }
}

function Assert-AppClosed {
  if ($Rehearse) { return }
  if (Get-Process -Name 'Recordly' -ErrorAction SilentlyContinue) {
    throw 'Recordly is running. Quit it completely (including the tray icon) and re-run.'
  }
}

function Show-Status {
  Assert-Node
  Say "`nRecordly export patch - status" 'Cyan'
  Say ('-' * 62)
  if (-not (Test-Path $Asar)) { Say "app.asar not found at $Asar" 'Red'; return }
  $f = Get-Item $Asar
  Say ("file      : {0}" -f $Asar)
  Say ("size      : {0:N0} bytes" -f $f.Length)
  Say ("sha256    : {0}" -f (Get-FileHash $Asar -Algorithm SHA256).Hash)
  Say ("modified  : {0}" -f $f.LastWriteTime)

  $s = Invoke-Probe
  Say ''
  $s.Text -split "`n" | Where-Object { $_ -match '\S' } | ForEach-Object { Say ('  ' + $_) }
  Say ''
  if ($s.Unknown -gt 0) {
    Say 'This build does not match the expected anchors - do not patch it.' 'Red'
  } elseif ($s.Pending -eq 0) {
    Say 'STATE: PATCHED - all patches applied.' 'Green'
  } elseif ($s.Applied -eq 0) {
    Say 'STATE: ORIGINAL - nothing applied; exports use the WebGPU path and will crash.' 'Yellow'
  } else {
    Say 'STATE: PARTIAL - run -Mode apply to finish.' 'Yellow'
  }

  $baks = Get-ChildItem (Split-Path $Asar -Parent) -Filter 'app.asar.*.bak' -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending
  Say ''
  if ($baks) {
    Say 'backups   :'
    $baks | ForEach-Object { Say ("  {0}  {1,13:N0} bytes  {2}" -f $_.LastWriteTime, $_.Length, $_.Name) }
  } else { Say 'backups   : none' }
}

function Invoke-Apply {
  Assert-Node; Assert-AppClosed
  if (-not $Rehearse -and -not (Test-Elevated)) { throw 'Must run elevated (writes into Program Files).' }

  Say "`nRecordly export patch - apply" 'Cyan'
  Say ('-' * 62)

  $before = Invoke-Probe
  if ($before.Unknown -gt 0) {
    Say $before.Text 'Red'
    throw 'Anchors not recognised for this build. Refusing to patch.'
  }
  if ($before.Pending -eq 0) { Say 'All patches already applied. Nothing to do.' 'Green'; return }

  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  $staged = Join-Path $Work 'app.patched.asar'
  Remove-Item $staged -Force -ErrorAction SilentlyContinue

  Say ("`napplying {0} of {1} patches" -f $before.Pending, $Patches.Count)
  Set-PatchEnv
  $log = & node $Packer autopatch $Asar $staged 2>&1
  if ($LASTEXITCODE -ne 0) { Say (($log | Out-String)) 'Red'; throw 'Patch build failed.' }
  $logLines = @($log | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] -and $_ -match '\S' })
  $logLines | ForEach-Object { Say ('  ' + $_) }

  # Several patches can land in the same file, so the expected count is the
  # number of DISTINCT files touched, not the number of patches.
  $touched = [System.Collections.Generic.List[string]]::new()
  foreach ($line in $logLines) {
    if ($line -match 'applied: .*?\[(?<path>[^\[\]]+?)\s+\d+ -> \d+') {
      $file = $Matches['path'].Trim()
      if (-not $touched.Contains($file)) { $touched.Add($file) }
    }
  }
  if ($touched.Count -eq 0) { throw 'Patch log reported no applied changes.' }

  # prove the staged archive is the original plus exactly these changes
  $ver = & node $Packer verify $Asar $staged 2>&1
  $verLine = (($ver | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) |
              Where-Object { $_ -match '^entries ' })
  Say ''
  Say ("verify    : {0}" -f $verLine)
  if (-not ($verLine -match 'missing 0') -or -not ($verLine -match 'extra 0')) {
    Say (($ver | Out-String)) 'Red'; throw 'Verification failed: structural mismatch.'
  }
  if ($verLine -notmatch ('differing ' + $touched.Count + '\b')) {
    Say (($ver | Out-String)) 'Red'
    throw "Verification failed: expected exactly $($touched.Count) differing file(s), matching $($touched.Count) patched file(s)."
  }
  $changed = @(($ver | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) |
               Where-Object { $_ -match '^  differs:' } | ForEach-Object { $_.Trim() })
  $changed | ForEach-Object { Say ('            ' + $_) 'DarkGray' }
  $verPaths = @($changed | ForEach-Object { $_ -replace '^differs:\s*', '' })
  foreach ($f in $touched) {
    if ($verPaths -notcontains $f) { throw "Patched file $f did not show up as differing; aborting." }
  }

  $backup = Join-Path (Split-Path $Asar -Parent) ('app.asar.{0}.bak' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $origHash = (Get-FileHash $Asar -Algorithm SHA256).Hash
  Copy-Item $Asar $backup -Force
  if ((Get-FileHash $backup -Algorithm SHA256).Hash -ne $origHash) {
    throw 'Backup hash mismatch; nothing was replaced.'
  }
  Say ("backup    : {0}" -f (Split-Path $backup -Leaf))

  Copy-Item $staged $Asar -Force
  $newHash = (Get-FileHash $Asar -Algorithm SHA256).Hash
  if ($newHash -ne (Get-FileHash $staged -Algorithm SHA256).Hash) {
    Copy-Item $backup $Asar -Force
    throw 'Post-copy hash mismatch; original restored automatically.'
  }

  $after = Invoke-Probe
  if ($after.Pending -ne 0 -or $after.Unknown -ne 0) {
    Copy-Item $backup $Asar -Force
    throw 'Post-patch check failed; original restored automatically.'
  }

  Say ("sha256    : {0}... -> {1}..." -f $origHash.Substring(0, 16), $newHash.Substring(0, 16)) 'Green'
  Say ''
  Say 'Done. Exports now use the native Breeze backend without DXVA decode.' 'Green'
  Say 'Launch Recordly, export once, and confirm the export completes and the file plays.' 'Green'
  Say 'Revert with: .\recordly-export-patch-v2.ps1 -Mode revert' 'Gray'
}

function Invoke-Revert {
  Assert-AppClosed
  if (-not $Rehearse -and -not (Test-Elevated)) { throw 'Must run elevated (writes into Program Files).' }

  Say "`nRecordly export patch - revert" 'Cyan'
  Say ('-' * 62)

  $baks = Get-ChildItem (Split-Path $Asar -Parent) -Filter 'app.asar.*.bak' -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending
  if (-not $baks) { Say 'No backups found. Nothing to revert.' 'Yellow'; return }

  $b = $baks[0]
  Say ("restoring : {0}   ({1:N0} bytes, {2})" -f $b.Name, $b.Length, $b.LastWriteTime)
  Copy-Item $b.FullName $Asar -Force
  if ((Get-FileHash $Asar -Algorithm SHA256).Hash -ne (Get-FileHash $b.FullName -Algorithm SHA256).Hash) {
    throw 'Restore verification failed.'
  }
  Say 'Reverted. app.asar matches the backup.' 'Green'
}

Say ''
switch ($Mode) {
  'status' { Show-Status }
  'apply'  { Invoke-Apply }
  'revert' { Invoke-Revert }
}
Say ''

