import { expect, it } from "vitest";
import {
	getVisibleWaveformSourceSpan as visible,
	getWaveformPixelPeak as peak,
} from "./waveformViewport";

it("maps the 1:18–1:58 viewport to that part of a 14-minute recording", () => {
	expect(
		visible(
			{ start: 0, end: 874959 },
			{ start: 0, end: 874959 },
			{ start: 78000, end: 118000 },
		),
	).toEqual({ start: 78000, end: 118000 });
});
it("pans to audio near the end without repeating the whole recording", () => {
	expect(
		visible(
			{ start: 0, end: 874959 },
			{ start: 0, end: 874959 },
			{ start: 830000, end: 874959 },
		),
	).toEqual({ start: 830000, end: 874959 });
});
it("maps trimmed and double-speed clips back to source time", () => {
	expect(
		visible(
			{ start: 5000, end: 15000 },
			{ start: 10000, end: 30000 },
			{ start: 10000, end: 12500 },
		),
	).toEqual({ start: 20000, end: 25000 });
});
it("clips the viewport to the item boundaries", () => {
	expect(
		visible({ start: 5000, end: 15000 }, { start: 0, end: 10000 }, { start: 0, end: 30000 }),
	).toEqual({ start: 0, end: 10000 });
});
it("does not draw items outside the viewport", () => {
	expect(
		visible({ start: 0, end: 1000 }, { start: 0, end: 1000 }, { start: 2000, end: 3000 }),
	).toBeNull();
});
it("does not lose a short speech transient between pixel sample points", () => {
	const peaks = new Float32Array(200000);
	peaks[150099] = 0.75;
	expect(peak({ peaks, durationMs: 875000 }, 656250, 656900)).toBe(0.75);
});
it("draws silence beyond the audio end instead of stretching audio to video duration", () => {
	expect(peak({ peaks: new Float32Array([1, 1]), durationMs: 874800 }, 874850, 874959)).toBe(0);
});
