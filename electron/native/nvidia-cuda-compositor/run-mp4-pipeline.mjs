import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = resolve(scriptDir, "..", "..", "..");
const unpackAsarPath = (candidate) => candidate.replace(/\.asar([/\\])/, ".asar.unpacked$1");

function resolvePackageBinary(moduleName) {
	try {
		const moduleExports = require(moduleName);
		const candidate =
			typeof moduleExports === "string"
				? moduleExports
				: typeof moduleExports?.path === "string"
					? moduleExports.path
					: typeof moduleExports?.default === "string"
						? moduleExports.default
						: typeof moduleExports?.default?.path === "string"
							? moduleExports.default.path
							: "";
		if (!candidate) {
			return "";
		}

		const unpacked = unpackAsarPath(candidate);
		return existsSync(unpacked) ? unpacked : candidate;
	} catch {
		return "";
	}
}

function resolveToolCommand(envNames, moduleName, fallbackName) {
	for (const envName of envNames) {
		const configured = process.env[envName];
		if (configured) {
			return configured;
		}
	}

	return resolvePackageBinary(moduleName) || fallbackName;
}

const ffmpegCommand = resolveToolCommand(["RECORDLY_FFMPEG_EXE"], "ffmpeg-static", "ffmpeg");
const ffprobeCommand = resolveToolCommand(["RECORDLY_FFPROBE_EXE"], "ffprobe-static", "ffprobe");

const cursorTypes = [
	"arrow",
	"text",
	"pointer",
	"crosshair",
	"open-hand",
	"closed-hand",
	"resize-ew",
	"resize-ns",
	"not-allowed",
];
const cursorTypeIndexes = new Map(cursorTypes.map((type, index) => [type, index]));

function fail(message) {
	throw new Error(message);
}

function getArg(name, fallback = "") {
	const index = process.argv.indexOf(name);
	if (index === -1) {
		return fallback;
	}
	if (index + 1 >= process.argv.length) {
		fail(`Missing value for ${name}`);
	}
	return process.argv[index + 1];
}

function getNumberArg(name, fallback) {
	const value = getArg(name, "");
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		fail(`Invalid ${name}: ${value}`);
	}
	return parsed;
}

function getNonNegativeNumberArg(name, fallback) {
	const value = getArg(name, "");
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		fail(`Invalid ${name}: ${value}`);
	}
	return parsed;
}

function getFiniteNumberArg(name, fallback) {
	const value = getArg(name, "");
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		fail(`Invalid ${name}: ${value}`);
	}
	return parsed;
}

function hasArg(name) {
	return process.argv.includes(name);
}

function shouldRaiseChildPriority() {
	return process.env.RECORDLY_NVIDIA_CUDA_EXPORT_HIGH_PRIORITY !== "0";
}

function raiseChildPriority(child, label) {
	if (!shouldRaiseChildPriority() || !child.pid) {
		return false;
	}

	try {
		os.setPriority(child.pid, os.constants.priority.PRIORITY_HIGH);
		return true;
	} catch (error) {
		console.warn(`[nvidia-cuda-export] Failed to raise ${label} priority: ${error}`);
		return false;
	}
}

function run(command, args, options = {}) {
	const startedAt = performance.now();
	const result = spawnSync(command, args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		windowsHide: true,
		...options,
	});
	const elapsedMs = performance.now() - startedAt;
	if (result.error) {
		fail(`${command} failed to start: ${result.error.message}`);
	}
	if (result.status !== 0) {
		const stderr = result.stderr?.trim();
		const stdout = result.stdout?.trim();
		fail(
			`${command} exited with ${result.status}` +
				(stderr ? `\nSTDERR:\n${stderr}` : "") +
				(stdout ? `\nSTDOUT:\n${stdout}` : ""),
		);
	}
	return {
		elapsedMs,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function runAsync(command, args, options = {}) {
	const startedAt = performance.now();

	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			...options,
		});
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.once("error", (error) => {
			rejectPromise(new Error(`${command} failed to start: ${error.message}`));
		});
		child.once("close", (status, signal) => {
			const elapsedMs = performance.now() - startedAt;
			if (status !== 0) {
				const suffix = signal ? ` (signal ${signal})` : "";
				rejectPromise(
					new Error(
						`${command} exited with ${status}${suffix}` +
							(stderr.trim() ? `\nSTDERR:\n${stderr.trim()}` : "") +
							(stdout.trim() ? `\nSTDOUT:\n${stdout.trim()}` : ""),
					),
				);
				return;
			}

			resolvePromise({ elapsedMs, stdout, stderr });
		});
	});
}

function parseProgressTimeSeconds(text) {
	const matches = [...text.matchAll(/\btime=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
	const latest = matches.at(-1);
	if (!latest) {
		return null;
	}

	const hours = Number(latest[1]);
	const minutes = Number(latest[2]);
	const seconds = Number(latest[3]);
	if (![hours, minutes, seconds].every(Number.isFinite)) {
		return null;
	}

	return hours * 3600 + minutes * 60 + seconds;
}

function runWithProgress(command, args, progressOptions, options = {}) {
	const startedAt = performance.now();
	const { totalDurationSec, totalFrames, startPercentage, endPercentage, stage } =
		progressOptions;

	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, {
			windowsHide: true,
			...options,
		});
		let stdout = "";
		let stderr = "";
		let lastEmittedPercentage = startPercentage;

		const maybeEmitProgress = (text) => {
			if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
				return;
			}
			const elapsedSec = parseProgressTimeSeconds(text);
			if (elapsedSec === null) {
				return;
			}
			const ratio = Math.max(0, Math.min(1, elapsedSec / totalDurationSec));
			const percentage = startPercentage + (endPercentage - startPercentage) * ratio;
			if (percentage >= lastEmittedPercentage + 0.25 || percentage >= endPercentage) {
				lastEmittedPercentage = Math.min(endPercentage, percentage);
				emitPreparationProgress(totalFrames, lastEmittedPercentage, stage);
			}
		};

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			const text = chunk.toString();
			stderr += text;
			maybeEmitProgress(text);
		});
		child.once("error", (error) => {
			rejectPromise(new Error(`${command} failed to start: ${error.message}`));
		});
		child.once("close", (status, signal) => {
			const elapsedMs = performance.now() - startedAt;
			if (status !== 0) {
				const suffix = signal ? ` (signal ${signal})` : "";
				rejectPromise(
					new Error(
						`${command} exited with ${status}${suffix}` +
							(stderr.trim() ? `\nSTDERR:\n${stderr.trim()}` : "") +
							(stdout.trim() ? `\nSTDOUT:\n${stdout.trim()}` : ""),
					),
				);
				return;
			}

			emitPreparationProgress(totalFrames, endPercentage, stage);
			resolvePromise({ elapsedMs, stdout, stderr });
		});
	});
}

