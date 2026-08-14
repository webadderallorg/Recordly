import { describe, expect, it } from "vitest";
import {
	formatCursorSamplesTsv,
	parseCursorTelemetrySamples,
	writeCursorSamplesFile,
} from "./cursorTelemetry.mjs";

// Regression guard for the CUDA compositor contract bug where a raw CSV/TSV
// cursor telemetry file was handed to JSON.parse (run-mp4-pipeline.mjs
// "JSON.parse receives 0,0.523828,0.731944,0,1,1"). The parser must accept the
// exact generated telemetry row format without ever JSON.parsing raw rows.

const CSV_TELEMETRY = [
	"0,0.523828,0.731944,0,1,1",
	"1000,0.62,0.7,2,0.9784,1",
	"2000,0.3,0.4,1,0.8675,0",
].join("\n");

const JSON_TELEMETRY = JSON.stringify({
	samples: [
		{
			timeMs: 0,
			cx: 0.523828,
			cy: 0.731944,
			cursorTypeIndex: 0,
			bounceScale: 1,
			visible: true,
		},
		{ timeMs: 1000, cx: 0.62, cy: 0.7, cursorTypeIndex: 2, bounceScale: 0.9784, visible: true },
		{ timeMs: 2000, cx: 0.3, cy: 0.4, cursorTypeIndex: 1, bounceScale: 0.8675, visible: false },
	],
});

describe("parseCursorTelemetrySamples", () => {
	it("parses the exact generated CSV row format without JSON.parse", () => {
		expect(() => JSON.parse(CSV_TELEMETRY)).toThrow();

		const samples = parseCursorTelemetrySamples(CSV_TELEMETRY, "cursor-telemetry.csv");
		expect(samples).toEqual([
			{
				timeMs: 0,
				cx: 0.523828,
				cy: 0.731944,
				cursorTypeIndex: 0,
				bounceScale: 1,
				visible: true,
			},
			{
				timeMs: 1000,
				cx: 0.62,
				cy: 0.7,
				cursorTypeIndex: 2,
				bounceScale: 0.9784,
				visible: true,
			},
			{
				timeMs: 2000,
				cx: 0.3,
				cy: 0.4,
				cursorTypeIndex: 1,
				bounceScale: 0.8675,
				visible: false,
			},
		]);
	});

	it("parses the exact generated TSV row format (pipeline cursor sidecar)", () => {
		const tsv = ["0\t0.523828\t0.731944\t0\t1\t1", "1000\t0.62\t0.7\t2\t0.9784\t1"].join("\n");
		const samples = parseCursorTelemetrySamples(tsv, "cursor.tsv");
		expect(samples).toEqual([
			{
				timeMs: 0,
				cx: 0.523828,
				cy: 0.731944,
				cursorTypeIndex: 0,
				bounceScale: 1,
				visible: true,
			},
			{
				timeMs: 1000,
				cx: 0.62,
				cy: 0.7,
				cursorTypeIndex: 2,
				bounceScale: 0.9784,
				visible: true,
			},
		]);
	});

	it("parses the canonical JSON payload with a samples array", () => {
		const samples = parseCursorTelemetrySamples(JSON_TELEMETRY, "cursor-telemetry.json");
		expect(samples).toHaveLength(3);
		expect(samples[1]).toMatchObject({ timeMs: 1000, cx: 0.62, cursorTypeIndex: 2 });
		expect(samples[2].visible).toBe(false);
	});

	it("accepts a bare JSON array of samples", () => {
		const samples = parseCursorTelemetrySamples(
			JSON.stringify(JSON.parse(JSON_TELEMETRY).samples),
		);
		expect(samples).toHaveLength(3);
	});

	it("clamps row values to the telemetry contract bounds", () => {
		const samples = parseCursorTelemetrySamples("0,-0.5,1.7,99,5,0", "cursor.csv");
		expect(samples[0]).toEqual({
			timeMs: 0,
			cx: 0,
			cy: 1,
			cursorTypeIndex: 8,
			bounceScale: 2,
			visible: false,
		});
	});

	it("accepts partial 3-field rows with defaults like the native loader", () => {
		const samples = parseCursorTelemetrySamples("0\t0.5\t0.5", "cursor.tsv");
		expect(samples[0]).toEqual({
			timeMs: 0,
			cx: 0.5,
			cy: 0.5,
			cursorTypeIndex: 0,
			bounceScale: 1,
			visible: true,
		});
	});

	it("round-trips the generated row format without value drift", () => {
		const parsed = parseCursorTelemetrySamples(CSV_TELEMETRY, "cursor-telemetry.csv");
		const tsv = formatCursorSamplesTsv(parsed);
		const reparsed = parseCursorTelemetrySamples(tsv, "roundtrip.tsv");
		expect(reparsed).toEqual(parsed);
	});

	it("rejects non-telemetry text with an actionable error instead of JSON.parse noise", () => {
		expect(() => parseCursorTelemetrySamples("hello world", "bad.txt")).toThrow(
			/bad\.txt line 1 is not a cursor telemetry row/,
		);
		expect(parseCursorTelemetrySamples("", "empty.csv")).toEqual([]);
	});

	it("rejects valid JSON that is not a samples payload", () => {
		expect(() => parseCursorTelemetrySamples('{"layers":[]}', "overlay.json")).toThrow(
			/does not contain a samples array/,
		);
	});
});

describe("writeCursorSamplesFile", () => {
	it("writes the TSV sidecar consumed by the native compositor", async () => {
		const os = await import("node:os");
		const path = await import("node:path");
		const fs = await import("node:fs");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recordly-cursor-telemetry-"));
		const outputPath = path.join(dir, "cursor.tsv");
		try {
			const samples = parseCursorTelemetrySamples(JSON_TELEMETRY, "cursor-telemetry.json");
			const count = writeCursorSamplesFile(samples, outputPath);
			expect(count).toBe(3);
			const written = fs.readFileSync(outputPath, "utf8");
			expect(written).toBe(
				"0\t0.523828\t0.731944\t0\t1\t1\n1000\t0.62\t0.7\t2\t0.9784\t1\n2000\t0.3\t0.4\t1\t0.8675\t0\n",
			);
			expect(parseCursorTelemetrySamples(written, outputPath)).toEqual(samples);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
