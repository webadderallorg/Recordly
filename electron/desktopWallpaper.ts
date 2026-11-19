import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { nativeImage } from "electron";
import { getFfmpegBinaryPath } from "./ipc/ffmpeg/binary";
import { readWindowsWindowGeometry } from "./ipc/windowsWindowGeometry";

const execFileAsync = promisify(execFile);
type CommandRunner = (command: string, args: string[]) => Promise<string>;

const runCommand: CommandRunner = async (command, args) => {
	const { stdout } = await execFileAsync(command, args, {
		encoding: "utf8",
		timeout: 5000,
		maxBuffer: 16 * 1024,
		windowsHide: true,
	});
	return stdout;
};

// Modern aerial providers do not update NSWorkspace's legacy desktop image URL.
// Read their selected asset from Wallpaper Store, without System Events permissions.
const MAC_WALLPAPER_SCRIPT = `ObjC.import('AppKit'); ObjC.import('Foundation'); ObjC.import('CoreGraphics');
function object(dictionary, key) {
  if (!dictionary || dictionary.isNil()) return null;
  const value = dictionary.objectForKey(key);
  return value && !value.isNil() ? value : null;
}
function choice(entry) {
  const type = object(entry, 'Type');
  const settings = object(entry, type && ObjC.unwrap(type) === 'linked' ? 'Linked' : 'Desktop');
  const content = object(settings, 'Content') || object(entry, 'Content');
  const choices = object(content, 'Choices');
  return choices && choices.count > 0 ? choices.objectAtIndex(0) : null;
}
const screen = $.NSScreen.mainScreen;
let selected = null;
try {
  const storePath = ObjC.unwrap($.NSHomeDirectory()) + '/Library/Application Support/com.apple.wallpaper/Store/Index.plist';
  const store = $.NSDictionary.dictionaryWithContentsOfFile(storePath);
  selected = choice(object(store, 'AllSpacesAndDisplays')) || choice(object(store, 'SystemDefault'));
  try {
    const displayID = ObjC.unwrap(screen.deviceDescription.objectForKey('NSScreenNumber'));
    const uuid = $.CGDisplayCreateUUIDFromDisplayID(displayID);
    const displayUUID = ObjC.unwrap($.CFUUIDCreateString(null, uuid));
    const displays = object(store, 'Displays');
    selected = choice(object(displays, displayUUID)) || choice(object(displays, String(displayID))) || selected;
  } catch (_) {}
} catch (_) {}
const providerValue = object(selected, 'Provider');
const provider = providerValue ? ObjC.unwrap(providerValue) : null;
let assetID = null;
if (provider === 'com.apple.wallpaper.choice.aerials') {
  try {
    const data = object(selected, 'Configuration');
    const configuration = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, null);
    assetID = ObjC.unwrap(configuration.objectForKey('assetID'));
  } catch (_) {}
}
const image = $.NSWorkspace.sharedWorkspace.desktopImageURLForScreen(screen);
JSON.stringify({ provider: provider, assetID: assetID, source: image ? ObjC.unwrap(image.path) : null });`;

export async function resolveMacWallpaperChoice(
	result: string,
	homeDirectory = os.homedir(),
): Promise<string> {
	const choice = JSON.parse(result) as {
		provider?: unknown;
		assetID?: unknown;
		source?: unknown;
	};
	if (choice.provider === "com.apple.wallpaper.choice.aerials") {
		const assetID = choice.assetID;
		if (
			typeof assetID !== "string" ||
			!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(assetID)
		) {
			throw new Error("The selected desktop aerial is unavailable");
		}
		const modernRoot = path.join(
			homeDirectory,
			"Library",
			"Application Support",
			"com.apple.wallpaper",
			"aerials",
		);
		const legacyRoot = "/Library/Application Support/com.apple.idleassetsd/Customer";
		const candidates = [
			path.join(modernRoot, "videos", `${assetID}.mov`),
			path.join(legacyRoot, "4KSDR240FPS", `${assetID}.mov`),
			path.join(legacyRoot, "4KSDR120FPS", `${assetID}.mov`),
			path.join(modernRoot, "thumbnails", `${assetID}.png`),
		];
		for (const candidate of candidates) {
			const stat = await fs.stat(candidate).catch(() => null);
			if (stat?.isFile() && stat.size > 0) return candidate;
		}
		// Never substitute a stale legacy picture for a known, different active aerial.
		throw new Error("The selected desktop aerial has not been downloaded");
	}
	if (typeof choice.source !== "string")
		throw new Error("No desktop wallpaper image is available");
	return choice.source;
}