function emitPreparationProgress(totalFrames, percentage, stage) {
	const progressStage = stage ?? "preparing";
	const finalizing = progressStage === "finalizing";
	const payload = {
		currentFrame: finalizing ? Math.max(1, Math.floor(totalFrames)) : 0,
		totalFrames: Math.max(1, Math.floor(totalFrames)),
		percentage: Number(Math.min(99, Math.max(0, percentage)).toFixed(2)),
		stage: progressStage,
	};
	process.stderr.write(`PROGRESS ${JSON.stringify(payload)}\n`);
}

function parseFfmpegStatsFrameCount(stderr) {
	const matches = [...String(stderr ?? "").matchAll(/frame=\s*(\d+)/g)];
	if (!matches.length) {
		return 0;
	}
	const frameCount = Number(matches[matches.length - 1][1]);
	return Number.isFinite(frameCount) && frameCount > 0 ? Math.floor(frameCount) : 0;
}

const gpuSampleFields = [
	"timestamp",
	"temperature.gpu",
	"power.draw",
	"pstate",
	"utilization.gpu",
	"utilization.decoder",
	"utilization.encoder",
	"clocks.sm",
	"clocks.mem",
];

const gpuThrottleReasonFields = [
	{ key: "gpuIdle", query: "clocks_throttle_reasons.gpu_idle" },
	{
		key: "applicationsClocksSetting",
		query: "clocks_throttle_reasons.applications_clocks_setting",
	},
	{ key: "swPowerCap", query: "clocks_throttle_reasons.sw_power_cap" },
	{ key: "hwSlowdown", query: "clocks_throttle_reasons.hw_slowdown" },
	{ key: "hwThermalSlowdown", query: "clocks_throttle_reasons.hw_thermal_slowdown" },
	{
		key: "hwPowerBrakeSlowdown",
		query: "clocks_throttle_reasons.hw_power_brake_slowdown",
	},
	{ key: "swThermalSlowdown", query: "clocks_throttle_reasons.sw_thermal_slowdown" },
	{ key: "syncBoost", query: "clocks_throttle_reasons.sync_boost" },
];

function runNvidiaSmiGpuQuery(fields) {
	const result = spawnSync(
		"nvidia-smi",
		[`--query-gpu=${fields.join(",")}`, "--format=csv,noheader,nounits"],
		{ encoding: "utf8", windowsHide: true },
	);
	if (result.status !== 0 || !result.stdout.trim()) {
		return null;
	}
	return result.stdout
		.trim()
		.split(",")
		.map((part) => part.trim());
}

function parseNvidiaSmiNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseNvidiaSmiActiveFlag(value) {
	if (/^active$/i.test(value)) {
		return true;
	}
	if (/^not active$/i.test(value)) {
		return false;
	}
	return null;
}

function sampleGpu() {
	const throttleFields = [
		"clocks_throttle_reasons.active",
		...gpuThrottleReasonFields.map((field) => field.query),
	];
	const parts =
		runNvidiaSmiGpuQuery([...gpuSampleFields, ...throttleFields]) ??
		runNvidiaSmiGpuQuery(gpuSampleFields);
	if (!parts) {
		return null;
	}

	const sample = {
		timestamp: parts[0],
		temperatureC: parseNvidiaSmiNumber(parts[1]),
		powerW: parseNvidiaSmiNumber(parts[2]),
		pstate: parts[3],
		gpuUtilizationPct: parseNvidiaSmiNumber(parts[4]),
		decoderUtilizationPct: parseNvidiaSmiNumber(parts[5]),
		encoderUtilizationPct: parseNvidiaSmiNumber(parts[6]),
		smClockMhz: parseNvidiaSmiNumber(parts[7]),
		memoryClockMhz: parseNvidiaSmiNumber(parts[8]),
	};
	if (parts.length >= gpuSampleFields.length + throttleFields.length) {
		const throttleStart = gpuSampleFields.length;
		const clockThrottleReasons = {};
		for (const [index, field] of gpuThrottleReasonFields.entries()) {
			const active = parseNvidiaSmiActiveFlag(parts[throttleStart + 1 + index]);
			if (active !== null) {
				clockThrottleReasons[field.key] = active;
			}
		}
		sample.clockThrottleReasonsActiveMask = parts[throttleStart];
		sample.clockThrottleReasons = clockThrottleReasons;
		sample.activeClockThrottleReasons = Object.entries(clockThrottleReasons)
			.filter(([, active]) => active)
			.map(([key]) => key);
	}
	return sample;
}

function summarizeGpuSamples(samples) {
	if (!samples.length) {
		return null;
	}
	const numeric = [
		"temperatureC",
		"powerW",
		"gpuUtilizationPct",
		"decoderUtilizationPct",
		"encoderUtilizationPct",
		"smClockMhz",
		"memoryClockMhz",
	];
	const summary = {
		samples: samples.length,
		pstateValues: [...new Set(samples.map((sample) => sample.pstate))],
	};
	for (const key of numeric) {
		const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
		if (!values.length) {
			continue;
		}
		summary[key] = {
			min: Math.min(...values),
			max: Math.max(...values),
			avg: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
		};
	}
	const activeMasks = [
		...new Set(
			samples
				.map((sample) => sample.clockThrottleReasonsActiveMask)
				.filter((mask) => typeof mask === "string" && mask.length > 0),
		),
	];
	if (activeMasks.length) {
		summary.clockThrottleReasonsActiveMasks = activeMasks;
	}
	const throttleReasonCounts = {};
	for (const sample of samples) {
		for (const reason of sample.activeClockThrottleReasons ?? []) {
			throttleReasonCounts[reason] = (throttleReasonCounts[reason] ?? 0) + 1;
		}
	}
	if (Object.keys(throttleReasonCounts).length) {
		summary.clockThrottleReasonCounts = throttleReasonCounts;
	}
	return summary;
}

