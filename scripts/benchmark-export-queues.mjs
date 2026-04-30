import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import electron from "electron";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const mainEntryCandidates = [
	path.join(repoRoot, "dist-electron", "main.js"),
	path.join(repoRoot, "dist-electron", "main.cjs"),
];
const rendererEntry = path.join(repoRoot, "dist", "index.html");

const width = parseEvenInteger(process.env.RECORDLY_BENCH_EXPORT_WIDTH ?? "1280", "Width");
const height = parseEvenInteger(process.env.RECORDLY_BENCH_EXPORT_HEIGHT ?? "720", "Height");
const frameRate = parsePositiveInteger(process.env.RECORDLY_BENCH_EXPORT_FPS ?? "60", "Frame rate");
const durationSeconds = parsePositiveInteger(
	process.env.RECORDLY_BENCH_EXPORT_DURATION ?? "15",
	"Duration",
);
const timeoutMs = parsePositiveInteger(
	process.env.RECORDLY_BENCH_EXPORT_TIMEOUT_MS ?? "180000",
	"Timeout",
);
const runsPerVariant = parsePositiveInteger(process.env.RECORDLY_BENCH_EXPORT_RUNS ?? "2", "Runs");
const useNativeExport = process.env.RECORDLY_BENCH_EXPORT_USE_NATIVE === "1";
const useWebcamOverlay = process.env.RECORDLY_BENCH_EXPORT_ENABLE_WEBCAM === "1";
const useSourceOnlyScene = process.env.RECORDLY_BENCH_EXPORT_SOURCE_ONLY === "1";
const exportEncodingMode = parseExportEncodingMode(
	process.env.RECORDLY_BENCH_EXPORT_ENCODING_MODE ?? null,
);
const exportQuality = parseExportQuality(process.env.RECORDLY_BENCH_EXPORT_QUALITY ?? "source");
const exportShadowIntensity = parseExportShadowIntensity(
	process.env.RECORDLY_BENCH_EXPORT_SHADOW_INTENSITY ?? null,
);
const webcamWidth = parseEvenInteger(
	process.env.RECORDLY_BENCH_EXPORT_WEBCAM_WIDTH ?? "640",
	"Webcam width",
);
const webcamHeight = parseEvenInteger(
	process.env.RECORDLY_BENCH_EXPORT_WEBCAM_HEIGHT ?? "360",
	"Webcam height",
);
const webcamShadowIntensity = parseExportShadowIntensity(
	process.env.RECORDLY_BENCH_EXPORT_WEBCAM_SHADOW ?? null,
);
const webcamSize = parseExportWebcamSize(process.env.RECORDLY_BENCH_EXPORT_WEBCAM_SIZE ?? null);
const MODERN_BACKEND_SWEEP = ["auto", "webcodecs", "breeze"];
const exportPipeline = parseExportPipeline(process.env.RECORDLY_BENCH_EXPORT_PIPELINE ?? null);
const exportBackend = parseExportBackend(process.env.RECORDLY_BENCH_EXPORT_BACKEND ?? null);
const exportBackendList = parseExportBackendList(
	process.env.RECORDLY_BENCH_EXPORT_BACKENDS ?? null,
);

const VARIANT_PRESETS = {
	adaptive: { name: "adaptive" },
	baseline: { name: "baseline", maxEncodeQueue: 120, maxDecodeQueue: 10, maxPendingFrames: 24 },
	tuned: { name: "tuned", maxEncodeQueue: 240, maxDecodeQueue: 12, maxPendingFrames: 32 },
};

const variantNameList = parseBenchmarkVariantList(
	process.env.RECORDLY_BENCH_EXPORT_VARIANTS ?? null,
);

const variants = variantNameList
	? variantNameList.map((variantName) => VARIANT_PRESETS[variantName])
	: [VARIANT_PRESETS.baseline, VARIANT_PRESETS.tuned];

