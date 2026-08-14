// Cursor telemetry contract shared by the NVIDIA CUDA compositor wrapper and
// its callers.
//
// The canonical `--cursor-json` payload is a JSON object with a `samples`
// array; each sample is
//   { timeMs, cx, cy, cursorType?, cursorTypeIndex?, interactionType?,
//     bounceScale?, visible? }
// The exact generated telemetry row format (TSV inside the pipeline, CSV from
// the Windows GPU compositor telemetry prep) is
//   timeMs<TAB|,>cx<TAB|,>cy<TAB|,>cursorTypeIndex<TAB|,>bounceScale<TAB|,>visible
// (6 whitespace- or comma-separated fields). Parsing must NEVER hand raw rows
// to JSON.parse; a mis-wired caller that points --cursor-json at a CSV/TSV
// samples file must be accepted or rejected with an actionable error, not a
// SyntaxError.

import { writeFileSync } from "node:fs";

export const CURSOR_SAMPLE_TYPES = [
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
export const cursorTypeIndexes = new Map(CURSOR_SAMPLE_TYPES.map((type, index) => [type, index]));
export const CURSOR_SAMPLE_MAX_TYPE_INDEX = CURSOR_SAMPLE_TYPES.length - 1;

const CLICK_TYPES = new Set(["click", "double-click", "right-click", "middle-click"]);
const DEFAULT_BOUNCE_DURATION_MS = 180;

function isCursorClickType(interactionType) {
	return CLICK_TYPES.has(interactionType);
}

export function cursorBounceScale(interactionType, ageMs, durationMs = DEFAULT_BOUNCE_DURATION_MS) {
	if (!isCursorClickType(interactionType)) {
		return 1;
	}
	if (ageMs < 0 || ageMs > durationMs) {
		return 1;
	}
	const progress = 1 - ageMs / durationMs;
	return Math.max(0.72, 1 - Math.sin(progress * Math.PI) * 0.08);
}

export function latestClickSample(samples, sampleIndex) {
	for (let index = sampleIndex; index >= 0; index -= 1) {
		const sample = samples[index];
		if (sample && isCursorClickType(sample.interactionType)) {
			return sample;
		}
	}
	return null;
}

export function isValidCursorSample(sample) {
	return (
		sample !== null &&
		typeof sample === "object" &&
		Number.isFinite(sample.timeMs) &&
		Number.isFinite(sample.cx) &&
		Number.isFinite(sample.cy)
	);
}

function normalizeCursorTypeIndex(value) {
	if (typeof value === "string" && cursorTypeIndexes.has(value)) {
		return cursorTypeIndexes.get(value);
	}
	if (Number.isFinite(value)) {
		return Math.max(0, Math.min(CURSOR_SAMPLE_MAX_TYPE_INDEX, Math.round(value)));
	}
	return 0;
}

// Formats samples into the exact TSV sidecar consumed by the native compositor
// (`--cursor-samples`): timeMs, cx, cy, cursorTypeIndex, bounceScale, visible,
// tab-separated, one row per line, in input order. Preserves renderer-resolved
// click bounce (bounceScale) and click type when present.
export function formatCursorSamplesTsv(samples) {
	const rows = [];
	for (let index = 0; index < samples.length; index += 1) {
		const sample = samples[index];
		if (!isValidCursorSample(sample)) {
			continue;
		}
		const clickSample = latestClickSample(samples, index);
		const bounceScale = Number.isFinite(sample.bounceScale)
			? sample.bounceScale
			: clickSample
				? cursorBounceScale(clickSample.interactionType, sample.timeMs - clickSample.timeMs)
				: 1;
		rows.push(
			[
				sample.timeMs,
				sample.cx,
				sample.cy,
				normalizeCursorTypeIndex(sample.cursorTypeIndex),
				Number(bounceScale.toFixed(4)),
				sample.visible === false ? 0 : 1,
			].join("\t"),
		);
	}
	return rows.join("\n");
}

export function writeCursorSamplesFile(samples, outputPath) {
	const lines = formatCursorSamplesTsv(samples);
	writeFileSync(outputPath, lines ? `${lines}\n` : "");
	return samples.length;
}

function clampUnit(value) {
	return Math.min(1, Math.max(0, value));
}

function parseCursorTelemetryRows(text, sourcePath) {
	const samples = [];
	const lines = text.split(/\r?\n/);
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex].trim();
		if (!line) {
			continue;
		}
		let fields = line.split("\t");
		if (fields.length === 1) {
			fields = line.split(",");
		}
		if (fields.length < 3 || fields.length > 6) {
			throw new Error(
				`${sourcePath} line ${lineIndex + 1} is not a cursor telemetry row; expected 6 TSV/CSV fields (timeMs,cx,cy,cursorTypeIndex,bounceScale,visible), received ${fields.length}: ${line}`,
			);
		}
		const numbers = fields.map(Number);
		if (!numbers.slice(0, 3).every(Number.isFinite)) {
			throw new Error(
				`${sourcePath} line ${lineIndex + 1} has invalid cursor position fields: ${line}`,
			);
		}
		samples.push({
			timeMs: Math.max(0, numbers[0]),
			cx: clampUnit(numbers[1]),
			cy: clampUnit(numbers[2]),
			cursorTypeIndex: normalizeCursorTypeIndex(numbers[3]),
			bounceScale: Number.isFinite(numbers[4]) ? Math.max(0.1, Math.min(2, numbers[4])) : 1,
			visible: Number.isFinite(numbers[5]) ? numbers[5] !== 0 : true,
		});
	}
	if (samples.length === 0) {
		throw new Error(
			`${sourcePath} contains no parseable cursor telemetry samples; expected a JSON {"samples":[...]} payload or TSV/CSV rows (timeMs,cx,cy,cursorTypeIndex,bounceScale,visible)`,
		);
	}
	return samples;
}

// Parses a --cursor-json file into cursor samples. Accepts the canonical JSON
// payload ({"samples":[...]} or a bare array) and the exact generated TSV/CSV
// row format so a mis-wired CSV/TSV telemetry file never reaches JSON.parse.
export function parseCursorTelemetrySamples(text, sourcePath = "cursor telemetry") {
	if (typeof text !== "string") {
		throw new Error(`${sourcePath} must contain text content`);
	}
	const trimmed = text.trim();
	if (!trimmed) {
		return [];
	}

	let payload = null;
	let jsonError = null;
	try {
		payload = JSON.parse(trimmed);
	} catch (error) {
		jsonError = error;
	}
	if (jsonError === null) {
		const samples = Array.isArray(payload) ? payload : payload?.samples;
		if (Array.isArray(samples)) {
			return samples.filter((sample) => isValidCursorSample(sample));
		}
		throw new Error(
			`${sourcePath} is valid JSON but does not contain a samples array; expected {"samples":[...]}`,
		);
	}

	return parseCursorTelemetryRows(trimmed, sourcePath);
}
