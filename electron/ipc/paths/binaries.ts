import { execFile } from "node:child_process";
import { existsSync, constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import {
	nativeHelperMigrationPromise,
	setNativeHelperMigrationPromise,
} from "../state";

const execFileAsync = promisify(execFile);

/**
 * Resolve a path within the app bundle, handling asar unpacking in production.
 * Files listed in asarUnpack are extracted to app.asar.unpacked/ and must be
 * accessed via that path instead of the asar virtual filesystem.
 */
export function resolveUnpackedAppPath(...segments: string[]): string {
	const base = app.getAppPath();
	const resolved = path.join(base, ...segments);
	if (app.isPackaged) {
		return resolved.replace(/\.asar([/\\])/, ".asar.unpacked$1");
	}
	return resolved;
}

export function getNativeCaptureHelperSourcePath(): string {
	return resolveUnpackedAppPath("electron", "native", "ScreenCaptureKitRecorder.swift");
}

export function getNativeArchTag(): string {
	if (process.platform === "darwin") {
		return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	}

	if (process.platform === "win32") {
		return process.arch === "arm64" ? "win32-arm64" : "win32-x64";
	}

	if (process.platform === "linux") {
		return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
	}

	return `${process.platform}-${process.arch}`;
}

export function getPrebundledNativeHelperPath(binaryName: string): string {
	return resolveUnpackedAppPath("electron", "native", "bin", getNativeArchTag(), binaryName);
}

export function resolvePreferredWindowsNativeHelperPath(
	helperDirectory: string,
	binaryName: string,
): string {
	const buildOutputPath = resolveUnpackedAppPath(
		"electron",
		"native",
		helperDirectory,
		"build",
		"Release",
		binaryName,
	);
	const prebundledPath = getPrebundledNativeHelperPath(binaryName);

	if (app.isPackaged && existsSync(prebundledPath)) {
		return prebundledPath;
	}

	if (existsSync(buildOutputPath)) {
		return buildOutputPath;
	}

	if (existsSync(prebundledPath)) {
		return prebundledPath;
	}

	return buildOutputPath;
}

export function getBundledWhisperExecutableCandidates(): string[] {
	const binaryNames =
		process.platform === "win32"
			? ["whisper-cli.exe", "whisper-cpp.exe", "whisper.exe", "main.exe"]
			: ["whisper-cli", "whisper-cpp", "whisper", "main"];

	return binaryNames.map((binaryName) => getPrebundledNativeHelperPath(binaryName));
}

export function getNativeCaptureHelperBinaryPath(): string {
	return path.join(app.getPath("userData"), "native-tools", "recordly-screencapturekit-helper");
}

export function getSystemCursorHelperSourcePath(): string {
	return resolveUnpackedAppPath("electron", "native", "SystemCursorAssets.swift");
}

export function getSystemCursorHelperBinaryPath(): string {
	return path.join(app.getPath("userData"), "native-tools", "recordly-system-cursors");
}

export function getNativeCursorMonitorSourcePath(): string {
	return resolveUnpackedAppPath("electron", "native", "NativeCursorMonitor.swift");
}

export function getNativeCursorMonitorBinaryPath(): string {
	return path.join(app.getPath("userData"), "native-tools", "recordly-native-cursor-monitor");
}

export function getNativeWindowListSourcePath(): string {
	return resolveUnpackedAppPath("electron", "native", "ScreenCaptureKitWindowList.swift");
}

export function getNativeWindowListBinaryPath(): string {
	return path.join(app.getPath("userData"), "native-tools", "recordly-window-list");
}

export function getWindowsCaptureExePath(): string {
	return resolvePreferredWindowsNativeHelperPath("wgc-capture", "wgc-capture.exe");
}

export function getCursorMonitorExePath(): string {
	return resolvePreferredWindowsNativeHelperPath("cursor-monitor", "cursor-monitor.exe");
}

async function migrateLegacyNativeHelperBinaries(): Promise<void> {
	const legacyToCurrentPaths: Array<[string, string]> = [
		[
			path.join(app.getPath("userData"), "native-tools", "openscreen-screencapturekit-helper"),
			getNativeCaptureHelperBinaryPath(),
		],
		[
			path.join(app.getPath("userData"), "native-tools", "openscreen-window-list"),
			getNativeWindowListBinaryPath(),
		],
		[
			path.join(app.getPath("userData"), "native-tools", "openscreen-system-cursors"),
			getSystemCursorHelperBinaryPath(),
		],
		[
			path.join(app.getPath("userData"), "native-tools", "openscreen-native-cursor-monitor"),
			getNativeCursorMonitorBinaryPath(),
		],
	];

	for (const [legacyPath, currentPath] of legacyToCurrentPaths) {
		if (legacyPath === currentPath || existsSync(currentPath) || !existsSync(legacyPath)) {
			continue;
		}

		try {
			await fs.mkdir(path.dirname(currentPath), { recursive: true });
			await fs.rename(legacyPath, currentPath);
		} catch (error) {
			console.warn("[native-tools] Failed to migrate helper binary", {
				legacyPath,
				currentPath,
				error,
			});
		}
	}
}

export async function ensureNativeHelperMigration(): Promise<void> {
	if (!nativeHelperMigrationPromise) {
		setNativeHelperMigrationPromise(
			migrateLegacyNativeHelperBinaries().catch((error) => {
				setNativeHelperMigrationPromise(null);
				throw error;
			}),
		);
	}

	return nativeHelperMigrationPromise!;
}

export async function ensureSwiftHelperBinary(
	sourcePath: string,
	binaryPath: string,
	label: string,
	prebundledBinaryName?: string,
): Promise<string> {
	if (prebundledBinaryName) {
		const prebundledPath = getPrebundledNativeHelperPath(prebundledBinaryName);
		try {
			await fs.access(prebundledPath, fsConstants.X_OK);
			return prebundledPath;
		} catch {
			if (app.isPackaged) {
				throw new Error(
					`${label} is missing from this app build (${prebundledPath}). Reinstall or update the app.`,
				);
			}
		}
	}

	const helperDir = path.dirname(binaryPath);
	await fs.mkdir(helperDir, { recursive: true });

	let shouldCompile = false;
	try {
		const [sourceStat, binaryStat] = await Promise.all([
			fs.stat(sourcePath),
			fs.stat(binaryPath).catch(() => null),
		]);
		shouldCompile = !binaryStat || sourceStat.mtimeMs > binaryStat.mtimeMs;
	} catch (error) {
		throw new Error(`${label} source is unavailable: ${String(error)}`);
	}

	if (!shouldCompile) {
		return binaryPath;
	}

	try {
		await execFileAsync("swiftc", ["-O", sourcePath, "-o", binaryPath], {
			encoding: "utf8",
			timeout: 120000,
		});
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
		const details = [err.stderr, err.stdout].filter(Boolean).join("\n").trim();
		throw new Error(details || `Failed to compile ${label}`);
	}

	return binaryPath;
}

export async function ensureNativeCaptureHelperBinary(): Promise<string> {
	await ensureNativeHelperMigration();
	return ensureSwiftHelperBinary(
		getNativeCaptureHelperSourcePath(),
		getNativeCaptureHelperBinaryPath(),
		"native ScreenCaptureKit helper",
		"recordly-screencapturekit-helper",
	);
}

export async function ensureNativeWindowListBinary(): Promise<string> {
	await ensureNativeHelperMigration();
	return ensureSwiftHelperBinary(
		getNativeWindowListSourcePath(),
		getNativeWindowListBinaryPath(),
		"native ScreenCaptureKit window list helper",
		"recordly-window-list",
	);
}

export async function ensureNativeCursorMonitorBinary(): Promise<string> {
	await ensureNativeHelperMigration();
	return ensureSwiftHelperBinary(
		getNativeCursorMonitorSourcePath(),
		getNativeCursorMonitorBinaryPath(),
		"native cursor monitor helper",
		"recordly-native-cursor-monitor",
	);
}