const WINDOWS_WALLPAPER_SCRIPT = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class DesktopWallpaper { [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool SystemParametersInfo(uint action, uint param, StringBuilder value, uint flags); }';
$value = New-Object System.Text.StringBuilder 32768;
if (-not [DesktopWallpaper]::SystemParametersInfo(0x0073, [uint32]$value.Capacity, $value, 0)) { throw 'Unable to read desktop wallpaper' };
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);
[Console]::Write($value.ToString());`;

export async function resolveDesktopWallpaperSource(
	platform: NodeJS.Platform = process.platform,
	run: CommandRunner = runCommand,
): Promise<string> {
	let result: string;
	if (platform === "darwin") {
		result = await resolveMacWallpaperChoice(
			await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_WALLPAPER_SCRIPT]),
		);
	} else if (platform === "win32") {
		try {
			const nativePath = await readWindowsWindowGeometry(["--desktop-wallpaper"]);
			if (typeof nativePath !== "string") throw new Error("Invalid native wallpaper path");
			result = nativePath;
		} catch {
			// Older helper bundles retain the PowerShell fallback.
			const powershell = path.win32.join(
				process.env.SystemRoot || "C:\\Windows",
				"System32",
				"WindowsPowerShell",
				"v1.0",
				"powershell.exe",
			);
			result = await run(powershell, [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				WINDOWS_WALLPAPER_SCRIPT,
			]);
		}
	} else {
		throw new Error("Desktop wallpaper is unavailable on this platform");
	}
	const source = result.trim();
	const absolute = platform === "win32" ? path.win32.isAbsolute(source) : path.isAbsolute(source);
	if (!source || !absolute || source.includes("\0") || source.includes("\n")) {
		throw new Error("No desktop wallpaper image is available");
	}
	return source;
}

/** Import an immutable snapshot so later wallpaper changes cannot change saved recordings. */
export async function importDesktopWallpaperImage(
	source: string,
	userDataPath: string,
	platform: NodeJS.Platform = process.platform,
	run: CommandRunner = runCommand,
): Promise<string> {
	const stats = await fs.stat(source);
	const aerialVideo = platform === "darwin" && /\.(mov|mp4|m4v)$/i.test(source);
	if (
		!stats.isFile() ||
		stats.size === 0 ||
		stats.size > (aerialVideo ? 2048 : 100) * 1024 * 1024
	) {
		throw new Error("Desktop wallpaper is not a supported image file");
	}
	const directory = path.join(userDataPath, "desktop-wallpapers");
	await fs.mkdir(directory, { recursive: true });
	let image;
	if (aerialVideo) {
		const temporary = await fs.mkdtemp(path.join(directory, ".aerial-"));
		try {
			const converted = path.join(temporary, "wallpaper.png");
			await run(getFfmpegBinaryPath(), [
				"-hide_banner",
				"-loglevel",
				"error",
				"-nostdin",
				"-threads",
				"1",
				"-i",
				source,
				"-frames:v",
				"1",
				"-an",
				"-c:v",
				"png",
				converted,
			]);
			image = nativeImage.createFromPath(converted);
		} finally {
			await fs.rm(temporary, { recursive: true, force: true });
		}
	} else {
		image = nativeImage.createFromPath(source);
	}
	// macOS wallpapers can be HEIC; let the system's image converter decode them.
	if (image.isEmpty() && platform === "darwin") {
		const temporary = await fs.mkdtemp(path.join(directory, ".convert-"));
		try {
			const converted = path.join(temporary, "wallpaper.png");
			await run("/usr/bin/sips", ["-s", "format", "png", source, "--out", converted]);
			image = nativeImage.createFromPath(converted);
		} finally {
			await fs.rm(temporary, { recursive: true, force: true });
		}
	}
	if (image.isEmpty()) throw new Error("Desktop wallpaper image could not be decoded");
	const png = image.toPNG();
	if (png.length === 0) throw new Error("Desktop wallpaper image could not be decoded");
	const digest = createHash("sha256").update(png).digest("hex");
	const destination = path.join(directory, `${digest}.png`);
	// Publish complete files only: an interrupted write must not leave a cached partial image.
	const temporary = await fs.mkdtemp(path.join(directory, ".snapshot-"));
	try {
		const pending = path.join(temporary, "wallpaper.png");
		await fs.writeFile(pending, png, { flag: "wx" });
		await fs.rename(pending, destination).catch(async (error: NodeJS.ErrnoException) => {
			// Windows can refuse to replace a same-content snapshot created by another process.
			if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
			if (!(await fs.readFile(destination)).equals(png)) throw error;
		});
	} finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
	return destination;
}

export async function getDesktopWallpaperSnapshot(userDataPath: string): Promise<string> {
	const source = await resolveDesktopWallpaperSource();
	return importDesktopWallpaperImage(source, userDataPath);
}
