import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { app } from "electron";

const nodeRequire = createRequire(import.meta.url);

const binaryRunProblems = new Map<string, string | null>();
const BINARY_RUN_CHECK_TIMEOUT_MS = 5_000;

/**
 * Returns why the binary at `binaryPath` cannot run, or null when it runs.
 * A bundled binary can exist but still fail to start (missing execute bit,
 * noexec mount, wrong architecture), so we run `-version` once and cache it.
 * The check is synchronous like the rest of the lookup; SIGKILL on timeout
 * bounds how long a hung binary can block it.
 */
export function getBinaryRunProblem(binaryPath: string): string | null {
	const cached = binaryRunProblems.get(binaryPath);
	if (cached !== undefined) {
		return cached;
	}

	const result = spawnSync(binaryPath, ["-version"], {
		stdio: "ignore",
		timeout: BINARY_RUN_CHECK_TIMEOUT_MS,
		killSignal: "SIGKILL",
		windowsHide: true,
	});

	let problem: string | null = null;
	if (result.error) {
		problem = (result.error as NodeJS.ErrnoException).code ?? result.error.message;
	} else if (result.signal) {
		problem = `terminated by ${result.signal}`;
	} else if (result.status !== 0) {
		problem = `exited with code ${result.status}`;
	}

	if (problem) {
		console.warn(`[ffmpeg] ${binaryPath} cannot run (${problem})`);
	}
	binaryRunProblems.set(binaryPath, problem);
	return problem;
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

		if (candidate) {
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
			if (existsSync(p)) {
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

		if (candidate) {
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
			if (existsSync(p)) {
				return p;
			}
		}
	}

	return null;
}

export function getFfmpegBinaryPath(): string {
	const ffmpegStatic = loadFfmpegStatic();
	let bundledProblem: string | null = null;
	if (ffmpegStatic && typeof ffmpegStatic === "string") {
		const bundledPath = app.isPackaged
			? ffmpegStatic.replace(/\.asar([/\\])/, ".asar.unpacked$1")
			: ffmpegStatic;

		if (existsSync(bundledPath)) {
			bundledProblem = getBinaryRunProblem(bundledPath);
			if (!bundledProblem) {
				return bundledPath;
			}
		}
	}

	const systemFfmpeg = resolveSystemFfmpegBinaryPath();
	if (systemFfmpeg) {
		return systemFfmpeg;
	}

	throw new Error(
		bundledProblem
			? `Bundled FFmpeg cannot run (${bundledProblem}) and no system FFmpeg was found on PATH.`
			: "FFmpeg binary is unavailable. Install ffmpeg-static for this platform or make ffmpeg available on PATH.",
	);
}

export function getFfprobeBinaryPath(): string {
	const ffprobeStatic = loadFfprobeStatic();
	let bundledProblem: string | null = null;
	if (ffprobeStatic && typeof ffprobeStatic === "string") {
		const bundledPath = app.isPackaged
			? ffprobeStatic.replace(/\.asar([/\\])/, ".asar.unpacked$1")
			: ffprobeStatic;

		if (existsSync(bundledPath)) {
			bundledProblem = getBinaryRunProblem(bundledPath);
			if (!bundledProblem) {
				return bundledPath;
			}
		}
	}

	const systemFfprobe = resolveSystemFfprobeBinaryPath();
	if (systemFfprobe) {
		return systemFfprobe;
	}

	throw new Error(
		bundledProblem
			? `Bundled FFprobe cannot run (${bundledProblem}) and no system FFprobe was found on PATH.`
			: "FFprobe binary is unavailable. Install ffprobe-static for this platform or make ffprobe available on PATH.",
	);
}
