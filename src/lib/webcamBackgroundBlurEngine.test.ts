import { describe, expect, it, vi } from "vitest";
import { WebcamBackgroundBlurEngine, type WebcamBlurRuntime } from "./webcamBackgroundBlurEngine";

function createRuntime(): WebcamBlurRuntime {
	return {
		segmenter: {
			segmentPeople: vi.fn(async () => [{ mask: "person" }]),
			dispose: vi.fn(),
		},
		drawBokehEffect: vi.fn(async () => undefined),
	};
}

describe("WebcamBackgroundBlurEngine", () => {
	it("lazy-loads once and caches repeated frame timestamps", async () => {
		const runtime = createRuntime();
		const loader = vi.fn(async () => runtime);
		const canvas = {} as HTMLCanvasElement;
		const engine = new WebcamBackgroundBlurEngine({ loader, canvasFactory: () => canvas });
		const source = {} as HTMLVideoElement;

		await expect(engine.processFrame(source, { amount: 12, frameKey: 100 })).resolves.toBe(
			canvas,
		);
		await expect(engine.processFrame(source, { amount: 12, frameKey: 100 })).resolves.toBe(
			canvas,
		);

		expect(loader).toHaveBeenCalledTimes(1);
		expect(runtime.segmenter.segmentPeople).toHaveBeenCalledTimes(1);
		expect(runtime.drawBokehEffect).toHaveBeenCalledWith(
			canvas,
			source,
			[{ mask: "person" }],
			0.5,
			12,
			3,
			false,
		);
	});

	it("serializes concurrent inference calls", async () => {
		let active = 0;
		let maximumActive = 0;
		const runtime = createRuntime();
		runtime.segmenter.segmentPeople = vi.fn(async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await Promise.resolve();
			active -= 1;
			return [];
		});
		const engine = new WebcamBackgroundBlurEngine({
			loader: async () => runtime,
			canvasFactory: () => ({}) as HTMLCanvasElement,
		});

		await Promise.all([
			engine.processFrame({} as HTMLVideoElement, { amount: 8, frameKey: 1 }),
			engine.processFrame({} as HTMLVideoElement, { amount: 8, frameKey: 2 }),
		]);

		expect(maximumActive).toBe(1);
	});

	it("discards a stale result after invalidation", async () => {
		let finish: (() => void) | undefined;
		const runtime = createRuntime();
		runtime.segmenter.segmentPeople = vi.fn(
			() =>
				new Promise<unknown[]>((resolve) => {
					finish = () => resolve([]);
				}),
		);
		const engine = new WebcamBackgroundBlurEngine({
			loader: async () => runtime,
			canvasFactory: () => ({}) as HTMLCanvasElement,
		});
		const pending = engine.processFrame({} as HTMLVideoElement, { amount: 10, frameKey: 1 });
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		engine.invalidate();
		finish?.();

		await expect(pending).resolves.toBeNull();
		expect(runtime.drawBokehEffect).not.toHaveBeenCalled();
	});

	it("enters an error state, falls back, and can retry", async () => {
		const runtime = createRuntime();
		const loader = vi
			.fn<() => Promise<WebcamBlurRuntime>>()
			.mockRejectedValueOnce(new Error("model missing"))
			.mockResolvedValue(runtime);
		const engine = new WebcamBackgroundBlurEngine({
			loader,
			canvasFactory: () => ({}) as HTMLCanvasElement,
		});

		await expect(
			engine.processFrame({} as HTMLVideoElement, { amount: 12, frameKey: 1 }),
		).resolves.toBeNull();
		expect(engine.getSnapshot().status).toBe("error");

		engine.retry();
		await expect(
			engine.processFrame({} as HTMLVideoElement, { amount: 12, frameKey: 2 }),
		).resolves.not.toBeNull();
		expect(loader).toHaveBeenCalledTimes(2);
	});
});
