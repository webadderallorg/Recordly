import { describe, expect, it } from "vitest";
import {
	filterKeystrokesForDisplay,
	formatKeystrokeLabel,
	getVisibleKeystroke,
	normalizeKeystrokeSamples,
	parseKeyMonitorLine,
	shouldStoreCapturedKeystroke,
	type KeystrokeSample,
	DEFAULT_KEYSTROKE_OVERLAY_SETTINGS,
} from "./keystrokeOverlay";

function sample(partial: Partial<KeystrokeSample>): KeystrokeSample {
	return {
		timeMs: 0,
		key: "C",
		code: "C",
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
		...partial,
	};
}

describe("keystroke overlay helpers", () => {
	it("normalizes sidecar samples and drops empty keys", () => {
		expect(
			normalizeKeystrokeSamples({
				samples: [
					{ timeMs: 40, key: "C", ctrl: true },
					{ timeMs: "bad", key: "" },
					{ timeMs: 10, code: "Enter" },
				],
			}),
		).toEqual([
			{
				timeMs: 10,
				key: "Enter",
				code: "Enter",
				ctrl: false,
				alt: false,
				shift: false,
				meta: false,
				repeat: undefined,
			},
			{
				timeMs: 40,
				key: "C",
				code: "C",
				ctrl: true,
				alt: false,
				shift: false,
				meta: false,
				repeat: undefined,
			},
		]);
	});

	it("never stores password-field keystrokes", () => {
		expect(
			shouldStoreCapturedKeystroke(sample({ key: "a" }), {
				platform: "darwin",
				isPasswordField: true,
			}),
		).toBe(false);
		expect(
			shouldStoreCapturedKeystroke(sample({ key: "C", ctrl: true }), {
				platform: "linux",
				isPasswordField: "unknown",
			}),
		).toBe(false);
	});

	it("stores shortcuts only on Linux", () => {
		expect(
			shouldStoreCapturedKeystroke(sample({ key: "a" }), {
				platform: "linux",
				isPasswordField: false,
			}),
		).toBe(false);
		expect(
			shouldStoreCapturedKeystroke(sample({ key: "C", ctrl: true }), {
				platform: "linux",
				isPasswordField: false,
			}),
		).toBe(true);
	});

	it("skips key-repeat and modifier-only events", () => {
		expect(
			shouldStoreCapturedKeystroke(sample({ key: "A", repeat: true }), {
				isPasswordField: false,
			}),
		).toBe(false);
		expect(
			shouldStoreCapturedKeystroke(sample({ key: "Shift", shift: true }), {
				isPasswordField: false,
			}),
		).toBe(false);
	});

	it("filters display to shortcuts by default", () => {
		const samples = [
			sample({ timeMs: 100, key: "a" }),
			sample({ timeMs: 200, key: "C", ctrl: true }),
			sample({ timeMs: 300, key: "Enter" }),
		];
		expect(filterKeystrokesForDisplay(samples, DEFAULT_KEYSTROKE_OVERLAY_SETTINGS)).toEqual([
			samples[1],
			samples[2],
		]);
		expect(
			filterKeystrokesForDisplay(samples, {
				...DEFAULT_KEYSTROKE_OVERLAY_SETTINGS,
				mode: "all",
			}),
		).toEqual(samples);
	});

	it("returns the latest visible overlay label", () => {
		const samples = [
			sample({ timeMs: 100, key: "Enter" }),
			sample({ timeMs: 400, key: "C", ctrl: true }),
		];
		expect(getVisibleKeystroke(samples, 150, DEFAULT_KEYSTROKE_OVERLAY_SETTINGS)?.key).toBe(
			"Enter",
		);
		expect(getVisibleKeystroke(samples, 450, DEFAULT_KEYSTROKE_OVERLAY_SETTINGS)?.key).toBe("C");
		expect(getVisibleKeystroke(samples, 2500, DEFAULT_KEYSTROKE_OVERLAY_SETTINGS)).toBeNull();
		expect(getVisibleKeystroke(samples, 150, DEFAULT_KEYSTROKE_OVERLAY_SETTINGS)?.key).toBe(
			"Enter",
		);
	});

	it("treats command combos including punctuation as shortcuts", () => {
		expect(
			filterKeystrokesForDisplay(
				[
					sample({ key: "C", meta: true }),
					sample({ key: ",", meta: true }),
					sample({ key: "/", meta: true }),
					sample({ key: "Z", meta: true, shift: true }),
					sample({ key: "V", meta: true }),
					sample({ key: "a" }),
				],
				DEFAULT_KEYSTROKE_OVERLAY_SETTINGS,
			).map((item) => item.key),
		).toEqual(["C", ",", "/", "Z", "V"]);
	});

	it("formats shortcut labels", () => {
		expect(formatKeystrokeLabel(sample({ key: "C", ctrl: true }), false)).toBe("Ctrl+C");
		expect(formatKeystrokeLabel(sample({ key: "C", meta: true }), true)).toBe("⌘C");
		expect(formatKeystrokeLabel(sample({ key: ",", meta: true }), true)).toBe("⌘,");
	});

	it("parses native KEY monitor lines", () => {
		expect(parseKeyMonitorLine("KEY:down:C:ctrl,shift")).toEqual({
			action: "down",
			key: "C",
			code: "C",
			ctrl: true,
			alt: false,
			shift: true,
			meta: false,
			repeat: false,
		});
	});
});
