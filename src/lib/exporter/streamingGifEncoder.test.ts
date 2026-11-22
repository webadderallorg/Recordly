import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gifWorkerCount, StreamingGifEncoder } from "./streamingGifEncoder";

const workers: FakeWorker[] = [];
class FakeWorker {
	onmessage?: (event: { data: unknown }) => void;
	onerror?: () => void;
	onmessageerror?: () => void;
	job?: { index: number; data: Uint8Array; last: boolean };
	terminate = vi.fn();
	constructor() {
		workers.push(this);
	}
	postMessage(job: FakeWorker["job"], transfers: Transferable[]) {
		expect(transfers).toEqual([job!.data.buffer]);
		expect(job!.last).toBe(false);
		this.job = job;
	}
	complete() {
		const index = this.job!.index;
		this.job = undefined;
		// Include padding to ensure assembly discards unused page bytes.
		this.onmessage!({
			data: { index, data: [new Uint8Array([65 + index, 0, 0, 0])], cursor: 1, pageSize: 4 },
		});
	}
}

let canvas: { width: number; height: number };
let readback: ReturnType<typeof vi.fn>;
beforeEach(() => {
	workers.length = 0;
	canvas = { width: 0, height: 0 };
	readback = vi.fn(() => ({ data: new Uint8ClampedArray(16) }));
	vi.stubGlobal("Worker", FakeWorker);
	vi.stubGlobal("navigator", { hardwareConcurrency: 5 });
	vi.stubGlobal("document", {
		createElement: () =>
			Object.assign(canvas, {
				getContext: () => ({
					drawImage: vi.fn(),
					fillRect: vi.fn(),
					getImageData: readback,
				}),
			}),
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
const create = () =>
	new StreamingGifEncoder({ width: 2, height: 2, repeat: 0, workerScript: "gif.worker.js" });
const source = {} as HTMLCanvasElement;

describe("bounded streaming GIF encoder", () => {
	it("applies backpressure before readback and transfers pixels instead of retaining raw frames", async () => {
		const encoder = create();
		for (let i = 0; i < 4; i++) await encoder.addFrame(source, 40);
		expect(readback).toHaveBeenCalledTimes(4);
		const next = encoder.addFrame(source, 40);
		await Promise.resolve();
		expect(readback).toHaveBeenCalledTimes(4);
		workers[0].complete();
		await next;
		expect(readback).toHaveBeenCalledTimes(5);
		// A long animation never increases the number of pixel-owning workers.
		for (let i = 5; i < 100; i++) {
			workers.find((worker) => worker.job)!.complete();
			await encoder.addFrame(source, 40);
			expect(workers.filter((worker) => worker.job)).toHaveLength(4);
		}
		encoder.abort();
		expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
		expect(canvas.width).toBe(0);
	});

	it("assembles out-of-order results in frame order with exactly one trailer and no padding", async () => {
		const encoder = create();
		await encoder.addFrame(source, 40);
		await encoder.addFrame(source, 40);
		const result = encoder.finish();
		workers.find((worker) => worker.job?.index === 1)!.complete();
		workers.find((worker) => worker.job?.index === 0)!.complete();
		expect([...new Uint8Array(await (await result).arrayBuffer())]).toEqual([65, 66, 0x3b]);
		expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
	});

	it("settles blocked producers when canceled", async () => {
		const encoder = create();
		for (let i = 0; i < 4; i++) await encoder.addFrame(source, 40);
		const rejected = expect(encoder.addFrame(source, 40)).rejects.toMatchObject({
			name: "AbortError",
		});
		encoder.abort();
		await rejected;
		expect(readback).toHaveBeenCalledTimes(4);
	});

	it("rejects finish when a worker crashes rather than hanging", async () => {
		const encoder = create();
		await encoder.addFrame(source, 40);
		const rejected = expect(encoder.finish()).rejects.toThrow("worker failed");
		workers[0].onerror!();
		await rejected;
		expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
	});

	it("bounds stalled worker jobs and terminates the entire pool", async () => {
		vi.useFakeTimers();
		const encoder = create();
		await encoder.addFrame(source, 40);
		const rejected = expect(encoder.finish()).rejects.toThrow("timed out");
		await vi.advanceTimersByTimeAsync(60_000);
		await rejected;
		expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
	});

	it("reduces parallel raw frames for high resolutions and small CPUs", () => {
		expect(gifWorkerCount(1280, 720, 16)).toBe(8);
		expect(gifWorkerCount(1920, 1080, 10)).toBe(8);
		expect(gifWorkerCount(3840, 2160, 16)).toBe(2);
		expect(gifWorkerCount(1280, 720, 2)).toBe(1);
	});
});