function cursorBounceScale(interactionType, ageMs, durationMs = 180) {
	if (!["click", "double-click", "right-click", "middle-click"].includes(interactionType)) {
		return 1;
	}
	if (ageMs < 0 || ageMs > durationMs) {
		return 1;
	}
	const progress = 1 - ageMs / durationMs;
	return Math.max(0.72, 1 - Math.sin(progress * Math.PI) * 0.08);
}

function latestClickSample(samples, sampleIndex) {
	for (let index = sampleIndex; index >= 0; index -= 1) {
		const sample = samples[index];
		if (
			["click", "double-click", "right-click", "middle-click"].includes(
				sample?.interactionType,
			)
		) {
			return sample;
		}
	}
	return null;
}

function writeCursorSamples(cursorPayload, outputPath) {
	const samples = Array.isArray(cursorPayload.samples) ? cursorPayload.samples : [];
	const cursorLines = samples
		.map((sample, index) => {
			if (
				!Number.isFinite(sample?.timeMs) ||
				!Number.isFinite(sample?.cx) ||
				!Number.isFinite(sample?.cy)
			) {
				return null;
			}
			const clickSample = latestClickSample(samples, index);
			const bounceScale = Number.isFinite(sample.bounceScale)
				? sample.bounceScale
				: clickSample
					? cursorBounceScale(
							clickSample.interactionType,
							sample.timeMs - clickSample.timeMs,
						)
					: 1;
			return [
				sample.timeMs,
				sample.cx,
				sample.cy,
				cursorTypeIndexes.get(sample.cursorType) ??
					(Number.isFinite(sample.cursorTypeIndex)
						? Math.max(0, Math.min(8, Math.round(sample.cursorTypeIndex)))
						: 0),
				Number(bounceScale.toFixed(4)),
			].join("\t");
		})
		.filter(Boolean)
		.join("\n");
	writeFileSync(outputPath, cursorLines ? `${cursorLines}\n` : "");
	return samples.length;
}

function renderTahoeCursorAtlas(workDir) {
	const rgbaPath = join(workDir, "tahoe-cursor-atlas.rgba");
	const metadataPath = join(workDir, "tahoe-cursor-atlas.tsv");
	const electronPath = require("electron");
	const render = run(
		electronPath,
		[
			join(scriptDir, "render-tahoe-cursor-atlas.cjs"),
			"--repo-root",
			repoRoot,
			"--output-rgba",
			rgbaPath,
			"--output-metadata",
			metadataPath,
		],
		{
			env: {
				...process.env,
				ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
			},
		},
	);
	const resultLine = render.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
	if (!resultLine) {
		fail("Cursor atlas renderer did not report a result");
	}
	const result = JSON.parse(resultLine);
	if (result.error) {
		fail(`Cursor atlas renderer failed: ${result.error}`);
	}
	return {
		rgbaPath,
		metadataPath,
		width: result.width,
		height: result.height,
		entries: result.entries,
		elapsedMs: render.elapsedMs,
	};
}

function prepareExternalCursorAtlas(workDir, pngPath, metadataPath) {
	const startedAt = performance.now();
	const resolvedPngPath = resolve(pngPath);
	const resolvedMetadataPath = resolve(metadataPath);
	if (!existsSync(resolvedPngPath)) {
		fail(`Cursor atlas PNG does not exist: ${resolvedPngPath}`);
	}
	if (!existsSync(resolvedMetadataPath)) {
		fail(`Cursor atlas metadata does not exist: ${resolvedMetadataPath}`);
	}

	const json = ffprobeJson([
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height",
		resolvedPngPath,
	]);
	const stream = json.streams?.[0];
	const width = Number(stream?.width);
	const height = Number(stream?.height);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		fail(`Invalid cursor atlas dimensions: ${resolvedPngPath}`);
	}

	const rgbaPath = join(workDir, "external-cursor-atlas.rgba");
	run(ffmpegCommand, [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		resolvedPngPath,
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgba",
		rgbaPath,
	]);
	const entries = readFileSync(resolvedMetadataPath, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean).length;
	if (entries === 0) {
		fail(`Cursor atlas metadata is empty: ${resolvedMetadataPath}`);
	}

	return {
		rgbaPath,
		metadataPath: resolvedMetadataPath,
		width,
		height,
		entries,
		elapsedMs: performance.now() - startedAt,
	};
}

async function runWithGpuMonitor(command, args, sampleIntervalMs) {
	const samples = [];
	const startedAt = performance.now();
	const shouldSampleGpu = Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0;
	let stdout = "";
	let stderr = "";

	const child = spawn(command, args, {
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const priorityBoosted = raiseChildPriority(child, "native CUDA encoder");

	const collectSample = () => {
		if (!shouldSampleGpu) {
			return;
		}
		const sample = sampleGpu();
		if (sample) {
			samples.push({
				elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
				...sample,
			});
		}
	};
	collectSample();
	const interval = shouldSampleGpu ? setInterval(collectSample, sampleIntervalMs) : null;

	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk) => {
		const text = chunk.toString();
		stderr += text;
		process.stderr.write(text);
	});

	const status = await new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", resolve);
	});
	if (interval) {
		clearInterval(interval);
	}
	collectSample();

	const elapsedMs = performance.now() - startedAt;
	if (status !== 0) {
		fail(
			`${command} exited with ${status}` +
				(stderr.trim() ? `\nSTDERR:\n${stderr.trim()}` : "") +
				(stdout.trim() ? `\nSTDOUT:\n${stdout.trim()}` : ""),
		);
	}
	return {
		elapsedMs,
		stdout,
		stderr,
		gpuSamples: samples,
		gpuSummary: summarizeGpuSamples(samples),
		priorityBoosted,
	};
}

function ffprobeJson(args) {
	const result = run(ffprobeCommand, ["-v", "error", ...args, "-of", "json"]);
	return JSON.parse(result.stdout);
}

async function ffprobeCsvAsync(args) {
	const result = await runAsync(ffprobeCommand, ["-v", "error", ...args, "-of", "csv=p=0"]);
	return result.stdout;
}

