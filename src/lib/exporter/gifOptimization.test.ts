import { afterEach, describe, expect, it, vi } from "vitest";
import { optimizeGif } from "./gifOptimization";

function bytes(size: number, width = 800, height = 600) {
	const data = new Uint8Array(size);
	data.set(new TextEncoder().encode("GIF89a"));
	data[6] = width & 0xff;
	data[7] = width >> 8;
	data[8] = height & 0xff;
	data[9] = height >> 8;
	data[size - 1] = 0x3b;
	return data;
}
function bridge(run: (...args: unknown[]) => unknown) {
	const cancel = vi.fn(async () => ({ success: true }));
	vi.stubGlobal("window", { electronAPI: { optimizeGif: run, cancelGifOptimization: cancel } });
	return cancel;
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
describe("FFmpeg GIF compression", () => {
	it("returns a smaller GIF and calculated actual savings", async () => {
		const run = vi.fn(async () => ({ success: true, data: bytes(60) }));
		bridge(run);
		const output = await optimizeGif(new Blob([bytes(100)]));
		expect(output).toMatchObject({
			originalBytes: 100,
			optimizedBytes: 60,
			savedBytes: 40,
			reductionPercent: 40,
			status: "optimized",
			targetBytes: 10,
			targetReached: false,
		});
		expect(run.mock.calls[0][0]).toEqual(expect.any(String));
	});
	it.each([100, 101])("reports the 10% target accurately for %i output bytes", async (size) => {
		bridge(async () => ({ success: true, data: bytes(size, 320, 240) }));
		const output = await optimizeGif(new Blob([bytes(1000)]));
		expect(output).toMatchObject({
			originalWidth: 800,
			originalHeight: 600,
			outputWidth: 320,
			outputHeight: 240,
			targetBytes: 100,
			targetReached: size === 100,
			status: "optimized",
		});
	});
	it("does not invent dimensions for an invalid original header", async () => {
		bridge(async () => ({ success: true, data: bytes(60, 320, 240) }));
		const output = await optimizeGif(new Blob([new Uint8Array(100)]));
		expect(output.originalWidth).toBeUndefined();
		expect(output.originalHeight).toBeUndefined();
		expect(output.outputWidth).toBe(320);
	});
	it.each([100, 120])("retains original when candidate has %i bytes", async (size) => {
		bridge(async () => ({ success: true, data: bytes(size) }));
		const original = new Blob([bytes(100)]);
		const output = await optimizeGif(original);
		expect(output.blob).toBe(original);
		expect(output.status).toBe("unchanged");
		expect(output.savedBytes).toBe(0);
		expect(output.outputWidth).toBe(800);
		expect(output.outputHeight).toBe(600);
		expect(output.targetReached).toBe(false);
	});
	it.each(["native-failed", "invalid-gif", "reject"])("retains original for %s", async (mode) => {
		bridge(async () => {
			if (mode === "reject") throw new Error("Native unavailable");
			return { success: mode !== "native-failed", data: new Uint8Array(3) };
		});
		const original = new Blob([bytes(100)]);
		const output = await optimizeGif(original);
		expect(output.blob).toBe(original);
		expect(output.status).toBe("failed");
		expect(output.targetReached).toBe(false);
	});
	it("reports unavailable outside the desktop bridge", async () => {
		expect((await optimizeGif(new Blob([bytes(100)]))).status).toBe("failed");
	});
	it("does not start a pre-aborted compression", async () => {
		const run = vi.fn();
		bridge(run);
		const controller = new AbortController();
		controller.abort();
		await expect(optimizeGif(new Blob([bytes(100)]), controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(run).not.toHaveBeenCalled();
	});
	it("cancels its owned native request and settles promptly", async () => {
		const run = vi.fn(() => new Promise(() => undefined));
		const cancel = bridge(run);
		const controller = new AbortController();
		const pending = optimizeGif(new Blob([bytes(100)]), controller.signal);
		await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledWith(run.mock.calls[0][0]);
	});
	it("bounds an unresponsive bridge and retains the original", async () => {
		vi.useFakeTimers();
		const cancel = bridge(() => new Promise(() => undefined));
		const original = new Blob([bytes(100)]);
		const pending = optimizeGif(original);
		await vi.advanceTimersByTimeAsync(65000);
		expect((await pending).blob).toBe(original);
		expect(cancel).toHaveBeenCalledOnce();
	});
});
