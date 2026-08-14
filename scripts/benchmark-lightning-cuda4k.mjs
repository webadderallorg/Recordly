#!/usr/bin/env node
/**
 * Deterministic production-path benchmark for Recordly's Lightning (modern)
 * HEVC export over the NVIDIA CUDA compositor.
 *
 * This is NOT the direct compositor oracle. It launches the real Electron app
 * in smoke-auto-export mode and exercises the exact production path:
 *
 *   smoke auto-export -> VideoEditor -> ModernVideoExporter ->
 *   nativeStaticLayoutExport IPC -> native-video.ts -> CUDA compositor
 *
 * The benchmark asserts the resolved settings (HEVC, Auto encoder, Auto
 * bitrate, modern/Lightning pipeline, 30 FPS, 4K) and that the CUDA
 * `nvidia-cuda-compositor` backend was actually selected with no CPU/raw
 * fallback, then reports native and end-to-end throughput.
 *
 * Run `node scripts/benchmark-lightning-cuda4k.mjs --help` for usage.
 */

import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import electron from "electron";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mainEntry = path.join(repoRoot, "dist-electron", "main.cjs");
const rendererEntry = path.join(repoRoot, "dist", "index.html");
const cudaWrapperPath = path.join(
	repoRoot,
	"electron",
	"native",
	"nvidia-cuda-compositor",
	"run-mp4-pipeline.mjs",
);
const preferredSourcePath = path.join(repoRoot, ".tmp", "cuda4k", "source-4k.mp4");

const BENCH_WIDTH = 3840;
const BENCH_HEIGHT = 2160;
const BENCH_FRAME_RATE = 30;
const DEFAULT_RUNS = 3;
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_FIXTURE_DURATION_SEC = 5;
const MAX_CAPTURED_LOG_BYTES = 8 * 1024 * 1024;

const CUDA_OPT_IN_ENV = "RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT";
const CUDA_ALLOW_AUDIO_ENV = "RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT";
const CUDA_EXPORT_EXE_ENV = "RECORDLY_NVIDIA_CUDA_EXPORT_EXE";
const CUDA_EXPORT_SCRIPT_ENV = "RECORDLY_NVIDIA_CUDA_EXPORT_SCRIPT";
const FFMPEG_EXE_ENV = "RECORDLY_FFMPEG_EXE";
const FFPROBE_EXE_ENV = "RECORDLY_FFPROBE_EXE";

const CUDA_NATIVE_BACKEND = "nvidia-cuda-compositor";
const CUDA_COMPLETED_LOG_MARKER = "[native-static-layout-export] NVIDIA CUDA compositor completed";

const SOURCE_CODEC = "h264";
const SOURCE_PIX_FMT = "yuv420p";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
	printUsage();
	process.exit(0);
}

function parseArgs(rawArgs) {
	const parsed = {
		runs: readIntArg(rawArgs, "--runs", DEFAULT_RUNS),
		timeoutMs: readIntArg(rawArgs, "--timeout-ms", DEFAULT_TIMEOUT_MS),
		input: readStringArg(rawArgs, "--input", null),
		keepWorkdir: rawArgs.includes("--keep-workdir"),
		json: rawArgs.includes("--json"),
		dryRun: rawArgs.includes("--dry-run"),
		help: rawArgs.includes("--help") || rawArgs.includes("-h"),
	};

	if (parsed.runs < 1) {
		throw new Error("--runs must be a positive integer");
	}
	if (parsed.timeoutMs < 10_000) {
		throw new Error("--timeout-ms must be at least 10000");
	}

	return parsed;
}

