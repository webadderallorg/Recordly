import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSources, getScreen } = vi.hoisted(() => ({ getSources: vi.fn(), getScreen: vi.fn() }));
vi.mock("electron", () => ({ desktopCapturer: { getSources } }));
vi.mock("../ipc/utils", () => ({ getScreen }));

import { WINDOW_OFF_SCREEN_MESSAGE } from "../ipc/types";
import {
	captureWindow,
	clampRegion,
	MAX_IMAGE_PIXELS,
	planWindowCrop,
	type WindowSample,
	waitForStillWindow,
	windowSampleChanged,
} from "./screenshot";

const RETINA = { x: 0, y: 0, width: 1440, height: 900 };

describe("planWindowCrop", () => {
	it("crops a window on a Retina display and keeps the image within 1.15 megapixels", () => {
		const plan = planWindowCrop({ x: 100, y: 50, width: 800, height: 600 }, RETINA, {
			width: 2880,
			height: 1800,
		});
		expect(plan).toEqual({
			crop: { x: 200, y: 100, width: 1600, height: 1200 },
			output: { width: 1238, height: 928 },
			scale: 800 / 1238,
			originX: 0,
			originY: 0,
		});
	});

	it("caps a wide window's long edge at 1568 px", () => {
		const plan = planWindowCrop({ x: 0, y: 0, width: 1440, height: 300 }, RETINA, {
			width: 2880,
			height: 1800,
		});
		expect(plan?.output).toEqual({ width: 1568, height: 326 });
		expect((plan?.output.width ?? 0) * (plan?.output.height ?? 0)).toBeLessThanOrEqual(
			MAX_IMAGE_PIXELS,
		);
	});

	it("never upscales a small window, so one pixel is one point at 1x", () => {
		const plan = planWindowCrop({ x: 10, y: 20, width: 400, height: 300 }, RETINA, {
			width: 1440,
			height: 900,
		});
		expect(plan).toMatchObject({
			crop: { x: 10, y: 20, width: 400, height: 300 },
			output: { width: 400, height: 300 },
			scale: 1,
		});
	});

	it("maps a secondary display's offset and clips a window hanging off its edge", () => {
		const display = { x: 1440, y: 0, width: 1920, height: 1080 };
		const plan = planWindowCrop({ x: 1340, y: 980, width: 800, height: 600 }, display, {
			width: 1920,
			height: 1080,
		});
		expect(plan).toMatchObject({
			crop: { x: 0, y: 980, width: 700, height: 100 },
			output: { width: 700, height: 100 },
			originX: 100,
			originY: 0,
			scale: 1,
		});
	});

	it("returns null when less than a pixel of the window is visible", () => {
		expect(
			planWindowCrop({ x: 1439.5, y: 0, width: 300, height: 300 }, RETINA, {
				width: 1440,
				height: 900,
			}),
		).toBeNull();
	});

	it("returns null when the window is not on the display", () => {
		expect(
			planWindowCrop({ x: 2000, y: 0, width: 300, height: 300 }, RETINA, {
				width: 2880,
				height: 1800,
			}),
		).toBeNull();
	});
});

