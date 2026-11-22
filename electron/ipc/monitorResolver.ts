import { spawnSync } from "node:child_process";

/**
 * Represents a Windows monitor handle and its physical desktop coordinates.
 */
export interface WinMonitorHandle {
	handle: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Retrieves raw HMONITOR handles from the Windows OS using a PowerShell bridge.
 * This is necessary because Electron's display IDs are often internal hashes that
 * cannot be used directly with native Windows APIs like Graphics Capture (WGC).
 */
export function getMonitorHandles(): WinMonitorHandle[] {
	if (process.platform !== "win32") return [];

	// PowerShell snippet that uses P/Invoke to call EnumDisplayMonitors and return raw handles + bounds.
	const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class MonitorHelper {
    [DllImport("user32.dll")]
    public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);

    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, ref Rect lprcMonitor, IntPtr dwData);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    public static List<string> GetMonitors() {
        List<string> result = new List<string>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hMonitor, IntPtr hdcMonitor, ref Rect lprcMonitor, IntPtr dwData) => {
            result.Add(string.Format("{0}|{1}|{2}|{3}|{4}", hMonitor.ToInt64(), lprcMonitor.left, lprcMonitor.top, lprcMonitor.right - lprcMonitor.left, lprcMonitor.bottom - lprcMonitor.top));
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@
[MonitorHelper]::GetMonitors()
`.trim();

	const result = spawnSync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", psScript],
		{
			encoding: "utf-8",
			timeout: 5000,
		},
	);

	if (result.error || result.status !== 0) {
		// Silent failure is preferred; the caller will fall back to coordinate-based matching.
		return [];
	}

	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [handle, x, y, width, height] = line.split("|").map(Number);
			return { handle, x, y, width, height };
		});
}
