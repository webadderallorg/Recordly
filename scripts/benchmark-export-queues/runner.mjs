import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";

import { inspectOutput, readSmokeExportReport } from "./fixtures.mjs";

function collectUniqueStrings(values) {
	return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
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

async function runVariant(electronPath, ffmpegPath, inputPath, webcamInputPath, benchmarkRequest, variant, runIndex, config) {
	const outputPath = path.join(
		path.dirname(inputPath),
		`${benchmarkRequest.slug}-${variant.name}-${runIndex + 1}-${Date.now()}.mp4`,
	);
	const startedAt = performance.now();
	const runLabel = `${benchmarkRequest.label}/${variant.name}#${runIndex + 1}`;
	const child = spawn(electronPath, [config.repoRoot], {
		cwd: config.repoRoot,
		env: {
			...process.env,
			RECORDLY_SMOKE_EXPORT: "1",
			RECORDLY_SMOKE_EXPORT_INPUT: inputPath,
			RECORDLY_SMOKE_EXPORT_OUTPUT: outputPath,
			...(config.useNativeExport ? { RECORDLY_SMOKE_EXPORT_USE_NATIVE: "1" } : {}),
			...(config.exportEncodingMode
				? { RECORDLY_SMOKE_EXPORT_ENCODING_MODE: config.exportEncodingMode }
				: {}),
			...(config.exportShadowIntensity !== null
				? { RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY: String(config.exportShadowIntensity) }
				: {}),
			...(webcamInputPath ? { RECORDLY_SMOKE_EXPORT_WEBCAM_INPUT: webcamInputPath } : {}),
			...(config.webcamShadowIntensity !== null
				? { RECORDLY_SMOKE_EXPORT_WEBCAM_SHADOW: String(config.webcamShadowIntensity) }
				: {}),
			...(config.webcamSize !== null
				? { RECORDLY_SMOKE_EXPORT_WEBCAM_SIZE: String(config.webcamSize) }
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
	}, config.timeoutMs);

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
		const reportSuffix = smokeExportReport ? `\n${JSON.stringify(smokeExportReport.report)}` : "";
		throw new Error(
			`${variant.name} run ${runIndex + 1} did not produce an output file: ${error instanceof Error ? error.message : String(error)}${reportSuffix}`,
		);
	}
	if (outputStats.size <= 0) {
		const reportSuffix = smokeExportReport ? `\n${JSON.stringify(smokeExportReport.report)}` : "";
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

export async function runBenchmarkRequest(electronPath, ffmpegPath, inputPath, webcamInputPath, benchmarkRequest, config) {
	const summaries = [];
	for (const variant of config.variants) {
		const runs = [];
		for (let index = 0; index < config.runsPerVariant; index += 1) {
			console.log(
				`[benchmark-export-queues] Running ${benchmarkRequest.label}/${variant.name} (${index + 1}/${config.runsPerVariant}) with encode=${variant.maxEncodeQueue ?? "auto"} decode=${variant.maxDecodeQueue ?? "auto"} pending=${variant.maxPendingFrames ?? "auto"}`,
			);
			runs.push(
				await runVariant(
					electronPath,
					ffmpegPath,
					inputPath,
					webcamInputPath,
					benchmarkRequest,
					variant,
					index,
					config,
				),
			);
		}

		const runSummary = summarizeVariantRuns(runs);
		summaries.push({
			variant,
			runs,
			...runSummary,
			webcamEnabled: config.useWebcamOverlay,
		});
	}

	return {
		request: benchmarkRequest,
		summaries,
	};
}