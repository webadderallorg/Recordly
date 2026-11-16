import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { app } from "electron";

const nodeRequire = createRequire(import.meta.url);

export function loadFfmpegStatic(): string | null {
	try {
		const moduleExports = nodeRequire("ffmpeg-static");
		if (typeof moduleExports === "string") {
			return moduleExports;
		}

		if (typeof moduleExports?.default === "string") {
			return moduleExports.default as string;
		}
	} catch {
		// ffmpeg-static not available; fall through to system FFmpeg
	}

	return null;
}

export function loadFfprobeStatic(): string | null {
	try {
		const moduleExports = nodeRequire("ffprobe-static");
		if (typeof moduleExports === "string") {
			return moduleExports;
		}

		if (typeof moduleExports?.path === "string") {
			return moduleExports.path as string;
		}

		if (typeof moduleExports?.default === "string") {
			return moduleExports.default as string;
		}

		if (typeof moduleExports?.default?.path === "string") {
			return moduleExports.default.path as string;
		}
	} catch {
		// ffprobe-static not available; fall through to system FFprobe
	}

	return null;
}

/** True only for a regular file (or symlink to one) with execute permission. */
export function isExecutableFile(filePath: string): boolean {
	try {
		const st = statSync(filePath);
		// Directories can be X_OK on POSIX; never treat them as FFmpeg.
		if (!st.isFile()) {
			return false;
		}
		accessSync(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export function resolveSystemFfmpegBinaryPath(): string | null {
	const locator = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(locator, ["ffmpeg"], {
		encoding: "utf-8",
		windowsHide: true,
	});

	if (result.status === 0) {
		const candidate = result.stdout
			.split(/\r?\n/)
			.map((line: string) => line.trim())
			.find((line: string) => line.length > 0);

		if (candidate && isExecutableFile(candidate)) {
			return candidate;
		}
	}

	// Fallback: check common install paths directly (Electron's shell may lack full PATH)
	if (process.platform !== "win32") {
		const commonPaths = [
			"/opt/homebrew/bin/ffmpeg",
			"/usr/local/bin/ffmpeg",
			"/usr/bin/ffmpeg",
		];
		for (const p of commonPaths) {
			if (isExecutableFile(p)) {
				return p;
			}
		}
	}

	return null;
}

export function resolveSystemFfprobeBinaryPath(): string | null {
	const locator = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(locator, ["ffprobe"], {
		encoding: "utf-8",
		windowsHide: true,
	});

	if (result.status === 0) {
		const candidate = result.stdout
			.split(/\r?\n/)
			.map((line: string) => line.trim())
			.find((line: string) => line.length > 0);

		if (candidate && isExecutableFile(candidate)) {
			return candidate;
		}
	}

	if (process.platform !== "win32") {
		const commonPaths = [
			"/opt/homebrew/bin/ffprobe",
			"/usr/local/bin/ffprobe",
			"/usr/bin/ffprobe",
		];
		for (const p of commonPaths) {
			if (isExecutableFile(p)) {
				return p;
			}
		}
	}

	return null;
}

const FFMPEG_PATH_OVERRIDE_ENV = "RECORDLY_FFMPEG_PATH";

export type FfmpegBinarySource = "override" | "system" | "bundled";

/**
 * Chooses between an explicit RECORDLY_FFMPEG_PATH override, a system
 * FFmpeg, and the packaged ffmpeg-static binary. Pure function so the
 * precedence stays unit-testable.
 *
 * Linux distro packages ship the hardware encoders (VAAPI, NVENC, CUDA)
 * that the portable ffmpeg-static build leaves out, so a system FFmpeg
 * wins on Linux when one is present. Windows and macOS keep the bundled
 * binary first for a predictable toolchain.
 */
export function pickFfmpegBinaryPath(inputs: {
	override: string | null;
	bundled: string | null;
	system: string | null;
	platform: NodeJS.Platform;
}): { path: string; source: FfmpegBinarySource } | null {
	if (inputs.override) {
		return { path: inputs.override, source: "override" };
	}
	if (inputs.platform === "linux" && inputs.system) {
		return { path: inputs.system, source: "system" };
	}
	if (inputs.bundled) {
		return { path: inputs.bundled, source: "bundled" };
	}
	if (inputs.system) {
		return { path: inputs.system, source: "system" };
	}
	return null;
}

function resolveBundledFfmpegBinaryPath(): string | null {
	const ffmpegStatic = loadFfmpegStatic();
	if (!ffmpegStatic || typeof ffmpegStatic !== "string") {
		return null;
	}
	const bundledPath = app.isPackaged
		? ffmpegStatic.replace(/\.asar([/\\])/, ".asar.unpacked$1")
		: ffmpegStatic;
	// existsSync alone is not enough: a non-executable package would fail later
	// with EACCES and skip system fallback on non-Linux.
	return isExecutableFile(bundledPath) ? bundledPath : null;
}

function resolveFfmpegPathOverride(): string | null {
	const override = process.env[FFMPEG_PATH_OVERRIDE_ENV]?.trim();
	if (!override) {
		return null;
	}
	// Validate the absolute path we will actually spawn (relative overrides
	// otherwise resolve against cwd here but PATH in the child).
	const absolute = resolve(override);
	if (isExecutableFile(absolute)) {
		return absolute;
	}
	console.warn(
		`${FFMPEG_PATH_OVERRIDE_ENV} is set but not an executable file: ${override}`,
	);
	return null;
}

export function getFfmpegBinaryPath(): string {
	const bundled = resolveBundledFfmpegBinaryPath();
	const choice = pickFfmpegBinaryPath({
		override: resolveFfmpegPathOverride(),
		bundled,
		// Only probe PATH when the answer can change: on Linux (system-first)
		// or when the bundled binary is missing.
		system: process.platform === "linux" || !bundled ? resolveSystemFfmpegBinaryPath() : null,
		platform: process.platform,
	});
	if (choice) {
		return choice.path;
	}

	throw new Error(
		"FFmpeg binary is unavailable. Install ffmpeg-static for this platform or make ffmpeg available on PATH.",
	);
}

export function getFfprobeBinaryPath(): string {
	const ffprobeStatic = loadFfprobeStatic();
	if (ffprobeStatic && typeof ffprobeStatic === "string") {
		const bundledPath = app.isPackaged
			? ffprobeStatic.replace(/\.asar([/\\])/, ".asar.unpacked$1")
			: ffprobeStatic;

		if (isExecutableFile(bundledPath)) {
			return bundledPath;
		}
	}

	const systemFfprobe = resolveSystemFfprobeBinaryPath();
	if (systemFfprobe) {
		return systemFfprobe;
	}

	throw new Error(
		"FFprobe binary is unavailable. Install ffprobe-static for this platform or make ffprobe available on PATH.",
	);
}