function readIntArg(rawArgs, name, fallback) {
	const index = rawArgs.indexOf(name);
	if (index === -1) {
		return fallback;
	}
	const rawValue = rawArgs[index + 1];
	if (rawValue === undefined) {
		throw new Error(`${name} requires a value`);
	}
	const parsed = Number.parseInt(rawValue, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function readStringArg(rawArgs, name, fallback) {
	const index = rawArgs.indexOf(name);
	if (index === -1) {
		return fallback;
	}
	const rawValue = rawArgs[index + 1];
	return rawValue === undefined ? fallback : rawValue;
}

function printUsage() {
	console.log(`[benchmark-lightning-cuda4k] Usage: node scripts/benchmark-lightning-cuda4k.mjs [options]

Deterministic production-path benchmark for the Lightning (modern) HEVC export
over the NVIDIA CUDA compositor. Launches the real Electron app in smoke
auto-export mode; it does not call run-mp4-pipeline.mjs directly.

Options:
  --runs N            Number of repeats (default ${DEFAULT_RUNS}). Each run gets a
                      fresh output path and isolated scratch/userData directory.
  --input PATH        Use PATH as the 4K source instead of
                      .tmp/cuda4k/source-4k.mp4 (which is used when present and
                      valid). A generated deterministic fixture is used otherwise.
  --timeout-ms N      Per-run Electron timeout in milliseconds (default
                      ${DEFAULT_TIMEOUT_MS}).
  --keep-workdir      Keep the scratch directory (source fixture, outputs, user
                      data, result.json) instead of deleting it.
  --json              Print the full JSON result to stdout (also always saved at
                      <scratch>/result.json).
  --dry-run           Check all prerequisites and validate the source, but do not
                      launch Electron.
  -h, --help          Show this help and exit.

Environment:
  RECORDLY_LIGHTNING_BENCH_KEEP_WORKDIR=1  Equivalent to --keep-workdir.
  The benchmark sets the smoke export overrides and CUDA opt-in env itself; see
  docs/benchmarks/lightning-cuda4k.md for the exact contract.

Exit codes: 0 success, 1 any prerequisite/export/assertion failure. Errors print
the captured Electron log tail plus report/error details.`);
}

function collectUniqueStrings(values) {
	return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function average(values) {
	if (values.length === 0) {
		return 0;
	}
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const middleIndex = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
	}
	return sorted[middleIndex];
}

function formatMs(value) {
	return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} ms` : "-";
}

function formatFps(value) {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} fps` : "-";
}

function formatMegabytes(value) {
	return typeof value === "number" && Number.isFinite(value)
		? `${(value / (1024 * 1024)).toFixed(2)} MB`
		: "-";
}

function formatTableCell(value) {
	if (Array.isArray(value)) {
		return value.length > 0 ? value.join(", ") : "-";
	}
	if (value === null || value === undefined || value === "") {
		return "-";
	}
	return String(value).replace(/\s+/g, " ").trim();
}

function printTable(title, columns, rows) {
	if (!Array.isArray(rows) || rows.length === 0) {
		return;
	}

	const formattedRows = rows.map((row) =>
		columns.map((column) => formatTableCell(column.getValue(row))),
	);
	const widths = columns.map((column, columnIndex) => {
		const headerWidth = column.header.length;
		const rowWidth = Math.max(...formattedRows.map((row) => row[columnIndex].length));
		return Math.max(headerWidth, rowWidth);
	});
	const divider = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

	console.log(`[benchmark-lightning-cuda4k] ${title}`);
	console.log(
		`| ${columns
			.map((column, columnIndex) => column.header.padEnd(widths[columnIndex]))
			.join(" | ")} |`,
	);
	console.log(divider);
	for (const row of formattedRows) {
		console.log(
			`| ${row.map((value, columnIndex) => value.padEnd(widths[columnIndex])).join(" | ")} |`,
		);
	}
}

function resolveCudaHelperExePath() {
	const configuredPath = process.env[CUDA_EXPORT_EXE_ENV];
	if (configuredPath) {
		return configuredPath;
	}

	const platformArch = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
	const candidates = [
		path.join(
			repoRoot,
			"electron",
			"native",
			"bin",
			platformArch,
			"recordly-nvidia-cuda-compositor.exe",
		),
		path.join(
			repoRoot,
			"electron",
			"native",
			"nvidia-cuda-compositor",
			"build",
			"Release",
			"recordly-nvidia-cuda-compositor.exe",
		),
	];

	return candidates.find((candidate) => hasFileSync(candidate)) ?? null;
}

function hasFileSync(targetPath) {
	try {
		return existsSync(targetPath);
	} catch {
		return false;
	}
}

function formatActionablePrerequisiteError(details) {
	return [
		`Prerequisite check failed: ${details}`,
		"How to fix:",
		"  - Build the renderer and main bundles: npm run build (or npm run tsc && npx vite build --config vite.config.ts && npm run normalize:electron-main-cjs)",
		"  - Build the NVIDIA CUDA compositor helper: npm run build:nvidia-cuda-compositor (requires CUDA Toolkit, MSVC, and the NVIDIA Video Codec SDK).",
		"  - Ensure ffmpeg-static and ffprobe-static are installed (npm ci).",
		"  - The benchmark must run on a Windows machine with an NVIDIA GPU and current drivers.",
	].join("\n");
}

async function ensureBuildArtifacts() {
	await fs.access(mainEntry);
	await fs.access(rendererEntry);
}

async function probeVideoMetadata(ffprobePath, videoPath) {
	const { stdout } = await execFileAsync(
		ffprobePath,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=codec_name,pix_fmt,width,height,r_frame_rate,duration",
			"-of",
			"json",
			videoPath,
		],
		{
			timeout: 30_000,
			maxBuffer: 20 * 1024 * 1024,
		},
	);

	const parsed = JSON.parse(stdout);
	const stream = parsed?.streams?.[0];
	if (!stream) {
		throw new Error(`No video stream found in ${videoPath}`);
	}

	const frameRateMatch = String(stream.r_frame_rate ?? "").match(/^(\d+)\/(\d+)$/);
	const frameRate = frameRateMatch
		? Number.parseFloat(frameRateMatch[1]) / Number.parseFloat(frameRateMatch[2])
		: Number.parseFloat(stream.r_frame_rate ?? "");

	return {
		codecName: stream.codec_name ?? null,
		pixFmt: stream.pix_fmt ?? null,
		width: Number.isFinite(Number(stream.width)) ? Number(stream.width) : null,
		height: Number.isFinite(Number(stream.height)) ? Number(stream.height) : null,
		frameRate: Number.isFinite(frameRate) ? frameRate : null,
		durationSec: Number.isFinite(Number(stream.duration)) ? Number(stream.duration) : null,
	};
}

