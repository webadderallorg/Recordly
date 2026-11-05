import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getNativeMacWindowsFrontToBack } from "./cursor/bounds";
import { isLikelyLinuxWaylandSession } from "./register/sourceMapping";
import type { CapturePickerWindow, WindowBounds } from "./types";
import { getScreen } from "./utils";

const exec = promisify(execFile);
const commandOptions = { timeout: 10000, maxBuffer: 1024 * 1024 };

const MAC_SCRIPT = `on run argv
 tell application "System Events"
  set targetProcesses to application processes whose unix id is ((item 1 of argv) as integer)
  if (count of targetProcesses) is not 1 then error "The selected application is no longer available."
  tell item 1 of targetProcesses
   set targetWindow to missing value
   set geometryMatches to {}
   repeat with candidate in windows
    try
     if value of attribute "AXWindowNumber" of candidate is ((item 2 of argv) as integer) then set targetWindow to contents of candidate
    end try
    if (item 9 of argv) is "true" then
     try
      if (position of candidate is {((item 5 of argv) as integer), ((item 6 of argv) as integer)}) and (size of candidate is {((item 7 of argv) as integer), ((item 8 of argv) as integer)}) then set end of geometryMatches to contents of candidate
     end try
    end if
   end repeat
   if targetWindow is missing value then
    if (item 9 of argv) is not "true" or (count of geometryMatches) is greater than 1 then error "Window identity is ambiguous. Move the selected window and select it again."
    if (count of geometryMatches) is not 1 then error "The selected window is no longer available."
    set targetWindow to item 1 of geometryMatches
   end if
   if not (settable of attribute "AXSize" of targetWindow) then error "This window cannot be resized."
   set size of targetWindow to {((item 3 of argv) as integer), ((item 4 of argv) as integer)}
   delay 0.2
   set p to position of targetWindow
   set s to size of targetWindow
   return ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)
  end tell
 end tell
end run`;

