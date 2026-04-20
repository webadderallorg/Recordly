import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODERN_BACKEND_SWEEP = ["auto", "webcodecs", "breeze"];
const VARIANT_PRESETS = {
	adaptive: { name: "adaptive" },
	baseline: { name: "baseline", maxEncodeQueue: 120, maxDecodeQueue: 10, maxPendingFrames: 24 },
	tuned: { name: "tuned", maxEncodeQueue: 240, maxDecodeQueue: 12, maxPendingFrames: 32 },
};

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

export function createBenchmarkConfig(env = process.env) {
	const repoRoot = path.resolve(__dirname, "..", "..");
	const mainEntry = path.join(repoRoot, "dist-electron", "main.js");
	const rendererEntry = path.join(repoRoot, "dist", "index.html");
	const width = parseEvenInteger(env.RECORDLY_BENCH_EXPORT_WIDTH ?? "1280", "Width");
	const height = parseEvenInteger(env.RECORDLY_BENCH_EXPORT_HEIGHT ?? "720", "Height");
	const frameRate = parsePositiveInteger(env.RECORDLY_BENCH_EXPORT_FPS ?? "60", "Frame rate");
	const durationSeconds = parsePositiveInteger(
		env.RECORDLY_BENCH_EXPORT_DURATION ?? "15",
		"Duration",
	);
	const timeoutMs = parsePositiveInteger(
		env.RECORDLY_BENCH_EXPORT_TIMEOUT_MS ?? "180000",
		"Timeout",
	);
	const runsPerVariant = parsePositiveInteger(env.RECORDLY_BENCH_EXPORT_RUNS ?? "2", "Runs");
	const useNativeExport = env.RECORDLY_BENCH_EXPORT_USE_NATIVE === "1";
	const useWebcamOverlay = env.RECORDLY_BENCH_EXPORT_ENABLE_WEBCAM === "1";
	const exportEncodingMode = parseExportEncodingMode(
		env.RECORDLY_BENCH_EXPORT_ENCODING_MODE ?? null,
	);
	const exportShadowIntensity = parseExportShadowIntensity(
		env.RECORDLY_BENCH_EXPORT_SHADOW_INTENSITY ?? null,
	);
	const webcamWidth = parseEvenInteger(
		env.RECORDLY_BENCH_EXPORT_WEBCAM_WIDTH ?? "640",
		"Webcam width",
	);
	const webcamHeight = parseEvenInteger(
		env.RECORDLY_BENCH_EXPORT_WEBCAM_HEIGHT ?? "360",
		"Webcam height",
	);
	const webcamShadowIntensity = parseExportShadowIntensity(
		env.RECORDLY_BENCH_EXPORT_WEBCAM_SHADOW ?? null,
	);
	const webcamSize = parseExportWebcamSize(env.RECORDLY_BENCH_EXPORT_WEBCAM_SIZE ?? null);
	const exportPipeline = parseExportPipeline(env.RECORDLY_BENCH_EXPORT_PIPELINE ?? null);
	const exportBackend = parseExportBackend(env.RECORDLY_BENCH_EXPORT_BACKEND ?? null);
	const exportBackendList = parseExportBackendList(env.RECORDLY_BENCH_EXPORT_BACKENDS ?? null);
	const variantNameList = parseBenchmarkVariantList(
		env.RECORDLY_BENCH_EXPORT_VARIANTS ?? null,
	);

	return {
		repoRoot,
		mainEntry,
		rendererEntry,
		width,
		height,
		frameRate,
		durationSeconds,
		timeoutMs,
		runsPerVariant,
		useNativeExport,
		useWebcamOverlay,
		exportEncodingMode,
		exportShadowIntensity,
		webcamWidth,
		webcamHeight,
		webcamShadowIntensity,
		webcamSize,
		exportPipeline,
		exportBackend,
		exportBackendList,
		variants: variantNameList
			? variantNameList.map((variantName) => VARIANT_PRESETS[variantName])
			: [VARIANT_PRESETS.baseline, VARIANT_PRESETS.tuned],
	};
}

export function buildBenchmarkRequests(config) {
	if (config.exportBackendList) {
		return config.exportBackendList.map((backend) => ({
			pipeline: config.exportPipeline,
			backend,
			label: backend,
			slug: backend,
		}));
	}

	if (config.exportBackend) {
		return [
			{
				pipeline: config.exportPipeline,
				backend: config.exportBackend,
				label: config.exportBackend,
				slug: config.exportBackend,
			},
		];
	}

	if (config.exportPipeline === "modern") {
		return MODERN_BACKEND_SWEEP.map((backend) => ({
			pipeline: config.exportPipeline,
			backend,
			label: backend,
			slug: backend,
		}));
	}

	return [
		{
			pipeline: config.exportPipeline,
			backend: null,
			label: "default",
			slug: "default",
		},
	];
}