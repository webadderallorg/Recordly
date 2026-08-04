// 4K CUDA compositor benchmark runner. Generates nothing; expects a prepared
// .tmp/cuda4k workspace with source-4k.mp4, overlay-4k.rgba, overlay-manifest.json,
// cursor-telemetry.json, zoom-telemetry.csv.
//
// Usage: node scripts/benchmark-cuda4k.mjs [--tag name] [--frames N] [--temporal N] [--overlay 0|1] [--cursor 0|1] [--codec h264|hevc]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workDir = path.join(repoRoot, ".tmp", "cuda4k");
const pipeline = path.join(
	repoRoot,
	"electron",
	"native",
	"nvidia-cuda-compositor",
	"run-mp4-pipeline.mjs",
);
const ffmpeg = path.join(repoRoot, "node_modules", "ffmpeg-static", "ffmpeg.exe");
const ffprobe = path.join(
	repoRoot,
	"node_modules",
	"ffprobe-static",
	"bin",
	"win32",
	"x64",
	"ffprobe.exe",
);

function arg(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const tag = arg("--tag", "baseline");
const durationSec = Number(arg("--duration", "6"));
const fps = Number(arg("--fps", "30"));
const temporal = Number(arg("--temporal", "13"));
const withOverlay = arg("--overlay", "1") === "1";
const withCursor = arg("--cursor", "0") === "1";
const codec = arg("--codec", "hevc");
const encodingMode = arg("--mode", "balanced");

if (!existsSync(path.join(workDir, "source-4k.mp4"))) {
	console.error("Missing 4K source; run generation first");
	process.exit(2);
}

const targetFrames = Math.ceil(durationSec * fps);
const outputPath = path.join(workDir, `out-${tag}-${codec}.mp4`);
const args = [
	pipeline,
	"--input",
	path.join(workDir, "source-4k.mp4"),
	"--output",
	outputPath,
	"--output-codec",
	codec,
	"--width",
	"3840",
	"--height",
	"2160",
	"--fps",
	String(fps),
	"--bitrate-mbps",
	"40",
	"--encoding-mode",
	encodingMode,
	"--duration-sec",
	String(durationSec),
	"--stream-sync",
	"--prewarm-ms",
	"300",
	"--content-x",
	"0",
	"--content-y",
	"0",
	"--content-width",
	"3840",
	"--content-height",
	"2160",
	"--radius",
	"0",
	"--background-y",
	"16",
	"--background-u",
	"128",
	"--background-v",
	"128",
	"--zoom-telemetry",
	path.join(workDir, "zoom-telemetry.csv"),
];
if (withOverlay) {
	const manifestPath = path.join(workDir, "overlay-manifest.json");
	const absoluteManifest = {
		layers: [
			{
				id: "bench-overlay",
				path: path.join(workDir, "overlay-4k.rgba"),
				x: 800,
				y: 500,
				width: 900,
				height: 560,
				frameCount: targetFrames,
			},
		],
	};
	writeFileSync(manifestPath, JSON.stringify(absoluteManifest));
	args.push("--overlay-manifest", manifestPath);
}
if (withCursor) {
	args.push(
		"--cursor-json",
		path.join(workDir, "cursor-telemetry.json"),
		"--cursor-height",
		"84",
	);
}
if (temporal >= 3) {
	args.push(
		"--temporal-blur-sample-count",
		String(temporal),
		"--temporal-blur-shutter-fraction",
		"0.5",
		"--temporal-blur-weight-power",
		"2",
	);
}

const env = {
	...process.env,
	RECORDLY_FFMPEG_EXE: ffmpeg,
	RECORDLY_FFPROBE_EXE: ffprobe,
	RECORDLY_NVIDIA_CUDA_EXPORT_HIGH_PRIORITY: "1",
};

const startedAt = performance.now();
const result = spawnSync("node", args, { env, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const elapsedMs = performance.now() - startedAt;
if (result.status !== 0) {
	console.error("Benchmark run failed", result.status);
	console.error(result.stderr.slice(-4000));
	process.exit(1);
}

const stdout = result.stdout;
const lines = stdout.split(/\r?\n/);
const summaryStart = lines.findIndex((line) => line.trim() === "{");
if (summaryStart === -1) {
	console.error("No summary JSON found");
	process.exit(1);
}
const summary = JSON.parse(lines.slice(summaryStart).join("\n"));
const ns = summary.nativeSummary ?? {};
const out = {
	tag,
	codec: summary.outputCodec,
	temporal,
	withOverlay: Boolean(ns.overlayLayers),
	withCursor: Boolean(ns.cursorOverlay),
	frames: ns.frames,
	targetFrames: summary.targetFrames,
	measuredFps: ns.measuredFps,
	realtimeMultiplier: ns.realtimeMultiplier,
	totalMs: ns.totalMs,
	decodeMs: ns.decodeMs,
	encodeMs: ns.encodeMs,
	compositeMs: ns.compositeMs,
	compositeGpuMs: ns.compositeGpuMs,
	zoomBlurGpuMs: ns.zoomBlurGpuMs,
	overlayBlendGpuMs: ns.overlayBlendGpuMs,
	overlayUploadMs: ns.overlayUploadMs,
	nvencMs: ns.nvencMs,
	packetWriteMs: ns.packetWriteMs,
	flushMs: ns.flushMs,
	temporalBlurFrames: ns.temporalBlurFrames,
	temporalBlurSamplesTotal: ns.temporalBlurSamplesTotal,
	roiCompositeFrames: ns.roiCompositeFrames,
	monolithicCompositeFrames: ns.monolithicCompositeFrames,
	copyCompositeFrames: ns.copyCompositeFrames,
	rcMode: ns.nvencDiagnostics?.rcModeUsed,
	outputBytes: ns.outputBytes,
	wallMs: Number(elapsedMs.toFixed(2)),
};
console.log(JSON.stringify(out, null, 1));
writeFileSync(path.join(workDir, `result-${tag}.json`), JSON.stringify(out, null, 1) + "\n");