function assertSourceCompliant(metadata, sourcePath) {
	const problems = [];
	if (metadata.codecName !== SOURCE_CODEC) {
		problems.push(`codec must be ${SOURCE_CODEC}, got ${metadata.codecName ?? "unknown"}`);
	}
	if (metadata.pixFmt !== SOURCE_PIX_FMT) {
		problems.push(
			`pixel format must be ${SOURCE_PIX_FMT}, got ${metadata.pixFmt ?? "unknown"}`,
		);
	}
	if (metadata.width !== BENCH_WIDTH) {
		problems.push(`width must be ${BENCH_WIDTH}, got ${metadata.width ?? "unknown"}`);
	}
	if (metadata.height !== BENCH_HEIGHT) {
		problems.push(`height must be ${BENCH_HEIGHT}, got ${metadata.height ?? "unknown"}`);
	}
	if (metadata.frameRate !== null && Math.abs(metadata.frameRate - BENCH_FRAME_RATE) > 0.01) {
		problems.push(`frame rate must be ${BENCH_FRAME_RATE}, got ${metadata.frameRate}`);
	}

	if (problems.length > 0) {
		throw new Error(
			`Source ${sourcePath} is not a compliant deterministic 4K fixture:\n  - ${problems.join("\n  - ")}\n` +
				`Remove or replace the source so the benchmark stays deterministic, or use --input with a compliant file.`,
		);
	}
}

async function createDeterministicSource(ffmpegPath, targetPath) {
	const args = [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		`testsrc2=size=${BENCH_WIDTH}x${BENCH_HEIGHT}:rate=${BENCH_FRAME_RATE}`,
		"-t",
		String(DEFAULT_FIXTURE_DURATION_SEC),
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-pix_fmt",
		SOURCE_PIX_FMT,
		"-an",
		"-movflags",
		"+faststart",
		targetPath,
	];

	await execFileAsync(ffmpegPath, args, {
		timeout: 120_000,
		maxBuffer: 20 * 1024 * 1024,
	});
}

async function resolveSource(scratchRoot, ffprobePath) {
	const ffmpegPath = ffmpegStatic;
	let sourcePath;

	if (args.input) {
		sourcePath = path.resolve(args.input);
		if (!(await pathExists(sourcePath))) {
			throw new Error(
				`--input source does not exist: ${sourcePath}\n` +
					"Provide a compliant 4K H.264/yuv420p file or remove the flag to use the default source.",
			);
		}
	} else if (await pathExists(preferredSourcePath)) {
		sourcePath = preferredSourcePath;
	}

	if (sourcePath) {
		console.log(`[benchmark-lightning-cuda4k] Validating source: ${sourcePath}`);
		const metadata = await probeVideoMetadata(ffprobePath, sourcePath);
		assertSourceCompliant(metadata, sourcePath);
		return { sourcePath, inputMetadata: metadata, generated: false };
	}

	const fixtureDir = path.join(scratchRoot, "fixtures");
	await fs.mkdir(fixtureDir, { recursive: true });
	sourcePath = path.join(fixtureDir, "source-4k.mp4");
	console.log(`[benchmark-lightning-cuda4k] Generating deterministic 4K fixture: ${sourcePath}`);
	await createDeterministicSource(ffmpegPath, sourcePath);
	const metadata = await probeVideoMetadata(ffprobePath, sourcePath);
	assertSourceCompliant(metadata, sourcePath);
	return { sourcePath, inputMetadata: metadata, generated: true };
}