describe("clampRegion", () => {
	const WINDOW = { x: 100, y: 50, width: 800, height: 600 };

	it("clamps a region to the window and returns it in screen points", () => {
		expect(clampRegion(WINDOW, { x: -10, y: 550, width: 100, height: 100 })).toEqual({
			x: 100,
			y: 600,
			width: 90,
			height: 50,
		});
	});

	it.each([
		[{ x: 0, y: 0, width: 0, height: 10 }, /positive width/],
		[{ x: 0, y: 0, width: 10, height: -5 }, /positive width/],
		[{ x: Number.NaN, y: 0, width: 10, height: 10 }, /positive width/],
		[{ x: 800, y: 0, width: 50, height: 50 }, /outside the selected window \(800 × 600/],
		[{ x: 799.5, y: 0, width: 10, height: 10 }, /outside the selected window/],
	])("refuses %o", (region, message) => {
		expect(() => clampRegion(WINDOW, region)).toThrow(message);
	});

	it("keeps a large region within the image caps", () => {
		const area = clampRegion(WINDOW, { x: 0, y: 0, width: 800, height: 600 });
		const plan = planWindowCrop(area, RETINA, { width: 2880, height: 1800 });
		expect(plan?.output).toEqual({ width: 1238, height: 928 });
	});
});

describe("captureWindow", () => {
	const FRAME = { x: 100, y: 50, width: 800, height: 600 };

	function mockRetina() {
		const crop = vi.fn(() => ({ resize: () => ({ toJPEG: () => Buffer.from("hi") }) }));
		getScreen.mockReturnValue({
			getDisplayMatching: () => ({
				id: 1,
				bounds: RETINA,
				size: { width: 1440, height: 900 },
				scaleFactor: 2,
			}),
		});
		getSources.mockResolvedValue([
			{
				display_id: "1",
				thumbnail: {
					isEmpty: () => false,
					getSize: () => ({ width: 2880, height: 1800 }),
					crop,
				},
			},
		]);
		return crop;
	}

	it("zooms a region at the display's physical resolution and reports its origin", async () => {
		const crop = mockRetina();
		await expect(
			captureWindow(FRAME, { x: 700, y: -20, width: 300, height: 100 }),
		).resolves.toEqual({
			data: "aGk=",
			mimeType: "image/jpeg",
			width: 200,
			height: 160,
			scale: 0.5,
			originX: 700,
			originY: 0,
		});
		expect(getSources).toHaveBeenCalledWith({
			types: ["screen"],
			thumbnailSize: { width: 2880, height: 1800 },
		});
		expect(crop).toHaveBeenCalledWith({ x: 1600, y: 100, width: 200, height: 160 });
	});

	it("captures the whole window without a region", async () => {
		const crop = mockRetina();
		await expect(captureWindow(FRAME)).resolves.toMatchObject({
			width: 1238,
			height: 928,
			scale: 800 / 1238,
			originX: 0,
			originY: 0,
		});
		expect(crop).toHaveBeenCalledWith({ x: 200, y: 100, width: 1600, height: 1200 });
	});

	it("refuses a region outside the window before capturing", async () => {
		mockRetina();
		getSources.mockClear();
		await expect(captureWindow(FRAME, { x: 900, y: 0, width: 10, height: 10 })).rejects.toThrow(
			/outside the selected window/,
		);
		expect(getSources).not.toHaveBeenCalled();
	});

	it("says a region is off screen rather than the window being closed", async () => {
		mockRetina();
		await expect(
			captureWindow(
				{ x: 1000, y: 50, width: 800, height: 600 },
				{ x: 500, y: 0, width: 100, height: 100 },
			),
		).rejects.toThrow("That part of the window is off screen.");
	});
});

function sample(width: number, height: number, value = 255): WindowSample {
	return { width, height, pixels: new Uint8Array(width * height * 4).fill(value) };
}

function paint(target: WindowSample, x: number, y: number, width: number, height: number) {
	for (let row = y; row < y + height; row += 1) {
		const start = (row * target.width + x) * 4;
		target.pixels.fill(0, start, start + width * 4);
	}
	return target;
}

describe("windowSampleChanged", () => {
	it("sees no change between identical samples", () => {
		expect(windowSampleChanged(sample(320, 200), sample(320, 200))).toBe(false);
	});

	it("ignores a shift across every pixel that stays below the noise level", () => {
		expect(windowSampleChanged(sample(320, 200), sample(320, 200, 240))).toBe(false);
	});

	it("ignores a blinking caret and a small spinner", () => {
		const busy = paint(paint(sample(320, 200), 40, 30, 2, 14), 300, 10, 10, 10);
		expect(windowSampleChanged(sample(320, 200), busy)).toBe(false);
	});

	it("counts a change once it covers more than 0.3 % of the pixels", () => {
		expect(windowSampleChanged(sample(320, 200), paint(sample(320, 200), 0, 0, 19, 10))).toBe(
			false,
		);
		expect(windowSampleChanged(sample(320, 200), paint(sample(320, 200), 0, 0, 20, 10))).toBe(
			true,
		);
	});

	it("detects a dialog appearing", () => {
		expect(
			windowSampleChanged(sample(320, 200), paint(sample(320, 200), 100, 60, 120, 80)),
		).toBe(true);
	});

	it("treats a resized window as changed", () => {
		expect(windowSampleChanged(sample(320, 200), sample(320, 180))).toBe(true);
	});
});

describe("waitForStillWindow", () => {
	const FRAME = { x: 100, y: 50, width: 800, height: 600 };
	const RETINA_DISPLAY = {
		id: 1,
		bounds: RETINA,
		size: { width: 1440, height: 900 },
		scaleFactor: 2,
	};

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function thumbnail(size: { width: number; height: number }, value: number) {
		return {
			isEmpty: () => false,
			getSize: () => size,
			crop: vi.fn((rect: { width: number; height: number }) => ({
				toBitmap: () => sample(rect.width, rect.height, value).pixels,
			})),
		};
	}

	function mockFrames(valueAt: (call: number) => number) {
		let call = 0;
		getScreen.mockReturnValue({ getDisplayMatching: () => RETINA_DISPLAY });
		getSources.mockReset();
		getSources.mockImplementation(
			async ({ thumbnailSize }: { thumbnailSize: { width: number; height: number } }) => [
				{ display_id: "1", thumbnail: thumbnail(thumbnailSize, valueAt(call++)) },
			],
		);
	}

	it("settles once the window has not changed for 400 ms, sampling a 320 px thumbnail", async () => {
		mockFrames(() => 255);
		const result = waitForStillWindow(FRAME, { timeoutMs: 4000 });
		await vi.advanceTimersByTimeAsync(1000);
		await expect(result).resolves.toEqual({ settled: true, elapsedMs: 450 });
		expect(getSources).toHaveBeenCalledTimes(4);
		expect(getSources).toHaveBeenCalledWith({
			types: ["screen"],
			thumbnailSize: { width: 576, height: 360 },
		});
		const shot = await getSources.mock.results[0].value;
		expect(shot[0].thumbnail.crop).toHaveBeenCalledWith({
			x: 40,
			y: 20,
			width: 320,
			height: 240,
		});
	});

	it("compares two samples before calling the window still", async () => {
		mockFrames(() => 255);
		const capture = getSources.getMockImplementation();
		getSources.mockImplementationOnce(
			(options: unknown) =>
				new Promise((resolve) => setTimeout(() => resolve(capture(options)), 500)),
		);
		const result = waitForStillWindow(FRAME, { timeoutMs: 4000 });
		await vi.advanceTimersByTimeAsync(1000);
		await expect(result).resolves.toMatchObject({ settled: true });
		expect(getSources).toHaveBeenCalledTimes(2);
	});

	it("keeps waiting while the window changes, then settles", async () => {
		mockFrames((call) => [255, 0, 255][call] ?? 255);
		const result = waitForStillWindow(FRAME, { timeoutMs: 4000 });
		await vi.advanceTimersByTimeAsync(2000);
		await expect(result).resolves.toEqual({ settled: true, elapsedMs: 750 });
	});

	it("gives up at the timeout without throwing", async () => {
		mockFrames((call) => (call % 2 ? 0 : 255));
		const result = waitForStillWindow(FRAME, { timeoutMs: 1000 });
		await vi.advanceTimersByTimeAsync(2000);
		await expect(result).resolves.toEqual({ settled: false, elapsedMs: 1000 });
	});

	it("rejects as soon as the signal aborts, even mid-capture", async () => {
		mockFrames(() => 255);
		getSources.mockImplementationOnce(getSources.getMockImplementation());
		getSources.mockReturnValueOnce(new Promise(() => undefined));
		const controller = new AbortController();
		const result = waitForStillWindow(FRAME, { timeoutMs: 4000, signal: controller.signal });
		const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
		await vi.advanceTimersByTimeAsync(200);
		expect(getSources).toHaveBeenCalledTimes(2);
		controller.abort();
		await rejected;
	});

	it("gives up at the timeout when a capture never finishes", async () => {
		mockFrames(() => 255);
		getSources.mockImplementationOnce(getSources.getMockImplementation());
		getSources.mockReturnValueOnce(new Promise(() => undefined));
		const result = waitForStillWindow(FRAME, { timeoutMs: 1000 });
		await vi.advanceTimersByTimeAsync(1500);
		await expect(result).resolves.toEqual({ settled: false, elapsedMs: 1000 });
	});

	it("rejects an already aborted signal before capturing", async () => {
		mockFrames(() => 255);
		await expect(
			waitForStillWindow(FRAME, { timeoutMs: 4000, signal: AbortSignal.abort() }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(getSources).not.toHaveBeenCalled();
	});

	it("rejects when the window is off screen", async () => {
		mockFrames(() => 255);
		await expect(
			waitForStillWindow({ x: 2000, y: 0, width: 300, height: 300 }, { timeoutMs: 4000 }),
		).rejects.toThrow(WINDOW_OFF_SCREEN_MESSAGE);
		expect(getSources).not.toHaveBeenCalled();
	});

	it("rejects when the screen cannot be captured", async () => {
		mockFrames(() => 255);
		getSources.mockResolvedValue([{ display_id: "1", thumbnail: { isEmpty: () => true } }]);
		await expect(waitForStillWindow(FRAME, { timeoutMs: 4000 })).rejects.toThrow(
			/Screen Recording permission/,
		);
	});

	it("samples the display the window is on, cropped from a small thumbnail", async () => {
		const getDisplayMatching = vi.fn(() => ({
			id: 2,
			bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
			size: { width: 1920, height: 1080 },
			scaleFactor: 1,
		}));
		getScreen.mockReturnValue({ getDisplayMatching });
		const other = thumbnail({ width: 576, height: 360 }, 255);
		const target = thumbnail({ width: 640, height: 360 }, 255);
		getSources.mockReset();
		getSources.mockResolvedValue([
			{ display_id: "1", thumbnail: other },
			{ display_id: "2", thumbnail: target },
		]);
		const result = waitForStillWindow(
			{ x: 1540.4, y: 100, width: 960, height: 540 },
			{ timeoutMs: 4000 },
		);
		await vi.advanceTimersByTimeAsync(1000);
		await expect(result).resolves.toMatchObject({ settled: true });
		expect(getDisplayMatching).toHaveBeenCalledWith({
			x: 1540,
			y: 100,
			width: 960,
			height: 540,
		});
		expect(getSources).toHaveBeenCalledWith({
			types: ["screen"],
			thumbnailSize: { width: 640, height: 360 },
		});
		expect(target.crop).toHaveBeenCalledWith({ x: 33, y: 33, width: 320, height: 180 });
		expect(other.crop).not.toHaveBeenCalled();
	});
});
