import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { parseAvailableFfmpegEncoders } from "../nativeVideoArgs/encoding";

const nodeRequire = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const binaryProblems = new Map<string, Promise<string | null>>();
const systemFfmpegCapabilities = new Map<string, Promise<boolean>>();
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

async function readCommandOutput(command: string, args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(command, args, BINARY_PROBE_OPTIONS);
		return stdout;
	} catch {
		return null;
	}
}

async function resolveSystemBinaryPath(tool: "ffmpeg" | "ffprobe"): Promise<string | null> {
	const locator = process.platform === "win32" ? "where" : "which";
	const output = await readCommandOutput(locator, [tool]);
	const candidate = output
		?.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);
	if (candidate && isExecutableFile(candidate)) return candidate;

	// Electron's shell may lack the user's PATH.
	if (process.platform !== "win32") {
		for (const directory of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
			const filePath = path.join(directory, tool);
			if (isExecutableFile(filePath)) return filePath;
		}
	}
	return null;
}

function probeBinary(binaryPath: string, source: string): Promise<string | null> {
	const cached = binaryProblems.get(binaryPath);
	if (cached) return cached;

	const probe = execFileAsync(binaryPath, ["-version"], BINARY_PROBE_OPTIONS).then(
		() => null,
		(error: { code?: string | number; signal?: string; killed?: boolean; message: string }) => {
			const problem = error.killed
				? "ETIMEDOUT"
				: error.signal
					? `terminated by ${error.signal}`
					: typeof error.code === "number"
						? `exit status ${error.code}`
						: (error.code ?? error.message);
			console.warn(`[FFmpeg] Skipping unusable ${source} binary ${binaryPath} (${problem}).`);
			return problem;
		},
	);
	binaryProblems.set(binaryPath, probe);
	return probe;
}

async function resolveBinaryPath(
	tool: "FFmpeg" | "FFprobe",
	bundledPaths: (string | null)[],
	resolveSystem: () => Promise<string | null>,
): Promise<string> {
	let bundledFailure: string | undefined;
	for (const candidate of bundledPaths) {
		if (!candidate) continue;
		const bundledPath = app.isPackaged
			? candidate.replace(/\.asar([/\\])/, ".asar.unpacked$1")
			: candidate;
		if (!existsSync(bundledPath)) continue;
		const problem = await probeBinary(bundledPath, "bundled");
		if (problem === null) return bundledPath;
		bundledFailure ??= problem;
	}

	const systemBinary = await resolveSystem();
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

async function resolveFfmpegPathOverride(): Promise<string | null> {
	const override = process.env[FFMPEG_PATH_OVERRIDE_ENV]?.trim();
	if (!override) return null;
	const absolute = path.resolve(override);
	if (!isExecutableFile(absolute)) {
		console.warn(`[FFmpeg] ${FFMPEG_PATH_OVERRIDE_ENV} is not an executable file: ${absolute}`);
		return null;
	}
	return (await probeBinary(absolute, FFMPEG_PATH_OVERRIDE_ENV)) === null ? absolute : null;
}

function supportsRecordlyExports(binaryPath: string): Promise<boolean> {
	const cached = systemFfmpegCapabilities.get(binaryPath);
	if (cached !== undefined) return cached;

	const check = checkRecordlyExportSupport(binaryPath);
	systemFfmpegCapabilities.set(binaryPath, check);
	return check;
}

async function checkRecordlyExportSupport(binaryPath: string): Promise<boolean> {
	const encoderList = await readCommandOutput(binaryPath, ["-hide_banner", "-encoders"]);
	const encoders = parseAvailableFfmpegEncoders(encoderList ?? "");

	// Automatic preference must keep software H.264 fallback, audio muxing, and GIF export working.
	if (!["libx264", "aac", "gif", "png", "mjpeg"].every((name) => encoders.has(name))) {
		return false;
	}
	const filterList = await readCommandOutput(binaryPath, ["-hide_banner", "-filters"]);
	const filters = new Set(
		Array.from(
			(filterList ?? "").matchAll(/^\s*[T.][S.][C.]?\s+(\w+)\s+/gm),
			(match) => match[1],
		),
	);
	const supported = ["scale", "palettegen", "paletteuse"].every((name) => filters.has(name));
	if (supported) binaryProblems.set(binaryPath, Promise.resolve(null));
	return supported;
}

export async function getFfmpegBinaryPath(): Promise<string> {
	const override = await resolveFfmpegPathOverride();
	if (override) return override;

	if (process.platform === "linux") {
		const system = await resolveSystemBinaryPath("ffmpeg");
		if (system && (await supportsRecordlyExports(system))) return system;
		return resolveBinaryPath("FFmpeg", [loadFfmpegStatic()], async () =>
			system && (await probeBinary(system, "system FFmpeg")) === null ? system : null,
		);
	}

	return resolveBinaryPath("FFmpeg", [loadFfmpegStatic()], () =>
		resolveSystemBinaryPath("ffmpeg"),
	);
}

export function getFfprobeBinaryPath(): Promise<string> {
	const sourceBuilt =
		process.platform === "linux"
			? path.join(app.getAppPath(), "node_modules", "ffmpeg-static", "ffprobe-recordly")
			: null;
	return resolveBinaryPath("FFprobe", [sourceBuilt, loadFfprobeStatic()], () =>
		resolveSystemBinaryPath("ffprobe"),
	);
}
