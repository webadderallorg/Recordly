import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NativeMacWindowSource, WindowBounds, SelectedSource } from "../types";
import {
	selectedSource,
	setSelectedWindowBounds,
	interactionCaptureCleanup,
	setInteractionCaptureCleanup,
	windowBoundsCaptureInterval,
	setWindowBoundsCaptureInterval,
	cachedNativeMacWindowSources,
	setCachedNativeMacWindowSources,
	cachedNativeMacWindowSourcesAtMs,
	setCachedNativeMacWindowSourcesAtMs,
} from "../state";
import { parseWindowId } from "../utils";
import { ensureNativeWindowListBinary } from "../paths/binaries";

const execFileAsync = promisify(execFile);

export async function getNativeMacWindowSources(options?: { maxAgeMs?: number }) {
	if (process.platform !== "darwin") {
		return [] as NativeMacWindowSource[];
	}

	const maxAgeMs = options?.maxAgeMs ?? 5000;
	const now = Date.now();
	if (cachedNativeMacWindowSources && now - cachedNativeMacWindowSourcesAtMs < maxAgeMs) {
		return cachedNativeMacWindowSources;
	}

	try {
		const binaryPath = await ensureNativeWindowListBinary();
		const { stdout } = await execFileAsync(binaryPath, [], {
			timeout: 30000,
			maxBuffer: 10 * 1024 * 1024,
		});

		const parsed = JSON.parse(stdout);
		if (!Array.isArray(parsed)) {
			return [] as NativeMacWindowSource[];
		}

		const entries = parsed.filter((entry: unknown): entry is NativeMacWindowSource => {
			if (!entry || typeof entry !== "object") {
				return false;
			}

			const candidate = entry as Partial<NativeMacWindowSource>;
			return typeof candidate.id === "string" && typeof candidate.name === "string";
		});

		setCachedNativeMacWindowSources(entries);
		setCachedNativeMacWindowSourcesAtMs(now);
		return entries;
	} catch {
		return cachedNativeMacWindowSources ?? ([] as NativeMacWindowSource[]);
	}
}

export function getWindowBoundsFromNativeSource(
	source?: NativeMacWindowSource | null,
): WindowBounds | null {
	if (!source) {
		return null;
	}

	const { x, y, width, height } = source;
	if (
		typeof x !== "number" ||
		!Number.isFinite(x) ||
		typeof y !== "number" ||
		!Number.isFinite(y) ||
		typeof width !== "number" ||
		!Number.isFinite(width) ||
		typeof height !== "number" ||
		!Number.isFinite(height)
	) {
		return null;
	}

	if (width <= 0 || height <= 0) {
		return null;
	}

	return { x, y, width, height };
}

export function getVisibleWindowBoundsFromNativeSource(
	source?: NativeMacWindowSource | null,
): WindowBounds | null {
	if (!source || source.visible === false) {
		return null;
	}

	const {
		visibleX: x,
		visibleY: y,
		visibleWidth: width,
		visibleHeight: height,
	} = source;
	if (
		typeof x !== "number" ||
		!Number.isFinite(x) ||
		typeof y !== "number" ||
		!Number.isFinite(y) ||
		typeof width !== "number" ||
		!Number.isFinite(width) ||
		typeof height !== "number" ||
		!Number.isFinite(height)
	) {
		return getWindowBoundsFromNativeSource(source);
	}

	if (width <= 0 || height <= 0) {
		return null;
	}

	return { x, y, width, height };
}

export async function resolveMacWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source.id);
	if (!windowId) {
		return null;
	}

	try {
		const nativeSources = await getNativeMacWindowSources({ maxAgeMs: 250 });
		const matchedSource = nativeSources.find((entry) => parseWindowId(entry.id) === windowId);
		return getWindowBoundsFromNativeSource(matchedSource);
	} catch {
		return null;
	}
}

export async function resolveMacWindowVisibleBounds(
	source: SelectedSource,
): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source.id);
	if (!windowId) {
		return null;
	}

	try {
		const nativeSources = await getNativeMacWindowSources({ maxAgeMs: 0 });
		const matchedSource = nativeSources.find((entry) => parseWindowId(entry.id) === windowId);
		return getVisibleWindowBoundsFromNativeSource(matchedSource);
	} catch {
		return null;
	}
}