function collectUniqueStrings(values) {
	return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function parsePositiveInteger(rawValue, label) {
	const parsed = Number.parseInt(rawValue, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}

	return parsed;
}

function parseEvenInteger(rawValue, label) {
	const parsed = parsePositiveInteger(rawValue, label);
	if (parsed % 2 !== 0) {
		throw new Error(`${label} must be even`);
	}

	return parsed;
}

function parseExportPipeline(rawValue) {
	if (rawValue === null || rawValue === "") {
		return null;
	}

	if (rawValue === "legacy" || rawValue === "modern") {
		return rawValue;
	}

	throw new Error("RECORDLY_BENCH_EXPORT_PIPELINE must be 'legacy' or 'modern'");
}

function parseExportBackend(rawValue) {
	if (rawValue === null || rawValue === "") {
		return null;
	}

	if (rawValue === "auto" || rawValue === "webcodecs" || rawValue === "breeze") {
		return rawValue;
	}

	throw new Error("RECORDLY_BENCH_EXPORT_BACKEND must be 'auto', 'webcodecs', or 'breeze'");
}

function parseExportBackendList(rawValue) {
	if (rawValue === null || rawValue === "") {
		return null;
	}

	if (rawValue === "all") {
		return [...MODERN_BACKEND_SWEEP];
	}

	const values = rawValue
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.map((value) => parseExportBackend(value))
		.filter((value) => value !== null);

	if (values.length === 0) {
		throw new Error(
			"RECORDLY_BENCH_EXPORT_BACKENDS must include at least one of: auto, webcodecs, breeze",
		);
	}

	return [...new Set(values)];
}

function parseBenchmarkVariantList(rawValue) {
	if (rawValue === null || rawValue === "") {
		return null;
	}

	const values = rawValue
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);

	if (values.length === 0) {
		throw new Error(
			"RECORDLY_BENCH_EXPORT_VARIANTS must include at least one of: adaptive, baseline, tuned",
		);
	}

	for (const value of values) {
		if (!(value in VARIANT_PRESETS)) {
			throw new Error(
				"RECORDLY_BENCH_EXPORT_VARIANTS must include only: adaptive, baseline, tuned",
			);
		}
	}

	return [...new Set(values)];
}

function parseExportEncodingMode(rawValue) {
	if (rawValue === null || rawValue === "") {
		return null;
	}

	if (rawValue === "fast" || rawValue === "balanced" || rawValue === "quality") {
		return rawValue;
	}

	throw new Error("RECORDLY_BENCH_EXPORT_ENCODING_MODE must be 'fast', 'balanced', or 'quality'");
}

function parseExportQuality(rawValue) {
	if (
		rawValue === "medium" ||
		rawValue === "good" ||
		rawValue === "high" ||
		rawValue === "source"
	) {
		return rawValue;
	}

	throw new Error("RECORDLY_BENCH_EXPORT_QUALITY must be 'medium', 'good', 'high', or 'source'");
}

function parseExportShadowIntensity(rawValue) {
	if (rawValue === null || rawValue === "") {
		return null;
	}

	const parsed = Number.parseFloat(rawValue);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error("RECORDLY_BENCH_EXPORT_SHADOW_INTENSITY must be a non-negative number");
	}

	return parsed;
}

function parseExportWebcamSize(rawValue) {
	if (rawValue === null || rawValue === "") {
		return null;
	}

	const parsed = Number.parseFloat(rawValue);
	if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
		throw new Error("RECORDLY_BENCH_EXPORT_WEBCAM_SIZE must be a number between 0 and 100");
	}

	return parsed;
}

