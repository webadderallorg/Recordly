import { describe, expect, it } from "vitest";
import {
	detectBlackBarInsets,
	hasMeaningfulInsets,
	intersectInsets,
	ZERO_INSETS,
} from "./blackBarDetection";

const W = 200;
const H = 120;

function makeFrame(fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
	const data = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const [r, g, b] = fill(x, y);
			const i = (y * W + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	return data;
}

const BLACK: [number, number, number] = [0, 0, 0];
const PAGE: [number, number, number] = [40, 60, 90];
const DARK_NAVY: [number, number, number] = [10, 15, 30]; // dark UI theme, NOT a bar

describe("detectBlackBarInsets", () => {
	it("detects a notch-style black band at the top only", () => {
		// 3% of 120 rows ≈ 4 rows of pure black, content below.
		const insets = detectBlackBarInsets(
			makeFrame((_x, y) => (y < 4 ? BLACK : PAGE)),
			W,
			H,
		);
		expect(insets.top).toBeCloseTo(4 / H, 5);
		expect(insets.bottom).toBe(0);
		expect(insets.left).toBe(0);
		expect(insets.right).toBe(0);
	});

	it("detects symmetric letterbox bands", () => {
		const insets = detectBlackBarInsets(
			makeFrame((_x, y) => (y < 8 || y >= H - 8 ? BLACK : PAGE)),
			W,
			H,
		);
		expect(insets.top).toBeCloseTo(8 / H, 5);
		expect(insets.bottom).toBeCloseTo(8 / H, 5);
	});

	it("does not flag dark navy UI themes as bars", () => {
		const insets = detectBlackBarInsets(
			makeFrame(() => DARK_NAVY),
			W,
			H,
		);
		expect(insets).toEqual(ZERO_INSETS);
	});

	it("treats an oversized black region as content, not a bar", () => {
		// Top 30% black (e.g. a black slide area) — exceeds the band cap.
		const insets = detectBlackBarInsets(
			makeFrame((_x, y) => (y < H * 0.3 ? BLACK : PAGE)),
			W,
			H,
		);
		expect(insets.top).toBe(0);
	});

	it("requires the band to span the full width", () => {
		// Black region on the left half of the top rows only — not a bar.
		const insets = detectBlackBarInsets(
			makeFrame((x, y) => (y < 4 && x < W / 2 ? BLACK : PAGE)),
			W,
			H,
		);
		expect(insets.top).toBe(0);
	});

	it("handles degenerate input", () => {
		expect(detectBlackBarInsets(new Uint8ClampedArray(0), 0, 0)).toEqual(ZERO_INSETS);
	});
});

describe("intersectInsets", () => {
	it("keeps a bar only when present in every sample", () => {
		const result = intersectInsets([
			{ top: 0.03, bottom: 0, left: 0, right: 0 },
			{ top: 0.03, bottom: 0.05, left: 0, right: 0 },
			{ top: 0.025, bottom: 0, left: 0, right: 0 },
		]);
		expect(result.top).toBeCloseTo(0.025, 5);
		expect(result.bottom).toBe(0); // appeared in only one frame
	});

	it("returns zero insets for no samples", () => {
		expect(intersectInsets([])).toEqual(ZERO_INSETS);
	});
});

describe("hasMeaningfulInsets", () => {
	it("ignores sub-threshold noise", () => {
		expect(hasMeaningfulInsets({ top: 0.004, bottom: 0, left: 0, right: 0 })).toBe(false);
		expect(hasMeaningfulInsets({ top: 0.025, bottom: 0, left: 0, right: 0 })).toBe(true);
	});
});