const WINDOWS_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class RecordlyResizeWindow {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out RECT r, int size);
 public static bool GetVisibleRect(IntPtr h, out RECT r) {
  return DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0 || GetWindowRect(h, out r);
 }
 [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
}
"@
[RecordlyResizeWindow]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$h = [IntPtr][Int64]$env:RECORDLY_RESIZE_WINDOW_ID
if (-not [RecordlyResizeWindow]::IsWindow($h)) { throw 'The selected window is no longer available.' }
if ([RecordlyResizeWindow]::IsZoomed($h) -or [RecordlyResizeWindow]::IsIconic($h)) { throw 'Restore this window before resizing it.' }
$dpi = [RecordlyResizeWindow]::GetDpiForWindow($h)
if ($dpi -eq 0) { throw 'Unable to read the selected window display scale.' }
$outer = New-Object RecordlyResizeWindow+RECT
$visible = New-Object RecordlyResizeWindow+RECT
if (-not [RecordlyResizeWindow]::GetWindowRect($h, [ref]$outer) -or -not [RecordlyResizeWindow]::GetVisibleRect($h, [ref]$visible)) { throw 'Unable to read selected window bounds.' }
# SetWindowPos takes outer bounds, while capture and picker use the visible DWM frame.
$extraWidth = ($outer.Right - $outer.Left) - ($visible.Right - $visible.Left)
$extraHeight = ($outer.Bottom - $outer.Top) - ($visible.Bottom - $visible.Top)
$w = [int][Math]::Round([double]$env:RECORDLY_RESIZE_WIDTH * $dpi / 96) + $extraWidth
$height = [int][Math]::Round([double]$env:RECORDLY_RESIZE_HEIGHT * $dpi / 96) + $extraHeight
if (-not [RecordlyResizeWindow]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, $w, $height, 0x0016)) { throw 'This window cannot be resized.' }
Start-Sleep -Milliseconds 200
$r = New-Object RecordlyResizeWindow+RECT
if (-not [RecordlyResizeWindow]::GetVisibleRect($h, [ref]$r)) { throw 'Unable to read resized window bounds.' }
@{ x=$r.Left; y=$r.Top; width=$r.Right-$r.Left; height=$r.Bottom-$r.Top } | ConvertTo-Json -Compress`;

function checkBounds(value: unknown): WindowBounds {
	if (!value || typeof value !== "object")
		throw new Error("Unable to read resized window bounds.");
	const { x, y, width, height } = value as WindowBounds;
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
		throw new Error("Unable to read resized window bounds.");
	}
	return { x, y, width, height };
}

/** Resize the exact native source window. Dimensions and result use display points. */
export async function resizeCaptureWindow(
	window: Pick<CapturePickerWindow, "id">,
	size: { width: number; height: number },
): Promise<WindowBounds> {
	if (
		!size ||
		![size.width, size.height].every(
			(value) => Number.isSafeInteger(value) && value >= 100 && value <= 16384,
		)
	) {
		throw new Error("Window width and height must be whole numbers between 100 and 16384.");
	}
	const match = /^window:([1-9]\d*):\d+$/.exec(window?.id);
	const windowId = match ? Number(match[1]) : 0;
	if (!Number.isSafeInteger(windowId) || windowId <= 0)
		throw new Error("Select a window before choosing a custom size.");
	if (process.platform === "darwin") {
		const nativeWindows = await getNativeMacWindowsFrontToBack({ strict: true });
		const nativeWindow = nativeWindows.find((entry) => entry.id === window.id);
		const pid = nativeWindow?.ownerPid;
		if (!pid || !Number.isSafeInteger(pid) || pid === process.pid)
			throw new Error("The selected window is no longer available.");
		// Some apps (including TextEdit) omit AXWindowNumber. Fall back only when
		// fresh native geometry is unique within that PID AND the AX list agrees.
		const geometry = [
			nativeWindow?.x,
			nativeWindow?.y,
			nativeWindow?.width,
			nativeWindow?.height,
		];
		const uniqueGeometry =
			geometry.every(Number.isSafeInteger) &&
			nativeWindows.filter(
				(entry) =>
					entry.ownerPid === pid &&
					[entry.x, entry.y, entry.width, entry.height].every(
						(value, index) => value === geometry[index],
					),
			).length === 1;
		try {
			const { stdout } = await exec(
				"osascript",
				[
					"-e",
					MAC_SCRIPT,
					"--",
					String(pid),
					String(windowId),
					String(size.width),
					String(size.height),
					...geometry.map((value) => String(value ?? 0)),
					String(uniqueGeometry),
				],
				commandOptions,
			);
			const parts = stdout.trim().split(",");
			if (parts.length !== 4 || parts.some((part) => !part.trim()))
				throw new Error("Unable to read resized window bounds.");
			const [x, y, width, height] = parts.map(Number);
			return checkBounds({ x, y, width, height });
		} catch (error) {
			const detail = error instanceof Error ? error.message : "";
			if (detail.includes("no longer available"))
				throw new Error("The selected window is no longer available. Select it again.");
			if (detail.includes("identity is ambiguous"))
				throw new Error(
					"Window identity is ambiguous. Move the selected window and select it again.",
				);
			if (detail.includes("cannot be resized"))
				throw new Error("This window cannot be resized.");
			throw new Error(
				"Unable to resize this window. Allow Recordly in System Settings → Privacy & Security → Accessibility, and make sure the window is not full screen.",
			);
		}
	}
	if (process.platform === "win32") {
		try {
			const { stdout } = await exec(
				"powershell.exe",
				["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT],
				{
					...commandOptions,
					env: {
						...process.env,
						RECORDLY_RESIZE_WINDOW_ID: String(windowId),
						RECORDLY_RESIZE_WIDTH: String(size.width),
						RECORDLY_RESIZE_HEIGHT: String(size.height),
					},
				},
			);
			return checkBounds(getScreen().screenToDipRect(null, checkBounds(JSON.parse(stdout))));
		} catch {
			throw new Error(
				"Unable to resize this window. Restore it from minimized or maximized mode and check that the application permits resizing.",
			);
		}
	}
	if (process.platform === "linux") {
		if (isLikelyLinuxWaylandSession(process.env))
			throw new Error(
				"Resizing other applications is unavailable on Wayland. Resize the window manually.",
			);
		// X11 geometry uses the same logical screen coordinates as the picker.
		const handle = `0x${windowId.toString(16)}`;
		try {
			await exec(
				"wmctrl",
				["-i", "-r", handle, "-e", `0,-1,-1,${size.width},${size.height}`],
				commandOptions,
			);
			await new Promise((resolve) => setTimeout(resolve, 200));
			const { stdout } = await exec("wmctrl", ["-lG"], commandOptions);
			for (const line of stdout.split("\n")) {
				const fields = line.trim().split(/\s+/);
				if (
					/^0x[\da-f]+$/i.test(fields[0]) &&
					Number.parseInt(fields[0], 16) === windowId
				) {
					const [x, y, width, height] = fields.slice(2, 6).map(Number);
					return checkBounds({ x, y, width, height });
				}
			}
		} catch {
			throw new Error(
				"Unable to resize this window. X11 window resizing requires wmctrl and a resizable application window.",
			);
		}
		throw new Error("The selected window is no longer available. Select it again.");
	}
	throw new Error("Custom window sizing is unavailable on this platform.");
}