async function pathExists(targetPath) {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

function parseNvidiaCudaCompletionBlock(logText) {
	const lines = logText.split(/\r?\n/);
	const startIndex = lines.findIndex((line) => line.includes(CUDA_COMPLETED_LOG_MARKER));
	if (startIndex === -1) {
		return {};
	}

	// Node's console.info prints the object with util.inspect, which wraps long
	// objects across lines. Collect the block until the next log entry that
	// starts with a bracket prefix or until the buffer ends.
	const blockLines = [];
	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index];
		if (index > startIndex && /^\s*\[[^\]]+\]/.test(line)) {
			break;
		}
		blockLines.push(line);
	}
	const block = blockLines.join(" ");

	const metrics = {};
	const numericKeys = [
		"nativeFps",
		"outputFps",
		"endToEndMs",
		"nativeEncodeWallMs",
		"totalMs",
		"overlayHostReadMs",
		"overlayH2DEnqueueMs",
		"changedTileCount",
		"uploadedTileBytes",
		"cachedTileCount",
	];
	for (const key of numericKeys) {
		const match = block.match(new RegExp(`\\b${key}:\\s*(-?[0-9]+(?:\\.[0-9]+)?)`));
		if (match) {
			const parsed = Number.parseFloat(match[1]);
			if (Number.isFinite(parsed)) {
				metrics[key] = parsed;
			}
		}
	}

	return metrics;
}

function collectErrorLines(logText) {
	const lines = logText.split(/\r?\n/);
	const errorLines = [];
	for (const line of lines) {
		if (
			/noCpuFallback/.test(line) ||
			/Strict HEVC Hardware policy/.test(line) ||
			/\[smoke-export\].*error/i.test(line) ||
			/refusing .* fallback/i.test(line)
		) {
			errorLines.push(line.trim());
		}
	}
	return errorLines;
}

function extractLogTail(logText, maxLines = 80) {
	const lines = logText.split(/\r?\n/).filter((line) => line.trim().length > 0);
	return lines.slice(-maxLines).join("\n");
}

function assertCudaRouteSelected(report, logText) {
	const metrics = report?.metrics ?? {};
	const chunks = metrics?.finalizationStageMs?.ffmpegAudioMuxBreakdown?.chunks ?? [];
	const chunkBackends = collectUniqueStrings(chunks.map((chunk) => chunk?.backend));
	const encoderName = metrics?.encoderName;
	if (encoderName === CUDA_NATIVE_BACKEND || chunkBackends.includes(CUDA_NATIVE_BACKEND)) {
		return CUDA_NATIVE_BACKEND;
	}

	const skipReason = metrics?.nativeStaticLayoutSkipReason;
	const skipReasons = Array.isArray(metrics?.nativeStaticLayoutSkipReasons)
		? metrics.nativeStaticLayoutSkipReasons
		: [];
	const details = [
		`encoderName=${encoderName ?? "undefined"}`,
		`chunks.backend=[${chunkBackends.join(", ") || "none"}]`,
		`pipelineModel=${report?.resolvedSettings?.pipelineModel ?? "undefined"}`,
		skipReason ? `skipReason=${skipReason}` : null,
		skipReasons.length > 0 ? `skipReasons=[${skipReasons.join(", ")}]` : null,
		`previewHints=${logText.includes("NVIDIA CUDA availability") ? "availability-log-present" : "none"}`,
	]
		.filter(Boolean)
		.join("; ");

	throw new Error(
		`CUDA native route was NOT selected for HEVC export. ${details}\n` +
			"The export fell back to a renderer raw frame / WebCodecs encoder instead of the " +
			`${CUDA_NATIVE_BACKEND} compositor. Check NVIDIA GPU/driver availability, the CUDA ` +
			"helper build, and the resolved settings. Log tail:\n" +
			extractLogTail(logText),
	);
}

function assertNoCpuFallbackFailure(report, logText) {
	const errorLines = collectErrorLines(logText);
	if (errorLines.length > 0) {
		throw new Error(
			`Reported native fallback/CPU-fallback failure lines:\n${errorLines.join("\n")}\n` +
				"Log tail:\n" +
				extractLogTail(logText),
		);
	}
}

