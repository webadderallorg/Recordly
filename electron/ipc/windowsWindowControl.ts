import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SelectedSource, WindowBounds } from "./types";
import { getScreen, parseWindowId } from "./utils";
import { convertPhysicalBoundsToDip } from "./windowsCaptureSelection";

const execFileAsync = promisify(execFile);

export async function bringWindowsWindowForward(windowId: number): Promise<void> {
	const script = [
		'Add-Type -TypeDefinition @"',
		"using System; using System.Runtime.InteropServices;",
		"public static class RecordlyForegroundWindow {",
		'  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
		'  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
		'  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
		"}",
		'"@',
		"$handle = [IntPtr][Int64]$env:RECORDLY_WINDOW_ID",
		"if ([RecordlyForegroundWindow]::IsIconic($handle)) { [RecordlyForegroundWindow]::ShowWindowAsync($handle, 9) | Out-Null }",
		"[RecordlyForegroundWindow]::SetForegroundWindow($handle) | Out-Null",
	].join("\n");

	await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
		timeout: 5000,
		env: { ...process.env, RECORDLY_WINDOW_ID: String(windowId) },
	});
}

export async function resolveWindowsWindowBounds(
	source: SelectedSource,
): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source.id);
	const windowTitle =
		typeof source.windowTitle === "string" ? source.windowTitle.trim() : source.name.trim();

	if (!windowId && !windowTitle) return null;

	const script = [
		"$windowId = $env:RECORDLY_WINDOW_ID",
		"$windowTitle = $env:RECORDLY_WINDOW_TITLE",
		'Add-Type -TypeDefinition @"',
		"using System;",
		"using System.Runtime.InteropServices;",
		"public static class RecordlyWindowBounds {",
		"  [StructLayout(LayoutKind.Sequential)]",
		"  public struct RECT {",
		"    public int Left;",
		"    public int Top;",
		"    public int Right;",
		"    public int Bottom;",
		"  }",
		'  [DllImport("user32.dll")]',
		"  [return: MarshalAs(UnmanagedType.Bool)]",
		"  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);",
		'  [DllImport("dwmapi.dll")]',
		"  public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);",
		'  [DllImport("user32.dll")]',
		"  public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);",
		"}",
		'"@',
		"$handle = [Int64]0",
		"if ($windowId) { $handle = [Int64]$windowId }",
		"$escapedWindowTitle = if ($windowTitle) { [WildcardPattern]::Escape($windowTitle) } else { $null }",
		"if ($handle -le 0 -and $windowTitle) {",
		'  $matchingProcess = Get-Process | Where-Object { $_.MainWindowTitle -eq $windowTitle -or ($escapedWindowTitle -and $_.MainWindowTitle -like "*$escapedWindowTitle*") } | Select-Object -First 1',
		"  if ($matchingProcess) { $handle = $matchingProcess.MainWindowHandle.ToInt64() }",
		"}",
		"if ($handle -le 0) { exit 1 }",
		"$rect = New-Object RecordlyWindowBounds+RECT",
		"[RecordlyWindowBounds]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null",
		"$dwmResult = [RecordlyWindowBounds]::DwmGetWindowAttribute([IntPtr]$handle, 9, [ref]$rect, [Runtime.InteropServices.Marshal]::SizeOf($rect))",
		"if ($dwmResult -ne 0 -and -not [RecordlyWindowBounds]::GetWindowRect([IntPtr]$handle, [ref]$rect)) { exit 1 }",
		"@{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress",
	].join("\n");

	try {
		const { stdout } = await execFileAsync(
			"powershell.exe",
			["-NoProfile", "-Command", script],
			{
				timeout: 5000,
				env: {
					...process.env,
					RECORDLY_WINDOW_ID: String(windowId ?? ""),
					RECORDLY_WINDOW_TITLE: windowTitle,
				},
			},
		);
		const bounds = JSON.parse(stdout) as WindowBounds;
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

		const electronScreen = getScreen();
		return typeof electronScreen.screenToDipPoint === "function"
			? convertPhysicalBoundsToDip(bounds, (point) => electronScreen.screenToDipPoint(point))
			: bounds;
	} catch {
		return null;
	}
}