function getVideoInfo(inputPath) {
	const json = ffprobeJson([
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=codec_name,width,height,duration,avg_frame_rate,nb_frames",
		inputPath,
	]);
	let stream = json.streams?.[0];
	if (!stream) {
		fail(`No video stream found in ${inputPath}`);
	}
	if (stream.codec_name !== "h264") {
		fail(`The NVIDIA CUDA compositor currently expects H.264 input, got ${stream.codec_name}`);
	}
	const durationSec = Number(stream.duration);
	if (!Number.isFinite(durationSec) || durationSec <= 0) {
		fail("ffprobe did not return a valid video duration");
	}
	let sourceFrames = Number(stream.nb_frames);
	if (!Number.isFinite(sourceFrames) || sourceFrames <= 0) {
		const countedJson = ffprobeJson([
			"-count_frames",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=codec_name,width,height,duration,avg_frame_rate,nb_frames,nb_read_frames",
			inputPath,
		]);
		stream = countedJson.streams?.[0] ?? stream;
		sourceFrames = Number(stream.nb_read_frames || stream.nb_frames);
	}
	if (!Number.isFinite(sourceFrames) || sourceFrames <= 0) {
		fail("ffprobe did not return a valid source frame count");
	}
	return {
		codec: stream.codec_name,
		width: Number(stream.width),
		height: Number(stream.height),
		durationSec,
		sourceFrames,
		avgFrameRate: stream.avg_frame_rate,
	};
}

function normalizeMonotonicTimestamps(timestamps) {
	if (timestamps.length < 2) {
		return [];
	}

	const first = timestamps[0];
	const normalized = timestamps
		.map((value) => Math.max(0, value - first))
		.filter((value, index, values) => index === 0 || value >= values[index - 1]);
	return normalized.length === timestamps.length ? normalized : [];
}

function parseTimestampCsv(csv) {
	return csv
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const columns = line.split(",");
			const value = columns
				.map((column) => Number(column.trim()))
				.find((candidate) => Number.isFinite(candidate));
			return value ?? Number.NaN;
		})
		.filter((value) => Number.isFinite(value));
}

function readTimelineSegments(timelineMapPath) {
	if (!timelineMapPath) {
		return [];
	}
	const resolvedPath = resolve(timelineMapPath);
	if (!existsSync(resolvedPath)) {
		fail(`Timeline map does not exist: ${resolvedPath}`);
	}

	const segments = readFileSync(resolvedPath, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [sourceStartMs, sourceEndMs, outputStartMs, outputEndMs, speed] = line
				.split(",")
				.map((value) => Number(value.trim()));
			return { sourceStartMs, sourceEndMs, outputStartMs, outputEndMs, speed };
		});

	let outputCursorMs = 0;
	for (const segment of segments) {
		if (
			!Number.isFinite(segment.sourceStartMs) ||
			!Number.isFinite(segment.sourceEndMs) ||
			!Number.isFinite(segment.outputStartMs) ||
			!Number.isFinite(segment.outputEndMs) ||
			!Number.isFinite(segment.speed) ||
			segment.sourceEndMs <= segment.sourceStartMs ||
			segment.outputEndMs <= segment.outputStartMs ||
			segment.speed <= 0
		) {
			fail(`Invalid timeline map segment in ${resolvedPath}`);
		}
		if (Math.abs(segment.outputStartMs - outputCursorMs) > 2) {
			fail(`Timeline map output ranges must be contiguous: ${resolvedPath}`);
		}
		outputCursorMs = segment.outputEndMs;
	}

	return segments;
}

async function getVideoPacketPtsAsync(inputPath, durationSec) {
	const csv = await ffprobeCsvAsync([
		"-select_streams",
		"v:0",
		"-read_intervals",
		`%+${durationSec}`,
		"-show_packets",
		"-show_entries",
		"packet=pts_time,dts_time",
		inputPath,
	]);
	return normalizeMonotonicTimestamps(parseTimestampCsv(csv));
}

async function getVideoFramePtsAsync(inputPath, durationSec) {
	const csv = await ffprobeCsvAsync([
		"-select_streams",
		"v:0",
		"-read_intervals",
		`%+${durationSec}`,
		"-show_frames",
		"-show_entries",
		"frame=best_effort_timestamp_time",
		inputPath,
	]);
	return normalizeMonotonicTimestamps(parseTimestampCsv(csv));
}

async function writeFramePtsSidecarAsync(inputPath, durationSec, outputPath) {
	const startedAt = performance.now();
	let source = "packet-pts";
	let timestamps = await getVideoPacketPtsAsync(inputPath, durationSec);
	if (timestamps.length === 0) {
		source = "frame-pts";
		timestamps = await getVideoFramePtsAsync(inputPath, durationSec);
	}
	const elapsedMs = performance.now() - startedAt;
	if (timestamps.length === 0) {
		return { path: null, frames: 0, elapsedMs, source: "none" };
	}

	writeFileSync(outputPath, timestamps.map((value) => value.toFixed(9)).join("\n"));
	return { path: outputPath, frames: timestamps.length, elapsedMs, source };
}

function roundedRectMaskExpression({ x, y, width, height, radius }) {
	const right = x + width;
	const bottom = y + height;
	const cornerRight = right - radius;
	const cornerBottom = bottom - radius;
	const radiusSquared = radius * radius;
	const centerBand = `between(X,${x + radius},${cornerRight})*between(Y,${y},${bottom})`;
	const middleBand = `between(X,${x},${right})*between(Y,${y + radius},${cornerBottom})`;
	const topLeft = `lte((X-${x + radius})*(X-${x + radius})+(Y-${y + radius})*(Y-${y + radius}),${radiusSquared})*lte(X,${x + radius})*lte(Y,${y + radius})`;
	const topRight = `lte((X-${cornerRight})*(X-${cornerRight})+(Y-${y + radius})*(Y-${y + radius}),${radiusSquared})*gte(X,${cornerRight})*lte(Y,${y + radius})`;
	const bottomLeft = `lte((X-${x + radius})*(X-${x + radius})+(Y-${cornerBottom})*(Y-${cornerBottom}),${radiusSquared})*lte(X,${x + radius})*gte(Y,${cornerBottom})`;
	const bottomRight = `lte((X-${cornerRight})*(X-${cornerRight})+(Y-${cornerBottom})*(Y-${cornerBottom}),${radiusSquared})*gte(X,${cornerRight})*gte(Y,${cornerBottom})`;
	return `${centerBand}+${middleBand}+${topLeft}+${topRight}+${bottomLeft}+${bottomRight}`;
}