function validateRunReport(report, outputPath, logText) {
	if (!report || typeof report !== "object") {
		throw new Error(
			`Missing or invalid smoke report for ${outputPath}.${report ? "report.json" : ""}\n` +
				"Log tail:\n" +
				extractLogTail(logText),
		);
	}

	if (report.success !== true) {
		throw new Error(
			`Smoke export did not succeed. phase=${report.phase ?? "unknown"} error=${report.error ?? "unknown"}\n` +
				"Log tail:\n" +
				extractLogTail(logText),
		);
	}

	if (report.phase !== "saved") {
		throw new Error(
			`Smoke export finished but did not save output. phase=${report.phase ?? "unknown"} error=${report.error ?? "none"}\n` +
				"Log tail:\n" +
				extractLogTail(logText),
		);
	}

	const resolvedSettings = report.resolvedSettings ?? {};
	const problems = [];
	if (resolvedSettings.codec !== "hevc") {
		problems.push(`codec=hevc, got ${resolvedSettings.codec ?? "undefined"}`);
	}
	if (resolvedSettings.encoderPreference !== "auto") {
		problems.push(
			`encoderPreference=auto, got ${resolvedSettings.encoderPreference ?? "undefined"}`,
		);
	}
	if (resolvedSettings.bitrateMode !== "auto") {
		problems.push(`bitrateMode=auto, got ${resolvedSettings.bitrateMode ?? "undefined"}`);
	}
	if (resolvedSettings.pipelineModel !== "modern") {
		problems.push(
			`pipelineModel=modern (Lightning), got ${resolvedSettings.pipelineModel ?? "undefined"}`,
		);
	}
	if (resolvedSettings.frameRate !== BENCH_FRAME_RATE) {
		problems.push(
			`frameRate=${BENCH_FRAME_RATE}, got ${resolvedSettings.frameRate ?? "undefined"}`,
		);
	}
	if (!(typeof resolvedSettings.bitrateBps === "number" && resolvedSettings.bitrateBps > 0)) {
		problems.push(
			`positive resolved automatic bitrate (bitrateBps), got ${resolvedSettings.bitrateBps ?? "undefined"}`,
		);
	}

	if (problems.length > 0) {
		throw new Error(
			`Resolved settings contract violated for ${outputPath}:\n  - ${problems.join("\n  - ")}\n` +
				`resolvedSettings=${JSON.stringify(resolvedSettings)}\n` +
				"Log tail:\n" +
				extractLogTail(logText),
		);
	}

	assertNoCpuFallbackFailure(report, logText);
	assertCudaRouteSelected(report, logText);
}

async function readSmokeExportReport(outputPath) {
	const reportPath = `${outputPath}.report.json`;
	try {
		const reportContent = await fs.readFile(reportPath, "utf8");
		return {
			reportPath,
			report: JSON.parse(reportContent),
		};
	} catch {
		return null;
	}
}

function buildSmokeEnv(inputPath, outputPath, cudaHelperExePath) {
	return {
		...process.env,
		RECORDLY_SMOKE_EXPORT: "1",
		RECORDLY_SMOKE_EXPORT_INPUT: inputPath,
		RECORDLY_SMOKE_EXPORT_OUTPUT: outputPath,
		RECORDLY_SMOKE_EXPORT_USE_NATIVE: "1",
		RECORDLY_SMOKE_EXPORT_PIPELINE: "modern",
		RECORDLY_SMOKE_EXPORT_BACKEND: "auto",
		RECORDLY_SMOKE_EXPORT_VIDEO_CODEC: "hevc",
		RECORDLY_SMOKE_EXPORT_ENCODER_PREFERENCE: "auto",
		RECORDLY_SMOKE_EXPORT_BITRATE_MODE: "auto",
		RECORDLY_SMOKE_EXPORT_QUALITY: "source",
		RECORDLY_SMOKE_EXPORT_ENCODING_MODE: "balanced",
		RECORDLY_SMOKE_EXPORT_FPS: String(BENCH_FRAME_RATE),
		[CUDA_OPT_IN_ENV]: "1",
		[CUDA_ALLOW_AUDIO_ENV]: "1",
		[FFMPEG_EXE_ENV]: ffmpegStatic,
		[FFPROBE_EXE_ENV]: ffprobeStaticPath(),
		...(cudaHelperExePath ? { [CUDA_EXPORT_EXE_ENV]: cudaHelperExePath } : {}),
		[CUDA_EXPORT_SCRIPT_ENV]: cudaWrapperPath,
	};
}

function ffprobeStaticPath() {
	if (typeof ffprobeStatic === "string" && ffprobeStatic.length > 0) {
		return ffprobeStatic;
	}
	if (typeof ffprobeStatic === "object" && typeof ffprobeStatic?.path === "string") {
		return ffprobeStatic.path;
	}
	return null;
}

function killProcessTree(child) {
	if (typeof child.pid !== "number") {
		return;
	}
	if (process.platform === "win32") {
		try {
			spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
				timeout: 10_000,
			});
		} catch {
			// Fall through to the plain kill below.
		}
	}
	try {
		child.kill("SIGKILL");
	} catch {
		// Best effort; the child may already be gone.
	}
}

async function seedIsolatedUserData(userDataDir) {
	await fs.mkdir(path.join(userDataDir, "session"), { recursive: true });
	// The renderer's NVIDIA CUDA opt-in is read from the stored app setting
	// (recordly.export.experimentalNvidiaCuda). Seed it so HEVC + Auto selects
	// the CUDA compositor route in the isolated userData dir. The env var
	// RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT=1 flips the main-process side to
	// explicit-enabled as well.
	const appSettingsPath = path.join(userDataDir, "app-settings.json");
	await fs.writeFile(
		appSettingsPath,
		JSON.stringify({ "recordly.export.experimentalNvidiaCuda": true }, null, 2),
		"utf-8",
	);
}

