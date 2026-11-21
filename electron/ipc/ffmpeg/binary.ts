import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";

const nodeRequire = createRequire(import.meta.url);
const bundledBinaryProblems = new Map<string, string | null>();

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

function probeBundledBinary(binaryPath: string): string | null {
	const cached = bundledBinaryProblems.get(binaryPath);
	if (cached !== undefined) return cached;

	const result = spawnSync(binaryPath, ["-version"], {
		stdio: "ignore",
		timeout: 5000,
		killSignal: "SIGKILL",
		windowsHide: true,
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
		console.warn(`[FFmpeg] Skipping unusable bundled binary ${binaryPath} (${problem}).`);
	}
	bundledBinaryProblems.set(binaryPath, problem);
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
		const problem = probeBundledBinary(bundledPath);
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

export function getFfmpegBinaryPath(): string {
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