function createBackgroundFilter(videoInfo, shadowOptions, blurPx = 0) {
	const safeBlurPx = Math.max(0, Math.min(96, Math.round(Number.isFinite(blurPx) ? blurPx : 0)));
	const scaled = `[0:v]scale=${videoInfo.width}:${videoInfo.height}:force_original_aspect_ratio=increase,crop=${videoInfo.width}:${videoInfo.height},format=rgba[bg_scaled]`;
	const blurFilter =
		safeBlurPx > 0
			? `;[bg_scaled]boxblur=luma_radius=${safeBlurPx}:luma_power=1:chroma_radius=${safeBlurPx}:chroma_power=1:alpha_radius=${safeBlurPx}:alpha_power=1[bg]`
			: ";[bg_scaled]null[bg]";
	if (!shadowOptions) {
		return {
			filterArgs: [
				"-filter_complex",
				`${scaled}${blurFilter};[bg]format=nv12[out]`,
				"-map",
				"[out]",
			],
			bakedShadow: false,
			backgroundBlur: safeBlurPx,
		};
	}

	const shadowAlpha = Math.round(255 * Math.min(0.5, shadowOptions.intensityPct / 200));
	const shadowBlur = Math.max(12, Math.round(shadowOptions.radius * 1.5));
	const mask = roundedRectMaskExpression({
		x: shadowOptions.x,
		y: shadowOptions.y,
		width: shadowOptions.width,
		height: shadowOptions.height,
		radius: shadowOptions.radius,
	});
	const shadow = `[1:v]format=rgba,geq=r='0':g='0':b='0':a='if(${mask},${shadowAlpha},0)',boxblur=luma_radius=${shadowBlur}:luma_power=1:chroma_radius=${shadowBlur}:chroma_power=1:alpha_radius=${shadowBlur}:alpha_power=1[shadow]`;
	return {
		filterArgs: [
			"-f",
			"lavfi",
			"-i",
			`color=c=black@0.0:s=${videoInfo.width}x${videoInfo.height}:d=1`,
			"-filter_complex",
			`${scaled}${blurFilter};${shadow};[bg][shadow]overlay=format=auto,format=nv12[out]`,
			"-map",
			"[out]",
		],
		bakedShadow: true,
		shadowAlpha,
		shadowBlur,
		backgroundBlur: safeBlurPx,
	};
}

function parseProbeSummary(stdout) {
	const lines = stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const jsonLine = lines.find((line) => line.startsWith("{") && line.includes('"success"'));
	if (!jsonLine) {
		fail(`Native probe did not emit a JSON summary:\n${stdout}`);
	}
	try {
		return JSON.parse(jsonLine);
	} catch {
		// The helper currently prints raw Windows paths with backslashes.
		// Keep parsing resilient while this remains a throwaway benchmark tool.
		return JSON.parse(jsonLine.replace(/,"outputPath":".*"\}$/, "}"));
	}
}

const inputPath = resolve(getArg("--input"));
const outputPath = resolve(
	getArg("--output", join(scriptDir, "recordly-nvdec-nvenc-mp4-output.mp4")),
);
const fps = Math.round(getNumberArg("--fps", 30));
const bitrateMbps = Math.round(getNumberArg("--bitrate-mbps", 18));
const workDir = resolve(getArg("--work-dir", join(scriptDir, "mp4-work")));
const reuseIntermediates = hasArg("--reuse-intermediates");
const reuseDemux = hasArg("--reuse-demux") || reuseIntermediates;
const sampleGpuDuringEncode = hasArg("--sample-gpu");
const gpuSampleIntervalMs = Math.round(getNumberArg("--gpu-sample-interval-ms", 1000));
const streamSync = hasArg("--stream-sync");
const prewarmMs = Math.round(getNumberArg("--prewarm-ms", 0));
const maxOutputFrames = Math.round(getNumberArg("--max-output-frames", 0));
const requestedDurationSec = getNumberArg("--duration-sec", 0);
const chunkMb = Math.round(getNumberArg("--chunk-mb", 4));
const skipMux = hasArg("--skip-mux");
const videoOnly = hasArg("--video-only");
const contentX = Math.round(getNonNegativeNumberArg("--content-x", 0));
const contentY = Math.round(getNonNegativeNumberArg("--content-y", 0));
const contentWidth = Math.round(getNumberArg("--content-width", 0));
const contentHeight = Math.round(getNumberArg("--content-height", 0));
const radius = Math.round(getNonNegativeNumberArg("--radius", 0));
const backgroundY = Math.round(getNonNegativeNumberArg("--background-y", 16));
const backgroundU = Math.round(getNonNegativeNumberArg("--background-u", 128));
const backgroundV = Math.round(getNonNegativeNumberArg("--background-v", 128));
const backgroundImage = getArg("--background-image", "");
const backgroundBlurPx = getNonNegativeNumberArg("--background-blur", 0);
const backgroundNv12 = getArg("--background-nv12", "");
const shadowOffsetY = Math.round(getNonNegativeNumberArg("--shadow-offset-y", 0));
const shadowIntensityPct = Math.round(getNonNegativeNumberArg("--shadow-intensity-pct", 0));
const webcamInput = getArg("--webcam-input", "");
const webcamX = Math.round(getNonNegativeNumberArg("--webcam-x", 0));
const webcamY = Math.round(getNonNegativeNumberArg("--webcam-y", 0));
const webcamSize = Math.round(getNumberArg("--webcam-size", 0));
const webcamRadius = Math.round(getNonNegativeNumberArg("--webcam-radius", 0));
const webcamTimeOffsetMs = getFiniteNumberArg("--webcam-time-offset-ms", 0);
const webcamMirror = hasArg("--webcam-mirror");
const webcamStream = hasArg("--webcam-stream");
const cursorJson = getArg("--cursor-json", "");
const cursorHeight = Math.round(getNumberArg("--cursor-height", 0));
const cursorStyle = getArg("--cursor-style", "vector");
const cursorAtlasPng = getArg("--cursor-atlas-png", "");
const cursorAtlasMetadata = getArg("--cursor-atlas-metadata", "");
const zoomTelemetry = getArg("--zoom-telemetry", "");
const timelineMap = getArg("--timeline-map", "");

