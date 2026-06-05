param(
	[string]$WindowId,
	[string]$WindowTitle
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RecordlyWindowBounds {
	[StructLayout(LayoutKind.Sequential)]
	public struct RECT {
		public int Left;
		public int Top;
		public int Right;
		public int Bottom;
	}
	[DllImport("user32.dll")]
	[return: MarshalAs(UnmanagedType.Bool)]
	public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
	[DllImport("user32.dll")]
	public static extern uint GetDpiForWindow(IntPtr hWnd);
	[DllImport("dwmapi.dll")]
	public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
}
"@

$handle = [Int64]0
if ($WindowId) {
	$handle = [Int64]$WindowId
}

$escapedWindowTitle = if ($WindowTitle) { [WildcardPattern]::Escape($WindowTitle) } else { $null }
if ($handle -le 0 -and $WindowTitle) {
	$matchingProcess = Get-Process |
		Where-Object {
			$_.MainWindowHandle -ne 0 -and (
				$_.MainWindowTitle -eq $WindowTitle -or
				($escapedWindowTitle -and $_.MainWindowTitle -like "*$escapedWindowTitle*")
			)
		} |
		Select-Object -First 1
	if ($matchingProcess) {
		$handle = $matchingProcess.MainWindowHandle.ToInt64()
	}
}

if ($handle -le 0) {
	exit 1
}

$rect = New-Object RecordlyWindowBounds+RECT
$dwmRect = New-Object RecordlyWindowBounds+RECT
$rectSize = 16
if ([RecordlyWindowBounds]::DwmGetWindowAttribute([IntPtr]$handle, 9, [ref]$dwmRect, $rectSize) -eq 0) {
	$rect = $dwmRect
}
elseif (-not [RecordlyWindowBounds]::GetWindowRect([IntPtr]$handle, [ref]$rect)) {
	exit 1
}

$dpi = [RecordlyWindowBounds]::GetDpiForWindow([IntPtr]$handle)
if ($dpi -le 0) {
	$dpi = 96
}

$scale = $dpi / 96.0
@{
	x = [math]::Round($rect.Left / $scale, 4)
	y = [math]::Round($rect.Top / $scale, 4)
	width = [math]::Round(($rect.Right - $rect.Left) / $scale, 4)
	height = [math]::Round(($rect.Bottom - $rect.Top) / $scale, 4)
	dpi = $dpi
} | ConvertTo-Json -Compress
