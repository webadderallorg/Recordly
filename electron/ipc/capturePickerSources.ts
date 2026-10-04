import { systemPreferences } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getNativeMacWindowsFrontToBack, resolveLinuxWindowBounds } from "./cursor/bounds";
import type { CapturePickerWindow, SelectedSource } from "./types";
import { getScreen, parseWindowId } from "./utils";
import { getDesktopSources } from "./register/sources";

const exec = promisify(execFile);

export function parseStackingOrder(text: string): number[] {
	return [...text.matchAll(/0x[0-9a-f]+/gi)]
		.map((match) => Number.parseInt(match[0], 16))
		.reverse();
}

// GetTopWindow/GetWindow walks front to back. Restrict the result to Electron's
// capturable sources rather than inventing source IDs or changing capture routes.
const WINDOWS_SCRIPT = `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class RecordlyPickerWindows {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint command);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT rect);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out RECT rect, int size);
 public class Entry { public long id; public int x, y, width, height; }
 public static Entry[] List() {
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  var list = new List<Entry>(); var seen = new HashSet<long>();
  for (var h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero && seen.Add(h.ToInt64()); h = GetWindow(h, 2)) {
   if (!IsWindowVisible(h) || IsIconic(h)) continue;
   RECT rect;
   if (DwmGetWindowAttribute(h, 9, out rect, Marshal.SizeOf(typeof(RECT))) != 0 && !GetWindowRect(h, out rect)) continue;
   if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) continue;
   list.Add(new Entry { id = h.ToInt64(), x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top });
  }
  return list.ToArray();
 }
}
"@
ConvertTo-Json -InputObject @([RecordlyPickerWindows]::List()) -Compress`;

export async function listCapturePickerWindows(): Promise<CapturePickerWindow[]> {
	if (process.platform === "darwin") {
		if (systemPreferences.getMediaAccessStatus("screen") !== "granted")
			throw new Error("Allow screen recording in System Settings before picking a window.");
		const entries = await getNativeMacWindowsFrontToBack({ strict: true });
		return entries
			.filter(
				(entry) =>
					entry.ownerPid !== process.pid &&
					[entry.x, entry.y, entry.width, entry.height].every(Number.isFinite) &&
					(entry.width ?? 0) > 0 &&
					(entry.height ?? 0) > 0,
			)
			.map((entry) => ({
				id: entry.id,
				appName: entry.appName ?? "",
				title: entry.windowTitle ?? entry.name,
				display_id: entry.display_id,
				x: entry.x!,
				y: entry.y!,
				width: entry.width!,
				height: entry.height!,
			}));
	}
	const sources = await getDesktopSources(
		{
			types: ["window"],
			thumbnailSize: { width: 0, height: 0 },
			fetchWindowIcons: false,
		},
		{ strict: true },
	);
	const capturable = sources.filter(
		(source): source is SelectedSource & { id: string } =>
			typeof source.id === "string" && source.id.startsWith("window:"),
	);
	const byId = new Map(capturable.map((source) => [parseWindowId(source.id), source]));
	if (process.platform === "win32") {
		const { stdout } = await exec(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT],
			{ timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
		);
		const entries: unknown = JSON.parse(stdout);
		if (!Array.isArray(entries)) throw new Error("Unable to read window positions.");
		return entries.flatMap((entry) => {
			const source = byId.get(entry.id);
			if (
				!source ||
				![entry.x, entry.y, entry.width, entry.height].every(Number.isFinite) ||
				entry.width <= 0 ||
				entry.height <= 0
			)
				return [];
			const bounds = getScreen().screenToDipRect(null, entry);
			return [
				{
					...bounds,
					id: source.id,
					appName: "",
					title: source.name,
					display_id: source.display_id,
				},
			];
		});
	}
	const { stdout } = await exec("xprop", ["-root", "_NET_CLIENT_LIST_STACKING"], {
		timeout: 3000,
	});
	if (!stdout.includes("window id #"))
		throw new Error("Unable to detect windows on this desktop.");
	const ordered = parseStackingOrder(stdout).flatMap((id) => {
		const source = byId.get(id);
		return source ? [source] : [];
	});
	const windows: CapturePickerWindow[] = [];
	// Bound the number of simultaneous X11 helper processes.
	for (let offset = 0; offset < ordered.length; offset += 8) {
		const batch = await Promise.all(
			ordered.slice(offset, offset + 8).map(async (source) => {
				const bounds = await resolveLinuxWindowBounds(source);
				if (!bounds)
					throw new Error("Unable to detect a window position. Try the picker again.");
				return bounds
					? {
							...bounds,
							id: source.id,
							appName: "",
							title: source.name,
							display_id: source.display_id,
						}
					: null;
			}),
		);
		windows.push(
			...batch.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
		);
	}
	return windows;
}
