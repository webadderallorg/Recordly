import { describe, expect, it } from "vitest";
import { hexToRgb01 } from "./chromaKeyMath";
import { detectKeyColorFromPixels } from "./detectKeyColor";

const W = 160;
const H = 90;

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

const LIME: [number, number, number] = [140, 199, 64]; // Michael's warm lime screen
const SKIN: [number, number, number] = [214, 158, 128];
const SHIRT: [number, number, number] = [40, 42, 48];
const WALL: [number, number, number] = [120, 110, 100];
const BLUE: [number, number, number] = [30, 70, 200];

function personInCenter(
	screen: [number, number, number],
): (x: number, y: number) => [number, number, number] {
	return (x, y) => {
		const cx = Math.abs(x - W / 2) / (W / 2);
		const inTorso = cx < 0.35 && y > H * 0.3;
		const inHead = cx < 0.2 && y > H * 0.12 && y <= H * 0.45;
		if (inHead) return SKIN;
		if (inTorso) return SHIRT;
		return screen;
	};
}

describe("detectKeyColorFromPixels", () => {
	it("detects a lime green screen behind a centered person", () => {
		const hex = detectKeyColorFromPixels(makeFrame(personInCenter(LIME)), W, H);
		expect(hex).not.toBeNull();
		const rgb = hexToRgb01(hex as string);
		// Detected color should be close to the actual screen color.
		expect(rgb.r).toBeCloseTo(LIME[0] / 255, 1);
		expect(rgb.g).toBeCloseTo(LIME[1] / 255, 1);
		expect(rgb.b).toBeCloseTo(LIME[2] / 255, 1);
	});

	it("detects a blue screen", () => {
		const hex = detectKeyColorFromPixels(makeFrame(personInCenter(BLUE)), W, H);
		expect(hex).not.toBeNull();
		const rgb = hexToRgb01(hex as string);
		expect(rgb.b).toBeGreaterThan(rgb.r);
		expect(rgb.b).toBeGreaterThan(rgb.g);
	});

	it("returns null for a normal room with no screen", () => {
		const hex = detectKeyColorFromPixels(
			makeFrame((x, y) =>
				(personInCenter(WALL) as (x: number, y: number) => [number, number, number])(x, y),
			),
			W,
			H,
		);
		expect(hex).toBeNull();
	});

	it("returns null for degenerate input", () => {
		expect(detectKeyColorFromPixels(new Uint8ClampedArray(0), 0, 0)).toBeNull();
		expect(detectKeyColorFromPixels(new Uint8ClampedArray(8), 100, 100)).toBeNull();
	});

	it("still detects when the screen only fills part of the border (walls visible)", () => {
		// Screen occupies the middle 60% horizontally; walls on far edges —
		// like Michael's setup where the green screen doesn't reach the walls.
		const hex = detectKeyColorFromPixels(
			makeFrame((x, y) => {
				if (x < W * 0.2 || x > W * 0.8) return WALL;
				return personInCenter(LIME)(x, y);
			}),
			W,
			H,
		);
		expect(hex).not.toBeNull();
		const rgb = hexToRgb01(hex as string);
		expect(rgb.g).toBeGreaterThan(rgb.r);
		expect(rgb.g).toBeGreaterThan(rgb.b);
	});
});
