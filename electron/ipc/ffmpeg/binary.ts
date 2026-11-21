import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";
import { parseAvailableFfmpegEncoders } from "../nativeVideoArgs/encoding";

const nodeRequire = createRequire(import.meta.url);
const binaryProblems = new Map<string, string | null>();
const systemFfmpegCapabilities = new Map<string, boolean>();
const FFMPEG_PATH_OVERRIDE_ENV = "RECORDLY_FFMPEG_PATH";
const BINARY_PROBE_OPTIONS = {
	timeout: 5000,
	killSignal: "SIGKILL",
	windowsHide: true,
} as const;

function isExecutableFile(filePath: string): boolean {
	try {
		if (!statSync(filePath).isFile()) return false;
		accessSync(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

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

function probeBinary(binaryPath: string, source: string): string | null {
	const cached = binaryProblems.get(binaryPath);
	if (cached !== undefined) return cached;

	const result = spawnSync(binaryPath, ["-version"], {
		stdio: "ignore",
		...BINARY_PROBE_OPTIONS,
	});
	let problem: string | null = null;
	if (result.error) {
		problem = (result.error as NodeJS.ErrnoException).code ?? result.error.message;
	} else if (result.signal) {
		problem = `terminated by ${result.signal}`;
	} else if (result.status !== 0) {
		problem = `exit status ${result.status}`;
	}
	if (problem !== null) {
		console.warn(`[FFmpeg] Skipping unusable ${source} binary ${binaryPath} (${problem}).`);
	}
	binaryProblems.set(binaryPath, problem);
	return problem;
}

function resolveBinaryPath(
	tool: "FFmpeg" | "FFprobe",
	bundledPaths: (string | null)[],
	resolveSystem: () => string | null,
): string {
	let bundledFailure: string | undefined;
	for (const candidate of bundledPaths) {
		if (!candidate) continue;
		const bundledPath = app.isPackaged
			? candidate.replace(/\.asar([/\\])/, ".asar.unpacked$1")
			: candidate;
		if (!existsSync(bundledPath)) continue;
		const problem = probeBinary(bundledPath, "bundled");
		if (problem === null) return bundledPath;
		bundledFailure ??= problem;
	}

	const systemBinary = resolveSystem();
	if (systemBinary) return systemBinary;
	const command = tool.toLowerCase();
	if (bundledFailure !== undefined) {
		throw new Error(
			`Bundled ${tool} could not run (${bundledFailure}), and no system ${tool} was found. Make ${command} available on PATH.`,
		);
	}

	throw new Error(
		`${tool} binary is unavailable. Install ${command}-static for this platform or make ${command} available on PATH.`,
	);
}

function resolveFfmpegPathOverride(): string | null {
	const override = process.env[FFMPEG_PATH_OVERRIDE_ENV]?.trim();
	if (!override) return null;
	const absolute = path.resolve(override);
	if (!isExecutableFile(absolute)) {
		console.warn(`[FFmpeg] ${FFMPEG_PATH_OVERRIDE_ENV} is not an executable file: ${absolute}`);
		return null;
	}
	return probeBinary(absolute, FFMPEG_PATH_OVERRIDE_ENV) === null ? absolute : null;
}

function supportsRecordlyExports(binaryPath: string): boolean {
	const cached = systemFfmpegCapabilities.get(binaryPath);
	if (cached !== undefined) return cached;

	const options = { ...BINARY_PROBE_OPTIONS, encoding: "utf8" } as const;
	const encoderList = spawnSync(binaryPath, ["-hide_banner", "-encoders"], options);
	const encoders = parseAvailableFfmpegEncoders(encoderList.stdout ?? "");
	let supported = false;

	// Automatic preference must keep software H.264 fallback, audio muxing, and GIF export working.
	if (
		encoderList.status === 0 &&
		["libx264", "aac", "gif", "png", "mjpeg"].every((name) => encoders.has(name))
	) {
		const filterList = spawnSync(binaryPath, ["-hide_banner", "-filters"], options);
		const filters = new Set(
			Array.from(
				(filterList.stdout ?? "").matchAll(/^\s*[T.][S.][C.]?\s+(\w+)\s+/gm),
				(m) => m[1],
			),
		);
		supported =
			filterList.status === 0 &&
			["scale", "palettegen", "paletteuse"].every((name) => filters.has(name));
	}
	systemFfmpegCapabilities.set(binaryPath, supported);
	if (supported) binaryProblems.set(binaryPath, null);
	return supported;
}

export function getFfmpegBinaryPath(): string {
	const override = resolveFfmpegPathOverride();
	if (override) return override;

	if (process.platform === "linux") {
		const system = resolveSystemFfmpegBinaryPath();
		if (system && supportsRecordlyExports(system)) return system;
		return resolveBinaryPath("FFmpeg", [loadFfmpegStatic()], () =>
			system && probeBinary(system, "system FFmpeg") === null ? system : null,
		);
	}

	return resolveBinaryPath("FFmpeg", [loadFfmpegStatic()], resolveSystemFfmpegBinaryPath);
}

export function getFfprobeBinaryPath(): string {
	const sourceBuilt =
		process.platform === "linux"
			? path.join(app.getAppPath(), "node_modules", "ffmpeg-static", "ffprobe-recordly")
			: null;
	return resolveBinaryPath(
		"FFprobe",
		[sourceBuilt, loadFfprobeStatic()],
		resolveSystemFfprobeBinaryPath,
	);
}