function summarizeSmokeProgress(progressSamples) {
	if (!Array.isArray(progressSamples) || progressSamples.length === 0) {
		return null;
	}

	const extractingSamples = progressSamples.filter(
		(sample) =>
			sample?.phase === "extracting" &&
			typeof sample?.currentFrame === "number" &&
			sample.currentFrame > 1,
	);
	const fpsSource = extractingSamples.length > 0 ? extractingSamples : progressSamples;
	const renderFpsSamples = fpsSource
		.map((sample) => sample?.renderFps)
		.filter((value) => typeof value === "number" && Number.isFinite(value));
	const firstSample = progressSamples[0] ?? null;
	const lastSample = progressSamples.at(-1) ?? null;
	const firstExtractingSample = extractingSamples[0] ?? null;
	const lastExtractingSample = extractingSamples.at(-1) ?? null;

	return {
		samples: progressSamples.length,
		extractingSamples: extractingSamples.length,
		firstElapsedMs: typeof firstSample?.elapsedMs === "number" ? firstSample.elapsedMs : null,
		lastElapsedMs: typeof lastSample?.elapsedMs === "number" ? lastSample.elapsedMs : null,
		firstExtractingElapsedMs:
			typeof firstExtractingSample?.elapsedMs === "number"
				? firstExtractingSample.elapsedMs
				: null,
		lastExtractingElapsedMs:
			typeof lastExtractingSample?.elapsedMs === "number"
				? lastExtractingSample.elapsedMs
				: null,
		firstRenderFps: renderFpsSamples[0] ?? null,
		lastRenderFps: renderFpsSamples.at(-1) ?? null,
		minRenderFps: renderFpsSamples.length > 0 ? Math.min(...renderFpsSamples) : null,
		maxRenderFps: renderFpsSamples.length > 0 ? Math.max(...renderFpsSamples) : null,
	};
}

async function ensureBuildArtifacts() {
	await Promise.any(mainEntryCandidates.map((candidate) => fs.access(candidate))).catch(() => {
		throw new Error(
			`Missing Electron main build output. Tried: ${mainEntryCandidates.join(", ")}`,
		);
	});
	await fs.access(rendererEntry);
}

async function createFixtureVideo(
	ffmpegPath,
	targetPath,
	{
		fixtureWidth = width,
		fixtureHeight = height,
		includeAudio = true,
		videoFilter = `testsrc2=size=${fixtureWidth}x${fixtureHeight}:rate=${frameRate}`,
	} = {},
) {
	const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", videoFilter];

	if (includeAudio) {
		args.push(
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=880:sample_rate=48000",
			"-c:a",
			"aac",
			"-b:a",
			"128k",
		);
	} else {
		args.push("-an");
	}

	args.push(
		"-t",
		String(durationSeconds),
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		targetPath,
	);

	await execFileAsync(ffmpegPath, args, {
		timeout: 60_000,
		maxBuffer: 20 * 1024 * 1024,
	});
}

function parseDurationSeconds(ffmpegOutput) {
	const match = ffmpegOutput.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
	if (!match) {
		return null;
	}

	return (
		Number.parseInt(match[1], 10) * 3600 +
		Number.parseInt(match[2], 10) * 60 +
		Number.parseFloat(match[3])
	);
}

async function inspectOutput(ffmpegPath, targetPath) {
	try {
		const { stderr } = await execFileAsync(
			ffmpegPath,
			["-hide_banner", "-i", targetPath, "-f", "null", "-"],
			{
				timeout: 30_000,
				maxBuffer: 20 * 1024 * 1024,
			},
		);
		return parseDurationSeconds(stderr);
	} catch (error) {
		return parseDurationSeconds(String(error?.stderr ?? ""));
	}
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

function buildBenchmarkRequests() {
	if (exportBackendList) {
		return exportBackendList.map((backend) => ({
			pipeline: exportPipeline,
			backend,
			label: backend,
			slug: backend,
		}));
	}

	if (exportBackend) {
		return [
			{
				pipeline: exportPipeline,
				backend: exportBackend,
				label: exportBackend,
				slug: exportBackend,
			},
		];
	}

	if (exportPipeline === "modern") {
		return MODERN_BACKEND_SWEEP.map((backend) => ({
			pipeline: exportPipeline,
			backend,
			label: backend,
			slug: backend,
		}));
	}

	return [
		{
			pipeline: exportPipeline,
			backend: null,
			label: "default",
			slug: "default",
		},
	];
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

	console.log(`[benchmark-export-queues] ${title}`);
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

function formatMs(value) {
	return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)} ms` : "-";
}

function formatDeltaMs(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "-";
	}

	const roundedValue = Math.round(value);
	return `${roundedValue > 0 ? "+" : ""}${roundedValue} ms`;
}

function formatPercent(value) {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";
}

function formatSeconds(value) {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)} s` : "-";
}