async function runSingleExport({
	runIndex,
	scratchRoot,
	inputPath,
	inputMetadata,
	cudaHelperExePath,
}) {
	const runsDir = path.join(scratchRoot, "runs");
	await fs.mkdir(runsDir, { recursive: true });
	const outputPath = path.join(runsDir, `run-${runIndex}-${Date.now()}.mp4`);
	const userDataDir = path.join(scratchRoot, "user-data");
	await seedIsolatedUserData(userDataDir);

	const startedAt = performance.now();
	const runLabel = `run ${runIndex}`;
	const child = spawn(electron, [`--user-data-dir=${userDataDir}`, repoRoot], {
		cwd: repoRoot,
		env: buildSmokeEnv(inputPath, outputPath, cudaHelperExePath),
		stdio: ["ignore", "pipe", "pipe"],
	});

	let combinedOutput = "";
	let outputTruncated = false;
	const appendOutput = (text) => {
		if (combinedOutput.length >= MAX_CAPTURED_LOG_BYTES) {
			if (!outputTruncated) {
				combinedOutput += "\n[benchmark-lightning-cuda4k] (captured output truncated)\n";
				outputTruncated = true;
			}
			return;
		}
		combinedOutput += text;
	};
	child.stdout.on("data", (chunk) => appendOutput(chunk.toString()));
	child.stderr.on("data", (chunk) => appendOutput(chunk.toString()));

	const timeout = setTimeout(() => {
		killProcessTree(child);
	}, args.timeoutMs);

	let exitCode;
	let signal;
	try {
		[exitCode, signal] = await once(child, "close");
	} finally {
		clearTimeout(timeout);
	}

	if (exitCode !== 0) {
		const signalText = signal ? ` (signal ${signal})` : "";
		throw new Error(
			`${runLabel} failed with exit code ${exitCode ?? "unknown"}${signalText}\n` +
				"Captured log tail:\n" +
				extractLogTail(combinedOutput),
		);
	}

	const reportResult = await readSmokeExportReport(outputPath);
	if (!reportResult) {
		throw new Error(
			`${runLabel} produced no smoke report at ${outputPath}.report.json\n` +
				"Captured log tail:\n" +
				extractLogTail(combinedOutput),
		);
	}

	validateRunReport(reportResult.report, outputPath, combinedOutput);

	const outputStats = await fs.stat(outputPath);
	if (outputStats.size <= 0) {
		throw new Error(
			`${runLabel} produced an empty output file ${outputPath}\n` +
				"Captured log tail:\n" +
				extractLogTail(combinedOutput),
		);
	}

	const outputMetadata = await probeVideoMetadata(ffprobeStaticPath(), outputPath);
	const completionMetrics = parseNvidiaCudaCompletionBlock(combinedOutput);
	const wallMs = Math.round(performance.now() - startedAt);
	const reportElapsedMs = reportResult.report.elapsedMs;
	const sourceDurationSec = inputMetadata.durationSec ?? 0;
	const totalFrames =
		sourceDurationSec > 0 ? Math.round(sourceDurationSec * BENCH_FRAME_RATE) : null;
	const e2eFps = totalFrames !== null && wallMs > 0 ? (totalFrames / wallMs) * 1000 : null;

	return {
		runIndex,
		outputPath,
		reportPath: reportResult.reportPath,
		wallMs,
		reportElapsedMs:
			typeof reportElapsedMs === "number" && Number.isFinite(reportElapsedMs)
				? Math.round(reportElapsedMs)
				: null,
		sizeBytes: outputStats.size,
		outputMetadata: {
			width: outputMetadata.width,
			height: outputMetadata.height,
			frameRate:
				typeof outputMetadata.frameRate === "number" &&
				Number.isFinite(outputMetadata.frameRate)
					? Math.round(outputMetadata.frameRate)
					: null,
		},
		totalFrames,
		e2eFps,
		nativeFps: completionMetrics.nativeFps ?? null,
		resolvedSettings: reportResult.report.resolvedSettings,
		metrics: reportResult.report.metrics,
		nativeMetrics: completionMetrics,
		errorLines: collectErrorLines(combinedOutput),
	};
}

function buildRunTableRows(runs) {
	return runs.map((run) => ({
		run: `#${run.runIndex}`,
		wallMs: run.wallMs,
		reportElapsedMs: run.reportElapsedMs,
		nativeFps: run.nativeMetrics?.nativeFps ?? null,
		e2eFps: run.e2eFps,
		outputFps: run.outputMetadata?.frameRate ?? null,
		sizeBytes: run.sizeBytes,
	}));
}

