import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingFocusController, outsideRecordingRects } from "./recordingFocus";

const display = { x: 0, y: 0, width: 1600, height: 1000 };
const area = { x: 200, y: 100, width: 900, height: 650 };
const source = { id: "area:1", name: "Area", area };
const intersects = (a: typeof area, b: typeof area) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("outside recording geometry", () => {
	it("leaves the HUD, webcam and menus undimmed without covering the capture", () => {
		const controls = [
			{ x: 600, y: 900, width: 400, height: 60 },
			{ x: 100, y: 750, width: 200, height: 200 },
			{ x: 600, y: 680, width: 300, height: 180 },
		];
		const strips = outsideRecordingRects([display], area, controls);
		for (const rect of strips) {
			expect(intersects(rect, area)).toBe(false);
			for (const control of controls) expect(intersects(rect, control)).toBe(false);
		}
		for (let x = 0; x < display.width; x += 20) {
			for (let y = 0; y < display.height; y += 20) {
				const contains = (rect: typeof area) =>
					x >= rect.x &&
					x < rect.x + rect.width &&
					y >= rect.y &&
					y < rect.y + rect.height;
				expect(strips.some(contains)).toBe(![area, ...controls].some(contains));
			}
		}
	});
	it("covers precisely the exterior without touching recorded pixels or overlapping strips", () => {
		const strips = outsideRecordingRects([display], area);
		expect(strips).toHaveLength(4);
		expect(strips.reduce((sum, rect) => sum + rect.width * rect.height, 0)).toBe(
			display.width * display.height - area.width * area.height,
		);
		strips.forEach((rect, index) => {
			expect(intersects(rect, area)).toBe(false);
			strips.slice(index + 1).forEach((other) => expect(intersects(rect, other)).toBe(false));
		});
	});
	it("dims other displays including negative origins while keeping a spanning target clear", () => {
		const left = { x: -1600, y: 0, width: 1600, height: 1000 };
		const target = { x: -200, y: 100, width: 400, height: 500 };
		for (const rect of outsideRecordingRects([left, display], target))
			expect(intersects(rect, target)).toBe(false);
		expect(outsideRecordingRects([left, display], display)).toEqual([left]);
	});
	it("rounds fractional capture edges outward and ignores invalid targets", () => {
		const target = { x: 200.2, y: 100.7, width: 900.4, height: 650.1 };
		for (const rect of outsideRecordingRects([display], target))
			expect(intersects(rect, target)).toBe(false);
		expect(outsideRecordingRects([display], { ...area, width: Number.NaN })).toEqual([]);
	});
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
	const deps = { resolve: vi.fn().mockResolvedValue(area), show: vi.fn(), hide: vi.fn() };
	return { deps, controller: createRecordingFocusController(deps) };
}
it("persists across countdown to recording and paused intervals without closing the mask", async () => {
	const { deps, controller } = fixture();
	await controller.start(source);
	deps.hide.mockClear();
	await controller.start({ ...source });
	await vi.advanceTimersByTimeAsync(1000);
	expect(deps.hide).not.toHaveBeenCalled();
	expect(deps.show).toHaveBeenLastCalledWith(area);
	expect(vi.getTimerCount()).toBe(1);
	controller.stop();
	expect(deps.hide).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});
it("cancellation during async native lookup never creates a late mask or timer", async () => {
	const { deps, controller } = fixture();
	let finish!: (value: typeof area) => void;
	deps.resolve.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const pending = controller.start(source);
	controller.stop();
	finish(area);
	await pending;
	expect(deps.show).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
it("replaces the source safely even while a previous native lookup remains pending", async () => {
	const { deps, controller } = fixture();
	let finish!: (value: typeof area) => void;
	deps.resolve.mockReturnValueOnce(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const first = controller.start(source);
	const next = { x: 0, y: 0, width: 400, height: 300 };
	deps.resolve.mockResolvedValue(next);
	controller.sourceChanged({ id: "window:2:0", name: "Window" });
	await vi.advanceTimersByTimeAsync(0);
	expect(deps.show).toHaveBeenLastCalledWith(next);
	finish(area);
	await first;
	expect(deps.show).toHaveBeenLastCalledWith(next);
	expect(vi.getTimerCount()).toBe(1);
	controller.stop();
});
it("removes masks if the window disappears or bounds detection fails", async () => {
	const { deps, controller } = fixture();
	await controller.start(source);
	deps.hide.mockClear();
	deps.resolve.mockResolvedValue(null);
	await vi.advanceTimersByTimeAsync(250);
	expect(deps.hide).toHaveBeenCalledOnce();
	deps.resolve.mockRejectedValue(new Error("window closed"));
	await vi.advanceTimersByTimeAsync(250);
	expect(deps.hide).toHaveBeenCalledTimes(2);
	controller.stop();
});
it("does not dim the desktop when selecting a source before recording", async () => {
	const { deps, controller } = fixture();
	controller.sourceChanged(source);
	await vi.advanceTimersByTimeAsync(0);
	expect(deps.resolve).not.toHaveBeenCalled();
	expect(deps.show).not.toHaveBeenCalled();
	controller.sourceChanged(null);
	expect(vi.getTimerCount()).toBe(0);
});
