import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = resolve(scriptDir, "..", "..", "..");

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

function emitPreparationProgress(totalFrames, percentage) {
  const payload = {
    currentFrame: 0,
    totalFrames: Math.max(1, Math.floor(totalFrames)),
    percentage: Number(Math.min(99, Math.max(0, percentage)).toFixed(2)),
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

function sampleGpu() {
  const result = spawnSync(
    "nvidia-smi",
    [
      "--query-gpu=timestamp,temperature.gpu,power.draw,pstate,utilization.gpu,utilization.decoder,utilization.encoder,clocks.sm,clocks.mem",
      "--format=csv,noheader,nounits",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }
  const parts = result.stdout.trim().split(",").map((part) => part.trim());
  return {
    timestamp: parts[0],
    temperatureC: Number(parts[1]),
    powerW: Number(parts[2]),
    pstate: parts[3],
    gpuUtilizationPct: Number(parts[4]),
    decoderUtilizationPct: Number(parts[5]),
    encoderUtilizationPct: Number(parts[6]),
    smClockMhz: Number(parts[7]),
    memoryClockMhz: Number(parts[8]),
  };
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
    if (["click", "double-click", "right-click", "middle-click"].includes(sample?.interactionType)) {
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
          ? cursorBounceScale(clickSample.interactionType, sample.timeMs - clickSample.timeMs)
          : 1;
      return [
        sample.timeMs,
        sample.cx,
        sample.cy,
        cursorTypeIndexes.get(sample.cursorType) ??
          (Number.isFinite(sample.cursorTypeIndex) ? Math.max(0, Math.min(8, Math.round(sample.cursorTypeIndex))) : 0),
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
  const render = run(electronPath, [
    join(scriptDir, "render-tahoe-cursor-atlas.cjs"),
    "--repo-root",
    repoRoot,
    "--output-rgba",
    rgbaPath,
    "--output-metadata",
    metadataPath,
  ], {
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });
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
  run("ffmpeg", [
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
  const result = run("ffprobe", ["-v", "error", ...args, "-of", "json"]);
  return JSON.parse(result.stdout);
}

function ffprobeCsv(args) {
  const result = run("ffprobe", ["-v", "error", ...args, "-of", "csv=p=0"]);
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

function getVideoPacketPts(inputPath, durationSec) {
  const csv = ffprobeCsv([
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

function getVideoFramePts(inputPath, durationSec) {
  const csv = ffprobeCsv([
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

function writeFramePtsSidecar(inputPath, durationSec, outputPath) {
  const startedAt = performance.now();
  let source = "packet-pts";
  let timestamps = getVideoPacketPts(inputPath, durationSec);
  if (timestamps.length === 0) {
    source = "frame-pts";
    timestamps = getVideoFramePts(inputPath, durationSec);
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

function createBackgroundFilter(videoInfo, shadowOptions) {
  const base = `[0:v]scale=${videoInfo.width}:${videoInfo.height}:force_original_aspect_ratio=increase,crop=${videoInfo.width}:${videoInfo.height},format=rgba[bg]`;
  if (!shadowOptions) {
    return {
      filterArgs: [
        "-vf",
        `scale=${videoInfo.width}:${videoInfo.height}:force_original_aspect_ratio=increase,crop=${videoInfo.width}:${videoInfo.height},format=nv12`,
      ],
      bakedShadow: false,
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
      `${base};${shadow};[bg][shadow]overlay=format=auto,format=nv12[out]`,
      "-map",
      "[out]",
    ],
    bakedShadow: true,
    shadowAlpha,
    shadowBlur,
  };
}

function parseProbeSummary(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const jsonLine = lines.find((line) => line.startsWith("{") && line.includes("\"success\""));
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
const outputPath = resolve(getArg("--output", join(scriptDir, "recordly-nvdec-nvenc-mp4-output.mp4")));
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
const backgroundNv12 = getArg("--background-nv12", "");
const shadowOffsetY = Math.round(getNonNegativeNumberArg("--shadow-offset-y", 0));
const shadowIntensityPct = Math.round(getNonNegativeNumberArg("--shadow-intensity-pct", 0));
const webcamInput = getArg("--webcam-input", "");
const webcamX = Math.round(getNonNegativeNumberArg("--webcam-x", 0));
const webcamY = Math.round(getNonNegativeNumberArg("--webcam-y", 0));
const webcamSize = Math.round(getNumberArg("--webcam-size", 0));
const webcamRadius = Math.round(getNonNegativeNumberArg("--webcam-radius", 0));
const webcamMirror = hasArg("--webcam-mirror");
const webcamStream = hasArg("--webcam-stream");
const cursorJson = getArg("--cursor-json", "");
const cursorHeight = Math.round(getNumberArg("--cursor-height", 0));
const cursorStyle = getArg("--cursor-style", "vector");
const cursorAtlasPng = getArg("--cursor-atlas-png", "");
const cursorAtlasMetadata = getArg("--cursor-atlas-metadata", "");
const zoomTelemetry = getArg("--zoom-telemetry", "");

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
    join(repoRoot, "electron", "native", "bin", platformArch, "recordly-nvidia-cuda-compositor.exe"),
    // Backward-compatible legacy helper path while old work dirs are being retired.
    join(scriptDir, "build", "Release", "recordly-nvdec-nvenc-probe.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
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
const backgroundSuffix = shouldBakeStaticShadow
  ? `.shadow-${shadowOffsetY}-${shadowIntensityPct}`
  : "";
const generatedBackgroundNv12Path = join(
  workDir,
  `${baseName}${backgroundSuffix}.background.nv12`,
);
const generatedWebcamNv12Path = join(
  workDir,
  `${baseName}.webcam-${webcamSize}${webcamMirror ? "-mirror" : ""}.nv12`,
);
const sourcePtsPath = join(workDir, `${baseName}.source-pts.csv`);

const videoInfo = getVideoInfo(inputPath);
const webcamInfo = webcamInput ? getVideoInfo(webcamInput) : null;
const durationSec =
  requestedDurationSec > 0 ? Math.min(videoInfo.durationSec, requestedDurationSec) : videoInfo.durationSec;
const targetFrames = Math.ceil(durationSec * fps);
emitPreparationProgress(targetFrames, 1);
let sourceWindowFrames = Math.max(
  1,
  Math.min(videoInfo.sourceFrames, Math.ceil((videoInfo.sourceFrames * durationSec) / videoInfo.durationSec)),
);
let webcamSourceWindowFrames = webcamInfo
  ? Math.max(
      1,
      Math.min(webcamInfo.sourceFrames, Math.ceil((webcamInfo.sourceFrames * durationSec) / webcamInfo.durationSec)),
    )
  : 0;
const backgroundNv12Path = backgroundImage
  ? generatedBackgroundNv12Path
  : backgroundNv12;
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
);

const backgroundConvert =
  backgroundImage && !(reuseIntermediates && existsSync(backgroundNv12Path))
    ? run("ffmpeg", [
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
    : { elapsedMs: 0 };

const webcamConvert =
  webcamInput && !webcamStream && webcamSize > 0 && !(reuseIntermediates && existsSync(generatedWebcamNv12Path))
    ? run("ffmpeg", [
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
    : { elapsedMs: 0 };

const webcamDemux =
  webcamInput && webcamStream && !(reuseDemux && existsSync(webcamAnnexBPath))
    ? run("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-stats",
        "-i",
        resolve(webcamInput),
        "-t",
        String(durationSec),
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        "-bsf:v",
        "h264_mp4toannexb",
        "-an",
        webcamAnnexBPath,
      ])
    : { elapsedMs: 0 };

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

const demux = reuseDemux && existsSync(annexBPath)
  ? { elapsedMs: 0 }
  : run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-stats",
      "-i",
      inputPath,
      "-t",
      String(durationSec),
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
      "-bsf:v",
      "h264_mp4toannexb",
      "-an",
      annexBPath,
    ]);
const demuxFrameCount = parseFfmpegStatsFrameCount(demux.stderr);
if (demuxFrameCount > 0) {
  sourceWindowFrames = demuxFrameCount;
}
const webcamDemuxFrameCount = parseFfmpegStatsFrameCount(webcamDemux.stderr);
if (webcamDemuxFrameCount > 0) {
  webcamSourceWindowFrames = webcamDemuxFrameCount;
}
emitPreparationProgress(targetFrames, 2);
const sourcePts = writeFramePtsSidecar(inputPath, durationSec, sourcePtsPath);
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
const encode = reuseIntermediates && existsSync(encodedPath)
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
    ? run("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-framerate",
        String(fps),
        "-i",
        encodedPath,
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        outputPath,
      ])
  : run("ffmpeg", [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
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
]);

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
        demux: Number(demux.elapsedMs.toFixed(2)),
        backgroundConvert: Number(backgroundConvert.elapsedMs.toFixed(2)),
        cursorAtlas: Number((cursorAtlas?.elapsedMs ?? 0).toFixed(2)),
        webcamConvert: Number(webcamConvert.elapsedMs.toFixed(2)),
        webcamDemux: Number(webcamDemux.elapsedMs.toFixed(2)),
        sourcePtsProbe: Number(sourcePts.elapsedMs.toFixed(2)),
        nativeEncode: Number(encode.elapsedMs.toFixed(2)),
        mux: Number(mux.elapsedMs.toFixed(2)),
        endToEnd: Number(
          (
            backgroundConvert.elapsedMs +
            (cursorAtlas?.elapsedMs ?? 0) +
            webcamConvert.elapsedMs +
            webcamDemux.elapsedMs +
            demux.elapsedMs +
            sourcePts.elapsedMs +
            encode.elapsedMs +
            mux.elapsedMs
          ).toFixed(2),
        ),
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
