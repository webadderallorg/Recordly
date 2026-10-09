import { describe, expect, it } from "vitest";
import type { TypingTelemetryPoint } from "../types";
import {
	TYPING_MIN_KEYS,
	buildTypingZoomSuggestions,
	detectTypingZoomCandidates,
	normalizeTypingTelemetry,
	resolveTypingZoomDepth,
} from "./typingZoomSuggestionUtils";

function key(timeMs: number, cx = 0.5, cy = 0.5, keyClass: TypingTelemetryPoint["keyClass"] = "printable") {
	return { timeMs, cx, cy, keyClass };
}

describe("normalizeTypingTelemetry", () => {
	it("drops samples outside the recording and sorts by time", () => {
		const result = normalizeTypingTelemetry(
			[key(500), key(-10), key(9000), key(100)],
			1000,
		);
		expect(result.map((s) => s.timeMs)).toEqual([100, 500]);
	});

	it("clamps coordinates into 0..1", () => {
		const result = normalizeTypingTelemetry([key(0, -3, 9)], 1000);
		expect(result[0].cx).toBe(0);
		expect(result[0].cy).toBe(1);
	});

	it("returns nothing for a zero-length recording", () => {
		expect(normalizeTypingTelemetry([key(0)], 0)).toEqual([]);
	});
});

describe("detectTypingZoomCandidates", () => {
	it("ignores bursts below the minimum key count", () => {
		expect(detectTypingZoomCandidates([key(0), key(100)])).toEqual([]);
	});

	it("accepts a burst exactly at the minimum key count", () => {
		expect(detectTypingZoomCandidates([key(0), key(100), key(200)])).toHaveLength(1);
	});

	it("groups keys within the burst gap into one candidate", () => {
		const candidates = detectTypingZoomCandidates(
			Array.from({ length: 5 }, (_, i) => key(i * 100, 0.4, 0.6)),
		);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].keyCount).toBe(5);
		expect(candidates[0].focus.cx).toBeCloseTo(0.4);
		expect(candidates[0].focus.cy).toBeCloseTo(0.6);
	});

	it("splits bursts separated by more than the gap", () => {
		const candidates = detectTypingZoomCandidates([
			key(0), key(100), key(200),
			key(2000), key(2100), key(2200),
		]);
		expect(candidates).toHaveLength(2);
	});

	it("rejects a burst dominated by modifier shortcuts", () => {
		const candidates = detectTypingZoomCandidates([
			key(0, 0.5, 0.5, "shortcut"),
			key(100, 0.5, 0.5, "shortcut"),
			key(200, 0.5, 0.5, "shortcut"),
		]);
		expect(candidates).toEqual([]);
	});

	it("rejects a burst dominated by arrow-key caret movement", () => {
		const candidates = detectTypingZoomCandidates([
			key(0, 0.5, 0.5, "arrow"),
			key(120, 0.5, 0.5, "arrow"),
			key(240, 0.5, 0.5, "arrow"),
		]);
		expect(candidates).toEqual([]);
	});

	it("keeps a burst that is mostly text with a few navigation keys", () => {
		const candidates = detectTypingZoomCandidates([
			key(0), key(100), key(200, 0.5, 0.5, "arrow"), key(300), key(400),
		]);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].keyCount).toBe(5);
	});

	it("reports keys per second as the rate", () => {
		// 6 keys spanning 1000ms => 6 keys/sec
		const candidates = detectTypingZoomCandidates(
			Array.from({ length: 6 }, (_, i) => key(i * 200)),
		);
		expect(candidates[0].rate).toBeCloseTo(6, 1);
	});
});

describe("resolveTypingZoomDepth", () => {
	it("uses the shallowest depth for a short query", () => {
		expect(resolveTypingZoomDepth(TYPING_MIN_KEYS)).toBe(1);
	});

	it("deepens as more text is typed", () => {
		expect(resolveTypingZoomDepth(8)).toBe(2);
		expect(resolveTypingZoomDepth(24)).toBe(3);
	});
});

describe("buildTypingZoomSuggestions", () => {
	it("reports no-telemetry for an empty stream", () => {
		const result = buildTypingZoomSuggestions({ typingTelemetry: [], totalMs: 5000 });
		expect(result.status).toBe("no-telemetry");
	});

	it("reports no-typing when no burst is long enough", () => {
		const result = buildTypingZoomSuggestions({
			typingTelemetry: [key(100), key(200)],
			totalMs: 5000,
		});
		expect(result.status).toBe("no-typing");
	});

	it("pads around the burst and enforces a minimum duration", () => {
		const result = buildTypingZoomSuggestions({
			typingTelemetry: [key(1000), key(1100), key(1200)],
			totalMs: 10000,
		});
		expect(result.status).toBe("ok");
		const [zoom] = result.suggestions;
		// 3 keys in 200ms would be 200ms + 2*320 pad = 840ms, under the 900ms floor.
		expect(zoom.end - zoom.start).toBeGreaterThanOrEqual(900);
		expect(zoom.start).toBeLessThan(1000);
		expect(zoom.end).toBeGreaterThan(1200);
	});

	it("never exceeds the recording bounds", () => {
		const result = buildTypingZoomSuggestions({
			typingTelemetry: [key(10), key(110), key(210)],
			totalMs: 2000,
		});
		const [zoom] = result.suggestions;
		expect(zoom.start).toBeGreaterThanOrEqual(0);
		expect(zoom.end).toBeLessThanOrEqual(2000);
	});

	it("merges nearby bursts into one continuous zoom", () => {
		const result = buildTypingZoomSuggestions({
			typingTelemetry: [
				key(1000), key(1100), key(1200),
				key(1800), key(1900), key(2000),
			],
			totalMs: 10000,
			mergeGapMs: 600,
		});
		expect(result.suggestions).toHaveLength(1);
		expect(result.suggestions[0].keyCount).toBe(6);
	});

	it("keeps bursts apart when the gap is large", () => {
		const result = buildTypingZoomSuggestions({
			typingTelemetry: [
				key(1000), key(1100), key(1200),
				key(6000), key(6100), key(6200),
			],
			totalMs: 10000,
			mergeGapMs: 600,
		});
		expect(result.suggestions).toHaveLength(2);
	});

	it("skips bursts that collide with reserved spans", () => {
		const result = buildTypingZoomSuggestions({
			typingTelemetry: [key(1000), key(1100), key(1200)],
			totalMs: 10000,
			reservedSpans: [{ start: 500, end: 2500 }],
		});
		expect(result.status).toBe("no-slots");
	});

	it("returns suggestions in chronological order", () => {
		const result = buildTypingZoomSuggestions({
			typingTelemetry: [
				key(6000), key(6100), key(6200),
				key(1000), key(1100), key(1200),
			],
			totalMs: 10000,
		});
		const starts = result.suggestions.map((s) => s.start);
		expect([...starts].sort((a, b) => a - b)).toEqual(starts);
	});

	it("does not emit two zooms that overlap each other", () => {
		const result = buildTypingZoomSuggestions({
			typingTelemetry: [
				key(1000), key(1100), key(1200),
				key(3000), key(3100), key(3200),
			],
			totalMs: 10000,
		});
		for (let i = 1; i < result.suggestions.length; i += 1) {
			expect(result.suggestions[i].start).toBeGreaterThanOrEqual(
				result.suggestions[i - 1].end,
			);
		}
	});
});
