import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import electron from "electron";
import ffmpegStatic from "ffmpeg-static";

import { buildBenchmarkRequests, createBenchmarkConfig } from "./benchmark-export-queues/config.mjs";
import { createFixtureVideo, ensureBuildArtifacts } from "./benchmark-export-queues/fixtures.mjs";
import {
	calculateDelta,
	printBackendDetailTable,
	printDeltaTable,
	printRequestedConfigTable,
	printTimingSummaryTable,
} from "./benchmark-export-queues/reporting.mjs";
import { runBenchmarkRequest } from "./benchmark-export-queues/runner.mjs";

function logBenchmarkConfig(config, benchmarkRequests) {
	console.log("[benchmark-export-queues] Config");
	console.log(
		JSON.stringify({
			width: config.width,
			height: config.height,
			frameRate: config.frameRate,
			durationSeconds: config.durationSeconds,
			timeoutMs: config.timeoutMs,
			runsPerVariant: config.runsPerVariant,
			requestedPipeline: config.exportPipeline,
			requestedBackend: config.exportBackend,
			requestedBackends: benchmarkRequests.map((request) => request.label),
			backendSweepEnabled: benchmarkRequests.length > 1,
			requestedEncodingMode: config.exportEncodingMode,
			requestedShadowIntensity: config.exportShadowIntensity,
			webcamEnabled: config.useWebcamOverlay,
			requestedWebcamShadowIntensity: config.webcamShadowIntensity,
			requestedWebcamSize: config.webcamSize,
		}),
	);
	printRequestedConfigTable(config, benchmarkRequests);
}

function printJsonSummary(benchmarkResults, config) {
	console.log("[benchmark-export-queues] Summary");
	for (const result of benchmarkResults) {
		for (const summary of result.summaries) {
			console.log(
				JSON.stringify({
					requestedPipeline: result.request.pipeline,
					requestedBackend: result.request.backend,
					name: summary.variant.name,
					webcamEnabled: config.useWebcamOverlay,
					webcamShadowIntensity: config.webcamShadowIntensity,
					webcamSize: config.webcamSize,
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
}

function printVariantComparisons(benchmarkResults) {
	for (const result of benchmarkResults) {
		if (result.summaries.length < 2) {
			continue;
		}

		const baseline = result.summaries[0];
		const tuned = result.summaries[1];
		const { deltaMs, deltaPercent } = calculateDelta(
			baseline.averageElapsedMs,
			tuned.averageElapsedMs,
		);
		const { deltaMs: medianDeltaMs, deltaPercent: medianPercent } = calculateDelta(
			baseline.medianElapsedMs,
			tuned.medianElapsedMs,
		);
		const backendLabel = result.request.backend ?? "default";
		console.log(
			`[benchmark-export-queues] ${backendLabel} tuned vs baseline: ${deltaMs}ms (${typeof deltaPercent === "number" ? deltaPercent.toFixed(1) : "-"}%)`,
		);
		console.log(
			`[benchmark-export-queues] ${backendLabel} tuned vs baseline (median): ${medianDeltaMs}ms (${typeof medianPercent === "number" ? medianPercent.toFixed(1) : "-"}%)`,
		);
	}
}

async function main() {
	if (typeof ffmpegStatic !== "string" || ffmpegStatic.length === 0) {
		throw new Error("ffmpeg-static is unavailable for this platform");
	}

	if (typeof electron !== "string" || electron.length === 0) {
		throw new Error("The Electron binary is unavailable in this workspace");
	}

	const config = createBenchmarkConfig();
	await ensureBuildArtifacts(config);
	const benchmarkRequests = buildBenchmarkRequests(config);

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-export-queue-bench-"));
	const inputPath = path.join(tempDir, "input.mp4");
	const webcamInputPath = config.useWebcamOverlay ? path.join(tempDir, "webcam.mp4") : null;

	try {
		logBenchmarkConfig(config, benchmarkRequests);

		console.log(`[benchmark-export-queues] Generating fixture video: ${inputPath}`);
		await createFixtureVideo(ffmpegStatic, inputPath, {
			durationSeconds: config.durationSeconds,
			frameRate: config.frameRate,
			fixtureWidth: config.width,
			fixtureHeight: config.height,
		});
		if (webcamInputPath) {
			console.log(
				`[benchmark-export-queues] Generating webcam fixture video: ${webcamInputPath}`,
			);
			await createFixtureVideo(ffmpegStatic, webcamInputPath, {
				durationSeconds: config.durationSeconds,
				frameRate: config.frameRate,
				fixtureWidth: config.webcamWidth,
				fixtureHeight: config.webcamHeight,
				includeAudio: false,
				videoFilter: `testsrc=size=${config.webcamWidth}x${config.webcamHeight}:rate=${config.frameRate}`,
			});
		}

		const benchmarkResults = [];
		for (const benchmarkRequest of benchmarkRequests) {
			benchmarkResults.push(
				await runBenchmarkRequest(
					electron,
					ffmpegStatic,
					inputPath,
					webcamInputPath,
					benchmarkRequest,
					config,
				),
			);
		}

		printJsonSummary(benchmarkResults, config);
		printTimingSummaryTable(benchmarkResults);
		printBackendDetailTable(benchmarkResults);
		printDeltaTable(benchmarkResults);
		printVariantComparisons(benchmarkResults);
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