function printSummaryTable(summary) {
	const rows = [
		{ key: "Wall time", value: summary.wallMs },
		{ key: "Export time (report.elapsedMs)", value: summary.reportElapsedMs },
		{ key: "Native FPS (helper measured)", value: summary.nativeFps },
		{ key: "End-to-end FPS", value: summary.e2eFps },
		{ key: "Output size", value: summary.sizeBytes },
	];

	printTable(
		"Summary (mean / median / min / max)",
		[
			{ header: "Metric", getValue: (row) => row.key },
			{ header: "Mean", getValue: (row) => formatStatistic(row.value) },
			{ header: "Median", getValue: (row) => formatStatistic(row.value, "median") },
			{ header: "Min", getValue: (row) => formatStatistic(row.value, "min") },
			{ header: "Max", getValue: (row) => formatStatistic(row.value, "max") },
		],
		rows,
	);
}

function formatStatistic(stat, mode = "mean") {
	if (!stat || stat.mode === "none") {
		return "-";
	}
	const value = stat[mode];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "-";
	}
	if (stat.unit === "fps") {
		return `${value.toFixed(1)} fps`;
	}
	if (stat.unit === "bytes") {
		return formatMegabytes(value);
	}
	return `${Math.round(value)} ms`;
}

function dereferenceSummary(summary) {
	const dereference = (stat) => ({
		unit: stat.unit,
		mean: stat.mode === "values" ? stat.mean : null,
		median: stat.mode === "values" ? stat.median : null,
		min: stat.mode === "values" ? stat.min : null,
		max: stat.mode === "values" ? stat.max : null,
	});

	return {
		wallMs: dereference(summary.wallMs),
		reportElapsedMs: dereference(summary.reportElapsedMs),
		nativeFps: dereference(summary.nativeFps),
		e2eFps: dereference(summary.e2eFps),
		sizeBytes: dereference(summary.sizeBytes),
	};
}

function buildSummaryWithUnits(runs) {
	const numericValues = (key) =>
		runs
			.map((run) => run[key])
			.filter((value) => typeof value === "number" && Number.isFinite(value));

	const summarize = (key, unit) => {
		const values = numericValues(key);
		if (values.length === 0) {
			return { mode: "none", unit };
		}
		return {
			mode: "values",
			unit,
			mean: average(values),
			median: median(values),
			min: Math.min(...values),
			max: Math.max(...values),
		};
	};

	return {
		wallMs: summarize("wallMs", "ms"),
		reportElapsedMs: summarize("reportElapsedMs", "ms"),
		nativeFps: summarize("nativeFps", "fps"),
		e2eFps: summarize("e2eFps", "fps"),
		sizeBytes: summarize("sizeBytes", "bytes"),
	};
}

function buildFinalResult({
	runs,
	sourcePath,
	inputMetadata,
	cudaHelperExePath,
	scratchRoot,
	generated,
}) {
	const summary = buildSummaryWithUnits(runs);
	return {
		benchmark: {
			name: "lightning-cuda4k",
			width: BENCH_WIDTH,
			height: BENCH_HEIGHT,
			frameRate: BENCH_FRAME_RATE,
			pipeline: "modern",
			backend: "nvidia-cuda-compositor",
			videoCodec: "hevc",
			encoderPreference: "auto",
			bitrateMode: "auto",
			quality: "source",
			encodingMode: "balanced",
			runs: runs.length,
		},
		source: {
			path: sourcePath,
			generated,
			durationSec: inputMetadata.durationSec ?? null,
			codec: inputMetadata.codecName ?? null,
			pixFmt: inputMetadata.pixFmt ?? null,
		},
		cudaHelper: cudaHelperExePath,
		scratchRoot,
		summary: dereferenceSummary(summary),
		runs: runs.map((run) => ({
			run: run.runIndex,
			outputPath: run.outputPath,
			wallMs: run.wallMs,
			reportElapsedMs: run.reportElapsedMs,
			sizeBytes: run.sizeBytes,
			outputMetadata: run.outputMetadata,
			totalFrames: run.totalFrames,
			e2eFps: run.e2eFps,
			nativeFps: run.nativeFps,
			nativeMetrics: run.nativeMetrics,
			errorLines: run.errorLines,
		})),
	};
}

