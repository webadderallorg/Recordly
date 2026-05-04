param(
	[string]$AppPath,
	[string]$CudaScriptPath,
	[switch]$CloseExisting,
	[switch]$NoDiagnostics,
	[switch]$AllowCudaAudio
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $AppPath) {
	$packagedAppPath = Join-Path $repoRoot "release\win-unpacked\Recordly.exe"
	$installedAppPath = Join-Path $env:LOCALAPPDATA "Programs\recordly\Recordly.exe"
	if (Test-Path $packagedAppPath) {
		$AppPath = $packagedAppPath
	} elseif (Test-Path $installedAppPath) {
		$AppPath = $installedAppPath
	} else {
		throw "Recordly.exe was not found. Build the Windows package first or pass -AppPath."
	}
}

if (-not $CudaScriptPath) {
	$CudaScriptPath = Join-Path $repoRoot "electron\native\nvidia-cuda-compositor\run-mp4-pipeline.mjs"
}

if (-not (Test-Path $AppPath)) {
	throw "Recordly app not found: $AppPath"
}

if (-not (Test-Path $CudaScriptPath)) {
	throw "NVIDIA CUDA/NVENC wrapper script not found: $CudaScriptPath"
}

$existingRecordly = @(Get-Process -Name "Recordly" -ErrorAction SilentlyContinue)
if ($existingRecordly.Count -gt 0) {
	if (-not $CloseExisting) {
		Write-Host "Recordly is already running. Close it first, or rerun with -CloseExisting so the CUDA env is inherited by the new app process."
		$existingRecordly | Select-Object Id, ProcessName, Path | Format-Table -AutoSize
		exit 2
	}

	$existingRecordly | Stop-Process -Force
	Start-Sleep -Milliseconds 500
}

$env:RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT = "1"
$env:RECORDLY_NVIDIA_CUDA_EXPORT_SCRIPT = (Resolve-Path $CudaScriptPath).Path
$env:RECORDLY_NVIDIA_CUDA_EXPORT_HIGH_PRIORITY = "1"
$env:RECORDLY_NVIDIA_CUDA_SAMPLE_GPU = "1"

if ($AllowCudaAudio) {
	$env:RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT = "1"
} else {
	Remove-Item Env:\RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT -ErrorAction SilentlyContinue
}

if ($NoDiagnostics) {
	Remove-Item Env:\RECORDLY_NVIDIA_CUDA_EXPORT_DIAGNOSTICS -ErrorAction SilentlyContinue
} else {
	$env:RECORDLY_NVIDIA_CUDA_EXPORT_DIAGNOSTICS = "1"
}

$resolvedAppPath = (Resolve-Path $AppPath).Path
$appDirectory = Split-Path $resolvedAppPath -Parent
if ($AllowCudaAudio) {
	$cudaAudioMode = "candidate only; app still requires timestamp-aligned CUDA output"
} else {
	$cudaAudioMode = "guarded; audio exports fall back to Windows D3D11"
}

Write-Host "Launching Recordly with guarded NVIDIA CUDA/NVENC auto export enabled:"
Write-Host "  App: $resolvedAppPath"
Write-Host "  CUDA wrapper: $env:RECORDLY_NVIDIA_CUDA_EXPORT_SCRIPT"
Write-Host "  CUDA audio exports: $cudaAudioMode"
Write-Host "  Diagnostics: $($env:RECORDLY_NVIDIA_CUDA_EXPORT_DIAGNOSTICS -eq '1')"

Start-Process -FilePath $resolvedAppPath -WorkingDirectory $appDirectory