export function parseXwininfoBounds(stdout: string): WindowBounds | null {
	const absX = stdout.match(/Absolute upper-left X:\s+(-?\d+)/);
	const absY = stdout.match(/Absolute upper-left Y:\s+(-?\d+)/);
	const width = stdout.match(/Width:\s+(\d+)/);
	const height = stdout.match(/Height:\s+(\d+)/);

	if (!absX || !absY || !width || !height) {
		return null;
	}

	return {
		x: Number.parseInt(absX[1], 10),
		y: Number.parseInt(absY[1], 10),
		width: Number.parseInt(width[1], 10),
		height: Number.parseInt(height[1], 10),
	};
}

export async function resolveLinuxWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source?.id);

	if (windowId) {
		try {
			const { stdout } = await execFileAsync("xwininfo", ["-id", String(windowId)], {
				timeout: 1500,
			});
			const bounds = parseXwininfoBounds(stdout);
			if (bounds && bounds.width > 0 && bounds.height > 0) {
				return bounds;
			}
		} catch {
			// fall back to title lookup below
		}
	}

	const windowTitle =
		typeof source.windowTitle === "string" ? source.windowTitle.trim() : source.name.trim();
	if (!windowTitle) {
		return null;
	}

	try {
		const { stdout } = await execFileAsync("xwininfo", ["-name", windowTitle], {
			timeout: 1500,
		});
		const bounds = parseXwininfoBounds(stdout);
		return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
	} catch {
		return null;
	}
}

export async function resolveWindowsWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source?.id);
	const windowTitle =
		typeof source.windowTitle === "string" ? source.windowTitle.trim() : source.name.trim();

	if (!windowId && !windowTitle) {
		return null;
	}

	const script = [
		"param([string]$windowId, [string]$windowTitle)",
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
		"}",
		'"@',
		"$handle = [Int64]0",
		"if ($windowId) {",
		"  $handle = [Int64]$windowId",
		"}",
		"$escapedWindowTitle = if ($windowTitle) { [WildcardPattern]::Escape($windowTitle) } else { $null }",
		"if ($handle -le 0 -and $windowTitle) {",
		'  $matchingProcess = Get-Process | Where-Object { $_.MainWindowTitle -eq $windowTitle -or ($escapedWindowTitle -and $_.MainWindowTitle -like "*$escapedWindowTitle*") } | Select-Object -First 1',
		"  if ($matchingProcess) {",
		"    $handle = $matchingProcess.MainWindowHandle.ToInt64()",
		"  }",
		"}",
		"if ($handle -le 0) {",
		"  exit 1",
		"}",
		"$rect = New-Object RecordlyWindowBounds+RECT",
		"if (-not [RecordlyWindowBounds]::GetWindowRect([IntPtr]$handle, [ref]$rect)) {",
		"  exit 1",
		"}",
		"@{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top } | ConvertTo-Json -Compress",
	].join("\n");

	try {
		const { stdout } = await execFileAsync(
			"powershell.exe",
			["-NoProfile", "-Command", script, String(windowId ?? ""), windowTitle],
			{ timeout: 1500 },
		);
		const bounds = JSON.parse(stdout) as WindowBounds;
		return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
	} catch {
		return null;
	}
}

export function stopInteractionCapture() {
	if (interactionCaptureCleanup) {
		interactionCaptureCleanup();
		setInteractionCaptureCleanup(null);
	}
}

export function stopWindowBoundsCapture() {
	if (windowBoundsCaptureInterval) {
		clearInterval(windowBoundsCaptureInterval);
		setWindowBoundsCaptureInterval(null);
	}
	setSelectedWindowBounds(null);
}

async function refreshSelectedWindowBounds() {
	if (!selectedSource?.id?.startsWith("window:")) {
		setSelectedWindowBounds(null);
		return;
	}

	let bounds: WindowBounds | null = null;

	if (process.platform === "darwin") {
		bounds = await resolveMacWindowBounds(selectedSource);
	} else if (process.platform === "win32") {
		bounds = await resolveWindowsWindowBounds(selectedSource);
	} else if (process.platform === "linux") {
		bounds = await resolveLinuxWindowBounds(selectedSource);
	}

	setSelectedWindowBounds(bounds);
}

export function startWindowBoundsCapture() {
	stopWindowBoundsCapture();

	if (
		!["darwin", "win32", "linux"].includes(process.platform) ||
		!selectedSource?.id?.startsWith("window:")
	) {
		return;
	}

	void refreshSelectedWindowBounds();
	setWindowBoundsCaptureInterval(setInterval(() => {
		void refreshSelectedWindowBounds();
	}, 250));
}