async function main() {
	if (typeof ffmpegStatic !== "string" || ffmpegStatic.length === 0) {
		throw new Error(
			formatActionablePrerequisiteError("ffmpeg-static is unavailable for this platform"),
		);
	}

	const ffprobePath = ffprobeStaticPath();
	if (process.platform !== "win32") {
		throw new Error(
			"The NVIDIA CUDA compositor route is Windows-only; benchmark must run on Windows with an NVIDIA GPU.",
		);
	}

	await ensureBuildArtifacts();

	if (!(await pathExists(cudaWrapperPath))) {
		throw new Error(
			formatActionablePrerequisiteError(
				`CUDA compositor wrapper not found at ${cudaWrapperPath}`,
			),
		);
	}

	const cudaHelperExePath = resolveCudaHelperExePath();
	if (!cudaHelperExePath) {
		throw new Error(
			formatActionablePrerequisiteError(
				"recordly-nvidia-cuda-compositor.exe is not built. Run npm run build:nvidia-cuda-compositor.",
			),
		);
	}

	const scratchTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const scratchRoot = path.join(repoRoot, ".tmp", "cuda4k", `bench-${scratchTimestamp}`);
	await fs.mkdir(scratchRoot, { recursive: true });

	try {
		const { sourcePath, inputMetadata, generated } = await resolveSource(
			scratchRoot,
			ffprobePath,
		);

		console.log("[benchmark-lightning-cuda4k] Config");
		console.log(
			JSON.stringify({
				width: BENCH_WIDTH,
				height: BENCH_HEIGHT,
				frameRate: BENCH_FRAME_RATE,
				videoCodec: "hevc",
				encoderPreference: "auto",
				bitrateMode: "auto",
				quality: "source",
				encodingMode: "balanced",
				pipeline: "modern",
				useNativeExport: true,
				runs: args.runs,
				timeoutMs: args.timeoutMs,
				sourcePath,
				sourceGenerated: generated,
				cudaHelper: cudaHelperExePath,
				scratchRoot,
			}),
		);

		if (args.dryRun) {
			console.log(
				"[benchmark-lightning-cuda4k] Dry run: prerequisites and source validated; not launching Electron.",
			);
			await fs.rm(scratchRoot, { recursive: true, force: true });
			return;
		}

		const runs = [];
		for (let index = 1; index <= args.runs; index += 1) {
			console.log(
				`[benchmark-lightning-cuda4k] Running ${index}/${args.runs} (HEVC + Auto @ 4K30, CUDA compositor)`,
			);
			runs.push(
				await runSingleExport({
					runIndex: index,
					scratchRoot,
					inputPath: sourcePath,
					inputMetadata,
					cudaHelperExePath,
				}),
			);
		}

		const finalResult = buildFinalResult({
			runs,
			sourcePath,
			inputMetadata,
			cudaHelperExePath,
			scratchRoot,
			generated,
		});

		const resultPath = path.join(scratchRoot, "result.json");
		await fs.writeFile(resultPath, JSON.stringify(finalResult, null, 2), "utf-8");

		console.log("[benchmark-lightning-cuda4k] Per-run results");
		printTable(
			"Runs",
			[
				{ header: "Run", getValue: (row) => row.run },
				{ header: "Wall", getValue: (row) => formatMs(row.wallMs) },
				{ header: "Export", getValue: (row) => formatMs(row.reportElapsedMs) },
				{ header: "Native FPS", getValue: (row) => formatFps(row.nativeFps) },
				{ header: "E2E FPS", getValue: (row) => formatFps(row.e2eFps) },
				{ header: "Out FPS", getValue: (row) => formatFps(row.outputFps) },
				{ header: "Size", getValue: (row) => formatMegabytes(row.sizeBytes) },
			],
			buildRunTableRows(runs),
		);

		const summary = buildSummaryWithUnits(runs);
		printSummaryTable(summary);

		console.log(
			`[benchmark-lightning-cuda4k] Median native FPS: ${formatFps(summary.nativeFps.median)}`,
		);
		console.log(
			`[benchmark-lightning-cuda4k] Median end-to-end FPS: ${formatFps(summary.e2eFps.median)}`,
		);

		if (args.json) {
			console.log("[benchmark-lightning-cuda4k] JSON result");
			console.log(JSON.stringify(finalResult));
		}

		if (args.keepWorkdir || process.env.RECORDLY_LIGHTNING_BENCH_KEEP_WORKDIR === "1") {
			console.log(`[benchmark-lightning-cuda4k] Preserved scratch: ${scratchRoot}`);
		} else {
			await fs.rm(scratchRoot, { recursive: true, force: true });
			console.log("[benchmark-lightning-cuda4k] Cleaned scratch workdir.");
		}
	} catch (error) {
		if (args.keepWorkdir || process.env.RECORDLY_LIGHTNING_BENCH_KEEP_WORKDIR === "1") {
			console.log(`[benchmark-lightning-cuda4k] Preserved scratch on error: ${scratchRoot}`);
		} else {
			await fs.rm(scratchRoot, { recursive: true, force: true });
		}
		throw error;
	}
}

main().catch((error) => {
	console.error(
		`[benchmark-lightning-cuda4k] ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
});