if (!existsSync(inputPath)) {
	fail(`Input does not exist: ${inputPath}`);
}
mkdirSync(workDir, { recursive: true });
mkdirSync(dirname(outputPath), { recursive: true });

function resolveNativeProbePath() {
	const configuredPath = process.env.RECORDLY_NVIDIA_CUDA_EXPORT_EXE;
	const platformArch = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
	const candidates = [
		configuredPath,
		join(scriptDir, "build", "Release", "recordly-nvidia-cuda-compositor.exe"),
		join(
			repoRoot,
			"electron",
			"native",
			"bin",
			platformArch,
			"recordly-nvidia-cuda-compositor.exe",
		),
		// Backward-compatible legacy helper path while old work dirs are being retired.
		join(scriptDir, "build", "Release", "recordly-nvdec-nvenc-probe.exe"),
	].filter(Boolean);

	for (const candidate of candidates) {
		const unpackedCandidate = unpackAsarPath(candidate);
		if (unpackedCandidate !== candidate && existsSync(unpackedCandidate)) {
			return unpackedCandidate;
		}
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	fail(`Native NVIDIA CUDA compositor is not built. Checked: ${candidates.join(", ")}`);
}
const nativeProbe = resolveNativeProbePath();

const baseName = basename(inputPath).replace(/\.[^.]+$/, "");
const webcamBaseName = webcamInput
	? basename(webcamInput).replace(/\.[^.]+$/, "")
	: `${baseName}.webcam`;
const annexBPath = join(workDir, `${baseName}.annexb.h264`);
const webcamAnnexBPath = join(workDir, `${webcamBaseName}.annexb.h264`);
const cursorSamplesPath = join(workDir, `${baseName}.cursor.tsv`);
const encodedPath = join(workDir, `${baseName}.mapped-callback.h264`);
const shouldBakeStaticShadow =
	Boolean(backgroundImage) &&
	contentWidth > 0 &&
	contentHeight > 0 &&
	shadowOffsetY > 0 &&
	shadowIntensityPct > 0;
const backgroundSuffixParts = [];
if (shouldBakeStaticShadow) {
	backgroundSuffixParts.push(`shadow-${shadowOffsetY}-${shadowIntensityPct}`);
}
if (backgroundBlurPx > 0) {
	backgroundSuffixParts.push(`blur-${Math.round(backgroundBlurPx)}`);
}
const backgroundSuffix = backgroundSuffixParts.length ? `.${backgroundSuffixParts.join(".")}` : "";
const generatedBackgroundNv12Path = join(workDir, `${baseName}${backgroundSuffix}.background.nv12`);
const generatedWebcamNv12Path = join(
	workDir,
	`${baseName}.webcam-${webcamSize}${webcamMirror ? "-mirror" : ""}.nv12`,
);
const sourcePtsPath = join(workDir, `${baseName}.source-pts.csv`);

const videoInfo = getVideoInfo(inputPath);
const webcamInfo = webcamInput ? getVideoInfo(webcamInput) : null;
const timelineSegments = readTimelineSegments(timelineMap);
const timelineOutputDurationSec = timelineSegments.length
	? Math.max(...timelineSegments.map((segment) => segment.outputEndMs)) / 1000
	: 0;
const durationSec =
	requestedDurationSec > 0
		? timelineSegments.length
			? requestedDurationSec
			: Math.min(videoInfo.durationSec, requestedDurationSec)
		: timelineSegments.length
			? timelineOutputDurationSec
			: videoInfo.durationSec;
if (timelineSegments.length && Math.abs(durationSec - timelineOutputDurationSec) > 0.05) {
	fail(
		`Timeline map output duration ${timelineOutputDurationSec.toFixed(
			3,
		)}s does not match requested duration ${durationSec.toFixed(3)}s`,
	);
}
const timelineSourceDurationSec = timelineSegments.length
	? Math.max(...timelineSegments.map((segment) => segment.sourceEndMs)) / 1000
	: durationSec;
if (timelineSourceDurationSec > videoInfo.durationSec + 0.1) {
	fail(
		`Timeline map source duration ${timelineSourceDurationSec.toFixed(
			3,
		)}s exceeds input duration ${videoInfo.durationSec.toFixed(3)}s`,
	);
}
const sourceDurationSec = Math.min(videoInfo.durationSec, timelineSourceDurationSec);
const webcamSourceDurationSec = webcamInfo
	? Math.min(sourceDurationSec, webcamInfo.durationSec)
	: sourceDurationSec;
const targetFrames = Math.ceil(durationSec * fps);
emitPreparationProgress(targetFrames, 1);
const pipelineStartedAt = performance.now();
const zeroElapsed = () => ({ elapsedMs: 0, stdout: "", stderr: "" });
let sourceWindowFrames = Math.max(
	1,
	Math.min(
		videoInfo.sourceFrames,
		Math.ceil((videoInfo.sourceFrames * sourceDurationSec) / videoInfo.durationSec),
	),
);
let webcamSourceWindowFrames = webcamInfo
	? Math.max(
			1,
			Math.min(
				webcamInfo.sourceFrames,
				Math.ceil((webcamInfo.sourceFrames * sourceDurationSec) / webcamInfo.durationSec),
			),
		)
	: 0;
const backgroundNv12Path = backgroundImage ? generatedBackgroundNv12Path : backgroundNv12;
const backgroundFilter = createBackgroundFilter(
	videoInfo,
	shouldBakeStaticShadow
		? {
				x: contentX,
				y: contentY + shadowOffsetY,
				width: contentWidth,
				height: contentHeight,
				radius: radius + 8,
				intensityPct: shadowIntensityPct,
			}
		: null,
	backgroundBlurPx,
);

const backgroundConvertPromise =
	backgroundImage && !(reuseIntermediates && existsSync(backgroundNv12Path))
		? runAsync(ffmpegCommand, [
				"-y",
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				resolve(backgroundImage),
				...backgroundFilter.filterArgs,
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				backgroundNv12Path,
			])
		: Promise.resolve(zeroElapsed());

const webcamConvertPromise =
	webcamInput &&
	!webcamStream &&
	webcamSize > 0 &&
	!(reuseIntermediates && existsSync(generatedWebcamNv12Path))
		? runAsync(ffmpegCommand, [
				"-y",
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				resolve(webcamInput),
				"-vf",
				`${webcamMirror ? "hflip," : ""}scale=${webcamSize}:${webcamSize}:force_original_aspect_ratio=increase,crop=${webcamSize}:${webcamSize},format=nv12`,
				"-frames:v",
				"1",
				"-f",
				"rawvideo",
				generatedWebcamNv12Path,
			])
		: Promise.resolve(zeroElapsed());

const webcamDemuxPromise =
	webcamInput && webcamStream && !(reuseDemux && existsSync(webcamAnnexBPath))
		? runWithProgress(
				ffmpegCommand,
				[
					"-y",
					"-hide_banner",
					"-loglevel",
					"error",
					"-stats",
					"-i",
					resolve(webcamInput),
					"-t",
					String(sourceDurationSec),
					"-map",
					"0:v:0",
					"-c:v",
					"copy",
					"-bsf:v",
					"h264_mp4toannexb",
					"-an",
					webcamAnnexBPath,
				],
				{
					totalDurationSec: sourceDurationSec,
					totalFrames: targetFrames,
					startPercentage: 1,
					endPercentage: 2,
				},
			)
		: Promise.resolve(zeroElapsed());

const demuxPromise =
	reuseDemux && existsSync(annexBPath)
		? Promise.resolve(zeroElapsed())
		: runWithProgress(
				ffmpegCommand,
				[
					"-y",
					"-hide_banner",
					"-loglevel",
					"error",
					"-stats",
					"-i",
					inputPath,
					"-t",
					String(sourceDurationSec),
					"-map",
					"0:v:0",
					"-c:v",
					"copy",
					"-bsf:v",
					"h264_mp4toannexb",
					"-an",
					annexBPath,
				],
				{
					totalDurationSec: sourceDurationSec,
					totalFrames: targetFrames,
					startPercentage: 1,
					endPercentage: 2,
				},
			);
const sourcePtsPromise = writeFramePtsSidecarAsync(inputPath, sourceDurationSec, sourcePtsPath);

if (cursorJson) {
	const cursorPayload = JSON.parse(readFileSync(resolve(cursorJson), "utf8"));
	writeCursorSamples(cursorPayload, cursorSamplesPath);
}
const cursorAtlas =
	cursorJson && cursorHeight > 0 && cursorAtlasPng && cursorAtlasMetadata
		? prepareExternalCursorAtlas(workDir, cursorAtlasPng, cursorAtlasMetadata)
		: cursorJson && cursorHeight > 0 && cursorStyle === "tahoe"
			? renderTahoeCursorAtlas(workDir)
			: null;

const [backgroundConvert, webcamConvert, webcamDemux, demux, sourcePts] = await Promise.all([
	backgroundConvertPromise,
	webcamConvertPromise,
	webcamDemuxPromise,
	demuxPromise,
	sourcePtsPromise,
]);
const preparationWallMs = performance.now() - pipelineStartedAt;
const demuxFrameCount = parseFfmpegStatsFrameCount(demux.stderr);
if (demuxFrameCount > 0) {
	sourceWindowFrames = demuxFrameCount;
}
const webcamDemuxFrameCount = parseFfmpegStatsFrameCount(webcamDemux.stderr);
if (webcamDemuxFrameCount > 0) {
	webcamSourceWindowFrames = webcamDemuxFrameCount;
}
if (timelineSegments.length && (!sourcePts.path || sourcePts.frames < sourceWindowFrames)) {
	fail("Timeline-map CUDA export requires source frame PTS for the full source window");
}
emitPreparationProgress(targetFrames, 3);

const encodeArgs = [
	"--input",
	annexBPath,
	"--output",
	encodedPath,
	"--fps",
	String(fps),
	"--input-frames",
	String(sourceWindowFrames),
	"--target-frames",
	String(targetFrames),
	"--bitrate-mbps",
	String(bitrateMbps),
	"--callback-encode",
	"--chunk-mb",
	String(chunkMb),
];
if (sourcePts.path && sourcePts.frames >= sourceWindowFrames) {
	encodeArgs.push("--source-pts", sourcePts.path);
}
if (timelineMap) {
	encodeArgs.push("--timeline-map", resolve(timelineMap));
}
if (maxOutputFrames > 0) {
	encodeArgs.push("--max-frames", String(maxOutputFrames));
}
if (cursorJson && cursorHeight > 0) {
	encodeArgs.push("--cursor-samples", cursorSamplesPath, "--cursor-height", String(cursorHeight));
	if (cursorAtlas) {
		encodeArgs.push(
			"--cursor-atlas-rgba",
			cursorAtlas.rgbaPath,
			"--cursor-atlas-metadata",
			cursorAtlas.metadataPath,
			"--cursor-atlas-width",
			String(cursorAtlas.width),
			"--cursor-atlas-height",
			String(cursorAtlas.height),
		);
	}
}
if (streamSync) {
	encodeArgs.push("--stream-sync");
}
if (prewarmMs > 0) {
	encodeArgs.push("--prewarm-ms", String(prewarmMs));
}
if (contentWidth > 0 && contentHeight > 0) {
	encodeArgs.push(
		"--content-x",
		String(contentX),
		"--content-y",
		String(contentY),
		"--content-width",
		String(contentWidth),
		"--content-height",
		String(contentHeight),
		"--radius",
		String(radius),
		"--background-y",
		String(backgroundY),
		"--background-u",
		String(backgroundU),
		"--background-v",
		String(backgroundV),
	);
	if (backgroundNv12Path) {
		encodeArgs.push("--background-nv12", backgroundNv12Path);
	}
	if (!shouldBakeStaticShadow && shadowOffsetY > 0 && shadowIntensityPct > 0) {
		encodeArgs.push(
			"--shadow-offset-y",
			String(shadowOffsetY),
			"--shadow-intensity-pct",
			String(shadowIntensityPct),
		);
	}
	if (webcamInput && webcamSize > 0) {
		encodeArgs.push(
			"--webcam-x",
			String(webcamX),
			"--webcam-y",
			String(webcamY),
			"--webcam-size",
			String(webcamSize),
			"--webcam-radius",
			String(webcamRadius),
			"--webcam-time-offset-ms",
			String(webcamTimeOffsetMs),
		);
		if (webcamMirror) {
			encodeArgs.push("--webcam-mirror");
		}
		if (webcamStream) {
			encodeArgs.push(
				"--webcam-annexb",
				webcamAnnexBPath,
				"--webcam-input-frames",
				String(webcamSourceWindowFrames),
				"--webcam-target-frames",
				String(targetFrames),
				"--webcam-source-duration-ms",
				String(webcamSourceDurationSec * 1000),
				"--webcam-source-width",
				String(webcamInfo.width),
				"--webcam-source-height",
				String(webcamInfo.height),
			);
		} else {
			encodeArgs.push("--webcam-nv12", generatedWebcamNv12Path);
		}
	}
}
if (zoomTelemetry) {
	encodeArgs.push("--zoom-samples", resolve(zoomTelemetry));
}
const encode =
	reuseIntermediates && existsSync(encodedPath)
		? { elapsedMs: 0, stdout: "", gpuSummary: null }
		: await runWithGpuMonitor(
				nativeProbe,
				encodeArgs,
				sampleGpuDuringEncode ? gpuSampleIntervalMs : 0,
			);
const nativeSummary = encode.stdout ? parseProbeSummary(encode.stdout) : null;

const mux = skipMux
	? { elapsedMs: 0 }
	: videoOnly
		? await runWithProgress(
				ffmpegCommand,
				[
					"-y",
					"-hide_banner",
					"-loglevel",
					"error",
					"-stats",
					"-framerate",
					String(fps),
					"-i",
					encodedPath,
					"-map",
					"0:v:0",
					"-c:v",
					"copy",
					outputPath,
				],
				{
					totalDurationSec: durationSec,
					totalFrames: targetFrames,
					startPercentage: 96,
					endPercentage: 97.25,
					stage: "finalizing",
				},
			)
		: await runWithProgress(
				ffmpegCommand,
				[
					"-y",
					"-hide_banner",
					"-loglevel",
					"error",
					"-stats",
					"-framerate",
					String(fps),
					"-i",
					encodedPath,
					"-i",
					inputPath,
					"-map",
					"0:v:0",
					"-map",
					"1:a?",
					"-c:v",
					"copy",
					"-c:a",
					"copy",
					"-t",
					String(durationSec),
					outputPath,
				],
				{
					totalDurationSec: durationSec,
					totalFrames: targetFrames,
					startPercentage: 96,
					endPercentage: 99,
					stage: "finalizing",
				},
			);

const outputInfo = skipMux
	? { streams: [] }
	: ffprobeJson([
			"-show_entries",
			"stream=index,codec_type,codec_name,width,height,duration,avg_frame_rate,nb_frames",
			outputPath,
		]);
const outputStreams = outputInfo.streams ?? [];
const outputVideo = outputStreams.find((stream) => stream.codec_type === "video") ?? null;
const outputAudio = outputStreams.find((stream) => stream.codec_type === "audio") ?? null;

console.log(
	JSON.stringify(
		{
			success: true,
			inputPath,
			outputPath,
			fps,
			bitrateMbps,
			streamSync,
			prewarmMs,
			maxOutputFrames,
			chunkMb,
			skipMux,
			videoOnly,
			durationSec,
			sourceDurationSec,
			timelineMap: timelineSegments.length
				? {
						inputPath: resolve(timelineMap),
						segments: timelineSegments.length,
						sourceDurationSec,
						outputDurationSec: durationSec,
					}
				: null,
			staticLayout:
				contentWidth > 0 && contentHeight > 0
					? {
							contentX,
							contentY,
							contentWidth,
							contentHeight,
							radius,
							backgroundY,
							backgroundU,
							backgroundV,
							shadowOffsetY,
							shadowIntensityPct,
							shadowBakedIntoBackground: shouldBakeStaticShadow,
							backgroundShadowAlpha: backgroundFilter.shadowAlpha ?? null,
							backgroundShadowBlur: backgroundFilter.shadowBlur ?? null,
							webcam:
								webcamInput && webcamSize > 0
									? {
											inputPath: resolve(webcamInput),
											x: webcamX,
											y: webcamY,
											size: webcamSize,
											radius: webcamRadius,
											timeOffsetMs: webcamTimeOffsetMs,
											sourceDurationSec: webcamSourceDurationSec,
											mirror: webcamMirror,
											staticFrameOnly: !webcamStream,
											stream: webcamStream,
										}
									: null,
							cursor:
								cursorJson && cursorHeight > 0
									? {
											inputPath: resolve(cursorJson),
											height: cursorHeight,
											style: cursorStyle,
											atlas: cursorAtlas
												? {
														width: cursorAtlas.width,
														height: cursorAtlas.height,
														entries: cursorAtlas.entries,
													}
												: null,
										}
									: null,
							zoom: zoomTelemetry
								? {
										inputPath: resolve(zoomTelemetry),
									}
								: null,
						}
					: null,
			gpuSampleIntervalMs: sampleGpuDuringEncode ? gpuSampleIntervalMs : null,
			videoInfo,
			sourceWindowFrames,
			sourcePtsFrames: sourcePts.frames,
			sourcePtsSource: sourcePts.source,
			targetFrames,
			timingsMs: {
				preparationWall: Number(preparationWallMs.toFixed(2)),
				demux: Number(demux.elapsedMs.toFixed(2)),
				backgroundConvert: Number(backgroundConvert.elapsedMs.toFixed(2)),
				cursorAtlas: Number((cursorAtlas?.elapsedMs ?? 0).toFixed(2)),
				webcamConvert: Number(webcamConvert.elapsedMs.toFixed(2)),
				webcamDemux: Number(webcamDemux.elapsedMs.toFixed(2)),
				sourcePtsProbe: Number(sourcePts.elapsedMs.toFixed(2)),
				nativeEncode: Number(encode.elapsedMs.toFixed(2)),
				mux: Number(mux.elapsedMs.toFixed(2)),
				endToEnd: Number((performance.now() - pipelineStartedAt).toFixed(2)),
			},
			nativeSummary,
			nativeProcessPriorityBoosted: encode.priorityBoosted ?? false,
			gpuSamples: encode.gpuSamples ?? [],
			gpuSummary: encode.gpuSummary ?? null,
			outputVideo,
			outputAudio,
			outputStreams,
		},
		null,
		2,
	),
);