function formatMegabytes(value) {
	return typeof value === "number" && Number.isFinite(value)
		? `${(value / (1024 * 1024)).toFixed(2)} MB`
		: "-";
}

function formatBoolean(value) {
	return value ? "Yes" : "No";
}

function calculateDelta(referenceValue, nextValue) {
	if (
		typeof referenceValue !== "number" ||
		!Number.isFinite(referenceValue) ||
		typeof nextValue !== "number" ||
		!Number.isFinite(nextValue)
	) {
		return { deltaMs: null, deltaPercent: null };
	}

	return {
		deltaMs: nextValue - referenceValue,
		deltaPercent:
			referenceValue > 0 ? ((nextValue - referenceValue) / referenceValue) * 100 : null,
	};
}

function buildRequestedConfigRows(benchmarkRequests) {
	const rows = [
		{ key: "Width", value: width },
		{ key: "Height", value: height },
		{ key: "Frame rate", value: `${frameRate} FPS` },
		{ key: "Duration", value: `${durationSeconds} s` },
		{ key: "Timeout", value: formatMs(timeoutMs) },
		{ key: "Runs per variant", value: runsPerVariant },
		{ key: "Pipeline", value: exportPipeline ?? "default" },
		{ key: "Requested backends", value: benchmarkRequests.map((request) => request.label) },
		{ key: "Backend sweep", value: formatBoolean(benchmarkRequests.length > 1) },
		{ key: "Encoding mode", value: exportEncodingMode ?? "default" },
		{ key: "Quality", value: exportQuality },
		{ key: "Shadow intensity", value: exportShadowIntensity ?? "default" },
		{ key: "Source-only scene", value: formatBoolean(useSourceOnlyScene) },
		{ key: "Webcam enabled", value: formatBoolean(useWebcamOverlay) },
		{ key: "Experimental native override", value: formatBoolean(useNativeExport) },
	];

	if (useWebcamOverlay) {
		rows.push(
			{ key: "Webcam width", value: webcamWidth },
			{ key: "Webcam height", value: webcamHeight },
			{ key: "Webcam shadow", value: webcamShadowIntensity ?? "default" },
			{ key: "Webcam size", value: webcamSize ?? "default" },
		);
	}

	return rows;
}

function printRequestedConfigTable(benchmarkRequests) {
	printTable(
		"Requested config",
		[
			{ header: "Setting", getValue: (row) => row.key },
			{ header: "Value", getValue: (row) => row.value },
		],
		buildRequestedConfigRows(benchmarkRequests),
	);
}

function buildTimingTableRows(benchmarkResults) {
	return benchmarkResults.flatMap((result) =>
		result.summaries.map((summary) => ({
			backend: result.request.backend ?? "default",
			pipeline: result.request.pipeline ?? "default",
			variant: summary.variant.name,
			averageElapsedMs: summary.averageElapsedMs,
			medianElapsedMs: summary.medianElapsedMs,
			averageSmokeElapsedMs: summary.averageSmokeElapsedMs,
			minElapsedMs: summary.minElapsedMs,
			maxElapsedMs: summary.maxElapsedMs,
			averageOutputDurationSeconds: summary.averageOutputDurationSeconds,
			averageSizeBytes: summary.averageSizeBytes,
			webcamEnabled: summary.webcamEnabled,
		})),
	);
}

function printTimingSummaryTable(benchmarkResults) {
	printTable(
		"Timing summary",
		[
			{ header: "Pipeline", getValue: (row) => row.pipeline },
			{ header: "Backend", getValue: (row) => row.backend },
			{ header: "Variant", getValue: (row) => row.variant },
			{ header: "Avg total", getValue: (row) => formatMs(row.averageElapsedMs) },
			{ header: "Median total", getValue: (row) => formatMs(row.medianElapsedMs) },
			{ header: "Avg export", getValue: (row) => formatMs(row.averageSmokeElapsedMs) },
			{ header: "Min", getValue: (row) => formatMs(row.minElapsedMs) },
			{ header: "Max", getValue: (row) => formatMs(row.maxElapsedMs) },
			{
				header: "Avg output",
				getValue: (row) => formatSeconds(row.averageOutputDurationSeconds),
			},
			{ header: "Avg size", getValue: (row) => formatMegabytes(row.averageSizeBytes) },
			{ header: "Webcam", getValue: (row) => formatBoolean(row.webcamEnabled) },
		],
		buildTimingTableRows(benchmarkResults),
	);
}

