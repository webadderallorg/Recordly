import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nativeImage } from "electron";
import { getFfmpegBinaryPath } from "./ipc/ffmpeg/binary";
import { readWindowsWindowGeometry } from "./ipc/windowsWindowGeometry";

const execFileAsync = promisify(execFile);
type CommandRunner = (command: string, args: string[], timeout?: number) => Promise<string>;

const runCommand: CommandRunner = async (command, args, timeout = 5000) => {
	const { stdout } = await execFileAsync(command, args, {
		encoding: "utf8",
		timeout,
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

const SNAPSHOT_FILE = /^[a-f0-9]{64}\.(?:png|jpg)$/;
const SNAPSHOT_INDEX = "index.json";
const SNAPSHOT_INDEX_LIMIT = 32;
// Frame extraction can exceed the 5s lookup budget on a busy machine; a kill leaves no desktop tile.
const CONVERT_TIMEOUT_MS = 30_000;

type SnapshotIndex = Record<string, string>;

async function readSnapshotIndex(directory: string): Promise<SnapshotIndex> {
	try {
		const parsed: unknown = JSON.parse(
			await fs.readFile(path.join(directory, SNAPSHOT_INDEX), "utf8"),
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] =>
					typeof entry[1] === "string" && SNAPSHOT_FILE.test(entry[1]),
			),
		);
	} catch {
		return {};
	}
}

async function writeSnapshotIndex(directory: string, index: SnapshotIndex) {
	const entries = Object.entries(index).slice(-SNAPSHOT_INDEX_LIMIT);
	const temporary = await fs.mkdtemp(path.join(directory, ".index-"));
	try {
		const pending = path.join(temporary, SNAPSHOT_INDEX);
		await fs.writeFile(pending, JSON.stringify(Object.fromEntries(entries)));
		await fs.rename(pending, path.join(directory, SNAPSHOT_INDEX));
	} finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
}

function encodedImageExtension(bytes: Buffer): "png" | "jpg" | null {
	if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
		return "png";
	if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return "jpg";
	return null;
}

/** Convert with an external tool, keeping its already-encoded JPEG instead of re-encoding. */
async function convertToJpeg(
	directory: string,
	convert: (output: string) => Promise<unknown>,
): Promise<Buffer | null> {
	const temporary = await fs.mkdtemp(path.join(directory, ".convert-"));
	try {
		const converted = path.join(temporary, "wallpaper.jpg");
		await convert(converted);
		if (nativeImage.createFromPath(converted).isEmpty()) return null;
		const bytes = await fs.readFile(converted);
		return encodedImageExtension(bytes) === "jpg" ? bytes : null;
	} finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
}

async function encodeDesktopWallpaper(
	source: string,
	directory: string,
	aerialVideo: boolean,
	platform: NodeJS.Platform,
	run: CommandRunner,
): Promise<{ bytes: Buffer; extension: "png" | "jpg" }> {
	if (aerialVideo) {
		const bytes = await convertToJpeg(directory, (output) =>
			run(
				getFfmpegBinaryPath(),
				[
					"-hide_banner",
					"-loglevel",
					"error",
					"-nostdin",
					"-i",
					source,
					"-frames:v",
					"1",
					"-an",
					"-q:v",
					"2",
					output,
				],
				CONVERT_TIMEOUT_MS,
			),
		);
		if (!bytes) throw new Error("Desktop wallpaper image could not be decoded");
		return { bytes, extension: "jpg" };
	}
	const original = await fs.readFile(source);
	const extension = encodedImageExtension(original);
	// Browsers decode JPEG/PNG directly, so keep the original bytes instead of a slow 4K re-encode.
	if (extension && !nativeImage.createFromPath(source).isEmpty()) {
		return { bytes: original, extension };
	}
	// macOS wallpapers can be HEIC; the system converter is much faster than a main-process PNG encode.
	if (platform === "darwin") {
		const bytes = await convertToJpeg(directory, (output) =>
			run(
				"/usr/bin/sips",
				["-s", "format", "jpeg", "-s", "formatOptions", "best", source, "--out", output],
				CONVERT_TIMEOUT_MS,
			),
		).catch(() => null);
		if (bytes) return { bytes, extension: "jpg" };
	}
	const image = nativeImage.createFromPath(source);
	const png = image.isEmpty() ? Buffer.alloc(0) : image.toPNG();
	if (png.length === 0) throw new Error("Desktop wallpaper image could not be decoded");
	return { bytes: png, extension: "png" };
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
	// Reuse the snapshot for an unchanged source instead of decoding a 4K frame on every launch.
	const sourceKey = createHash("sha256")
		.update(JSON.stringify([platform, source, stats.size, stats.mtimeMs]))
		.digest("hex");
	const index = await readSnapshotIndex(directory);
	const cachedFile = index[sourceKey];
	if (cachedFile) {
		const cached = path.join(directory, cachedFile);
		const cachedStats = await fs.stat(cached).catch(() => null);
		if (cachedStats?.isFile() && cachedStats.size > 0) return cached;
	}
	const { bytes, extension } = await encodeDesktopWallpaper(
		source,
		directory,
		aerialVideo,
		platform,
		run,
	);
	const digest = createHash("sha256").update(bytes).digest("hex");
	const fileName = `${digest}.${extension}`;
	const destination = path.join(directory, fileName);
	// Content-addressed: leave an existing snapshot untouched so its thumbnail cache stays valid.
	const existing = await fs.stat(destination).catch(() => null);
	if (!existing?.isFile() || existing.size !== bytes.length) {
		// Publish complete files only: an interrupted write must not leave a cached partial image.
		const temporary = await fs.mkdtemp(path.join(directory, ".snapshot-"));
		try {
			const pending = path.join(temporary, fileName);
			await fs.writeFile(pending, bytes, { flag: "wx" });
			await fs.rename(pending, destination).catch(async (error: NodeJS.ErrnoException) => {
				// Windows can refuse to replace a same-content snapshot created by another process.
				if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
				if (!(await fs.readFile(destination)).equals(bytes)) throw error;
			});
		} finally {
			await fs.rm(temporary, { recursive: true, force: true });
		}
	}
	delete index[sourceKey];
	index[sourceKey] = fileName;
	await writeSnapshotIndex(directory, index).catch(() => undefined);
	return destination;
}

export async function getDesktopWallpaperSnapshot(userDataPath: string): Promise<string> {
	const source = await resolveDesktopWallpaperSource();
	return importDesktopWallpaperImage(source, userDataPath);
}