function buildBackendDetailTableRows(benchmarkResults) {
	return benchmarkResults.flatMap((result) =>
		result.summaries.map((summary) => ({
			backend: result.request.backend ?? "default",
			pipeline: result.request.pipeline ?? "default",
			variant: summary.variant.name,
			encodeQueue: summary.variant.maxEncodeQueue,
			decodeQueue: summary.variant.maxDecodeQueue,
			pendingFrames: summary.variant.maxPendingFrames,
			observedRenderBackends: summary.observedRenderBackends,
			observedEncodeBackends: summary.observedEncodeBackends,
			observedEncoders: summary.observedEncoders,
		})),
	);
}

function printBackendDetailTable(benchmarkResults) {
	printTable(
		"Observed backends",
		[
			{ header: "Pipeline", getValue: (row) => row.pipeline },
			{ header: "Backend", getValue: (row) => row.backend },
			{ header: "Variant", getValue: (row) => row.variant },
			{ header: "Encode Q", getValue: (row) => row.encodeQueue },
			{ header: "Decode Q", getValue: (row) => row.decodeQueue },
			{ header: "Pending", getValue: (row) => row.pendingFrames },
			{ header: "Render", getValue: (row) => row.observedRenderBackends },
			{ header: "Encode", getValue: (row) => row.observedEncodeBackends },
			{ header: "Encoder", getValue: (row) => row.observedEncoders },
		],
		buildBackendDetailTableRows(benchmarkResults),
	);
}

function buildDeltaTableRows(benchmarkResults) {
	return benchmarkResults
		.map((result) => {
			const baseline = result.summaries.find(
				(summary) => summary.variant.name === "baseline",
			);
			const tuned = result.summaries.find((summary) => summary.variant.name === "tuned");
			if (!baseline || !tuned) {
				return null;
			}

			const averageDelta = calculateDelta(baseline.averageElapsedMs, tuned.averageElapsedMs);
			const medianDelta = calculateDelta(baseline.medianElapsedMs, tuned.medianElapsedMs);
			const exportDelta = calculateDelta(
				baseline.averageSmokeElapsedMs,
				tuned.averageSmokeElapsedMs,
			);

			return {
				pipeline: result.request.pipeline ?? "default",
				backend: result.request.backend ?? "default",
				averageDeltaMs: averageDelta.deltaMs,
				averageDeltaPercent: averageDelta.deltaPercent,
				medianDeltaMs: medianDelta.deltaMs,
				medianDeltaPercent: medianDelta.deltaPercent,
				exportDeltaMs: exportDelta.deltaMs,
				exportDeltaPercent: exportDelta.deltaPercent,
			};
		})
		.filter(Boolean);
}

function printDeltaTable(benchmarkResults) {
	printTable(
		"Tuned vs baseline",
		[
			{ header: "Pipeline", getValue: (row) => row.pipeline },
			{ header: "Backend", getValue: (row) => row.backend },
			{
				header: "Avg delta",
				getValue: (row) =>
					`${formatDeltaMs(row.averageDeltaMs)} (${formatPercent(row.averageDeltaPercent)})`,
			},
			{
				header: "Median delta",
				getValue: (row) =>
					`${formatDeltaMs(row.medianDeltaMs)} (${formatPercent(row.medianDeltaPercent)})`,
			},
			{
				header: "Export delta",
				getValue: (row) =>
					`${formatDeltaMs(row.exportDeltaMs)} (${formatPercent(row.exportDeltaPercent)})`,
			},
		],
		buildDeltaTableRows(benchmarkResults),
	);
}

async function runVariant(
	ffmpegPath,
	inputPath,
	webcamInputPath,
	benchmarkRequest,
	variant,
	runIndex,
) {
	const outputPath = path.join(
		path.dirname(inputPath),
		`${benchmarkRequest.slug}-${variant.name}-${runIndex + 1}-${Date.now()}.mp4`,
	);
	const startedAt = performance.now();
	const runLabel = `${benchmarkRequest.label}/${variant.name}#${runIndex + 1}`;
	const child = spawn(electron, [repoRoot], {
		cwd: repoRoot,
		env: {
			...process.env,
			RECORDLY_SMOKE_EXPORT: "1",
			RECORDLY_SMOKE_EXPORT_INPUT: inputPath,
			RECORDLY_SMOKE_EXPORT_OUTPUT: outputPath,
			...(useNativeExport ? { RECORDLY_SMOKE_EXPORT_USE_NATIVE: "1" } : {}),
			...(useSourceOnlyScene ? { RECORDLY_SMOKE_EXPORT_SOURCE_ONLY: "1" } : {}),
			...(exportEncodingMode
				? { RECORDLY_SMOKE_EXPORT_ENCODING_MODE: exportEncodingMode }
				: {}),
			RECORDLY_SMOKE_EXPORT_QUALITY: exportQuality,
			RECORDLY_SMOKE_EXPORT_FPS: String(frameRate),
			...(exportShadowIntensity !== null
				? { RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY: String(exportShadowIntensity) }
				: {}),
			...(webcamInputPath ? { RECORDLY_SMOKE_EXPORT_WEBCAM_INPUT: webcamInputPath } : {}),
			...(webcamShadowIntensity !== null
				? { RECORDLY_SMOKE_EXPORT_WEBCAM_SHADOW: String(webcamShadowIntensity) }
				: {}),
			...(webcamSize !== null
				? { RECORDLY_SMOKE_EXPORT_WEBCAM_SIZE: String(webcamSize) }
				: {}),
			...(benchmarkRequest.pipeline
				? { RECORDLY_SMOKE_EXPORT_PIPELINE: benchmarkRequest.pipeline }
				: {}),
			...(benchmarkRequest.backend
				? { RECORDLY_SMOKE_EXPORT_BACKEND: benchmarkRequest.backend }
				: {}),
			...(typeof variant.maxEncodeQueue === "number"
				? { RECORDLY_SMOKE_EXPORT_MAX_ENCODE_QUEUE: String(variant.maxEncodeQueue) }
				: {}),
			...(typeof variant.maxDecodeQueue === "number"
				? { RECORDLY_SMOKE_EXPORT_MAX_DECODE_QUEUE: String(variant.maxDecodeQueue) }
				: {}),
			...(typeof variant.maxPendingFrames === "number"
				? { RECORDLY_SMOKE_EXPORT_MAX_PENDING_FRAMES: String(variant.maxPendingFrames) }
				: {}),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	let combinedOutput = "";
	child.stdout.on("data", (chunk) => {
		const text = chunk.toString();
		combinedOutput += text;
		process.stdout.write(`[${runLabel}] ${text}`);
	});
	child.stderr.on("data", (chunk) => {
		const text = chunk.toString();
		combinedOutput += text;
		process.stderr.write(`[${runLabel}] ${text}`);
	});

	const timeout = setTimeout(() => {
		child.kill("SIGKILL");
	}, timeoutMs);

	const [exitCode, signal] = await once(child, "close");
	clearTimeout(timeout);

	if (exitCode !== 0) {
		const signalText = signal ? ` (signal ${signal})` : "";
		throw new Error(
			`${variant.name} run ${runIndex + 1} failed with code ${exitCode ?? "unknown"}${signalText}\n${combinedOutput.trim()}`,
		);
	}

	const smokeExportReport = await readSmokeExportReport(outputPath);
	let outputStats;
	try {
		outputStats = await fs.stat(outputPath);
	} catch (error) {
		const reportSuffix = smokeExportReport
			? `\n${JSON.stringify(smokeExportReport.report)}`
			: "";
		throw new Error(
			`${variant.name} run ${runIndex + 1} did not produce an output file: ${error instanceof Error ? error.message : String(error)}${reportSuffix}`,
		);
	}
	if (outputStats.size <= 0) {
		const reportSuffix = smokeExportReport
			? `\n${JSON.stringify(smokeExportReport.report)}`
			: "";
		throw new Error(
			`${variant.name} run ${runIndex + 1} produced an empty output file${reportSuffix}`,
		);
	}

	const elapsedMs = Math.round(performance.now() - startedAt);
	const outputDuration = await inspectOutput(ffmpegPath, outputPath);

	return {
		elapsedMs,
		outputPath,
		sizeBytes: outputStats.size,
		outputDuration,
		webcamEnabled: !!webcamInputPath,
		smokeExportReport: smokeExportReport?.report ?? null,
		smokeProgressSummary: summarizeSmokeProgress(smokeExportReport?.report?.progressSamples),
	};
}

async function runBenchmarkRequest(ffmpegPath, inputPath, webcamInputPath, benchmarkRequest) {
	const summaries = [];
	for (const variant of variants) {
		const runs = [];
		for (let index = 0; index < runsPerVariant; index += 1) {
			console.log(
				`[benchmark-export-queues] Running ${benchmarkRequest.label}/${variant.name} (${index + 1}/${runsPerVariant}) with encode=${variant.maxEncodeQueue ?? "auto"} decode=${variant.maxDecodeQueue ?? "auto"} pending=${variant.maxPendingFrames ?? "auto"}`,
			);
			runs.push(
				await runVariant(
					ffmpegPath,
					inputPath,
					webcamInputPath,
					benchmarkRequest,
					variant,
					index,
				),
			);
		}

		const runSummary = summarizeVariantRuns(runs);
		summaries.push({
			variant,
			runs,
			...runSummary,
			webcamEnabled: useWebcamOverlay,
		});
	}

	return {
		request: benchmarkRequest,
		summaries,
	};
}

function average(values) {
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

function summarizeVariantRuns(runs) {
	const elapsedValues = runs.map((run) => run.elapsedMs);
	const sizeValues = runs.map((run) => run.sizeBytes);
	const outputDurationValues = runs
		.map((run) => run.outputDuration)
		.filter((value) => typeof value === "number" && Number.isFinite(value));
	const smokeElapsedValues = runs
		.map((run) => run.smokeExportReport?.elapsedMs)
		.filter((value) => typeof value === "number" && Number.isFinite(value));

	return {
		averageElapsedMs: Math.round(average(elapsedValues)),
		medianElapsedMs: Math.round(median(elapsedValues)),
		minElapsedMs: Math.min(...elapsedValues),
		maxElapsedMs: Math.max(...elapsedValues),
		averageSizeBytes: Math.round(average(sizeValues)),
		averageOutputDurationSeconds:
			outputDurationValues.length > 0 ? average(outputDurationValues) : null,
		averageSmokeElapsedMs:
			smokeElapsedValues.length > 0 ? Math.round(average(smokeElapsedValues)) : null,
		observedRenderBackends: collectUniqueStrings(
			runs.map((run) => run.smokeExportReport?.metrics?.renderBackend),
		),
		observedEncodeBackends: collectUniqueStrings(
			runs.map((run) => run.smokeExportReport?.metrics?.encodeBackend),
		),
		observedEncoders: collectUniqueStrings(
			runs.map((run) => run.smokeExportReport?.metrics?.encoderName),
		),
	};
}

async function main() {
	if (typeof ffmpegStatic !== "string" || ffmpegStatic.length === 0) {
		throw new Error("ffmpeg-static is unavailable for this platform");
	}

	if (typeof electron !== "string" || electron.length === 0) {
		throw new Error("The Electron binary is unavailable in this workspace");
	}

	await ensureBuildArtifacts();
	const benchmarkRequests = buildBenchmarkRequests();

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-queue-bench-"));
	const inputPath = path.join(tempDir, "input.mp4");
	const webcamInputPath = useWebcamOverlay ? path.join(tempDir, "webcam.mp4") : null;

	try {
		console.log("[benchmark-export-queues] Config");
		console.log(
			JSON.stringify({
				width,
				height,
				frameRate,
				durationSeconds,
				timeoutMs,
				runsPerVariant,
				requestedPipeline: exportPipeline,
				requestedBackend: exportBackend,
				requestedBackends: benchmarkRequests.map((request) => request.label),
				backendSweepEnabled: benchmarkRequests.length > 1,
				requestedEncodingMode: exportEncodingMode,
				requestedQuality: exportQuality,
				requestedShadowIntensity: exportShadowIntensity,
				webcamEnabled: useWebcamOverlay,
				requestedWebcamShadowIntensity: webcamShadowIntensity,
				requestedWebcamSize: webcamSize,
			}),
		);
		printRequestedConfigTable(benchmarkRequests);

		console.log(`[benchmark-export-queues] Generating fixture video: ${inputPath}`);
		await createFixtureVideo(ffmpegStatic, inputPath);
		if (webcamInputPath) {
			console.log(
				`[benchmark-export-queues] Generating webcam fixture video: ${webcamInputPath}`,
			);
			await createFixtureVideo(ffmpegStatic, webcamInputPath, {
				fixtureWidth: webcamWidth,
				fixtureHeight: webcamHeight,
				includeAudio: false,
				videoFilter: `testsrc=size=${webcamWidth}x${webcamHeight}:rate=${frameRate}`,
			});
		}

		const benchmarkResults = [];
		for (const benchmarkRequest of benchmarkRequests) {
			benchmarkResults.push(
				await runBenchmarkRequest(
					ffmpegStatic,
					inputPath,
					webcamInputPath,
					benchmarkRequest,
				),
			);
		}

		console.log("[benchmark-export-queues] Summary");
		for (const result of benchmarkResults) {
			for (const summary of result.summaries) {
				console.log(
					JSON.stringify({
						requestedPipeline: result.request.pipeline,
						requestedBackend: result.request.backend,
						name: summary.variant.name,
						webcamEnabled: useWebcamOverlay,
						webcamShadowIntensity,
						webcamSize,
						maxEncodeQueue: summary.variant.maxEncodeQueue,
						maxDecodeQueue: summary.variant.maxDecodeQueue,
						maxPendingFrames: summary.variant.maxPendingFrames,
						averageElapsedMs: summary.averageElapsedMs,
						medianElapsedMs: summary.medianElapsedMs,
						minElapsedMs: summary.minElapsedMs,
						maxElapsedMs: summary.maxElapsedMs,
						averageSizeBytes: summary.averageSizeBytes,
						averageOutputDurationSeconds: summary.averageOutputDurationSeconds,
						averageSmokeElapsedMs: summary.averageSmokeElapsedMs,
						observedRenderBackends: summary.observedRenderBackends,
						observedEncodeBackends: summary.observedEncodeBackends,
						observedEncoders: summary.observedEncoders,
						runs: summary.runs.map((run) => ({
							elapsedMs: run.elapsedMs,
							sizeBytes: run.sizeBytes,
							outputDuration: run.outputDuration,
							smokeExportReport: run.smokeExportReport,
							smokeProgressSummary: run.smokeProgressSummary,
						})),
					}),
				);
			}
		}
		printTimingSummaryTable(benchmarkResults);
		printBackendDetailTable(benchmarkResults);
		printDeltaTable(benchmarkResults);

		for (const result of benchmarkResults) {
			if (result.summaries.length < 2) {
				continue;
			}

			const baseline = result.summaries[0];
			const tuned = result.summaries[1];
			const { deltaMs, deltaPercent: percent } = calculateDelta(
				baseline.averageElapsedMs,
				tuned.averageElapsedMs,
			);
			const { deltaMs: medianDeltaMs, deltaPercent: medianPercent } = calculateDelta(
				baseline.medianElapsedMs,
				tuned.medianElapsedMs,
			);
			const backendLabel = result.request.backend ?? "default";
			console.log(
				`[benchmark-export-queues] ${backendLabel} tuned vs baseline: ${deltaMs}ms (${typeof percent === "number" ? percent.toFixed(1) : "-"}%)`,
			);
			console.log(
				`[benchmark-export-queues] ${backendLabel} tuned vs baseline (median): ${medianDeltaMs}ms (${typeof medianPercent === "number" ? medianPercent.toFixed(1) : "-"}%)`,
			);
		}
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(
		`[benchmark-export-queues] ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
});
