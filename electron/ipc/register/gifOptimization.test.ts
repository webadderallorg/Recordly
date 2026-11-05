import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), compress: vi.fn(), binary: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock("../export/gifOptimization", () => ({
	compressGifBuffer: mocks.compress,
	MAX_GIF_OPTIMIZATION_BYTES: 512 * 1024 * 1024,
}));
vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: mocks.binary }));

import { registerGifOptimizationHandlers } from "./gifOptimization";

const owner = (id = 42) =>
	Object.assign(new EventEmitter(), { id, isDestroyed: vi.fn(() => false) });
let sender: ReturnType<typeof owner>;
let optimize: (event: { sender: typeof sender }, id: unknown, data: unknown) => Promise<unknown>;
let cancel: (event: { sender: typeof sender }, id: unknown) => unknown;
const gif = () => new ArrayBuffer(14);
beforeEach(() => {
	mocks.handle.mockReset();
	mocks.compress.mockReset();
	mocks.binary.mockReset();
	mocks.binary.mockReturnValue("/bundled/ffmpeg");
	mocks.compress.mockResolvedValue(new Uint8Array([71, 73, 70]));
	sender = owner();
	registerGifOptimizationHandlers();
	optimize = mocks.handle.mock.calls.find(([name]) => name === "optimize-gif")![1];
	cancel = mocks.handle.mock.calls.find(([name]) => name === "cancel-gif-optimization")![1];
});
it("returns encoded bytes using the bundled binary and a cancellation signal", async () => {
	expect(await optimize({ sender }, "gif-123", gif())).toEqual({
		success: true,
		data: new Uint8Array([71, 73, 70]),
	});
	expect(mocks.compress).toHaveBeenCalledWith(expect.any(Uint8Array), {
		ffmpegPath: "/bundled/ffmpeg",
		signal: expect.any(AbortSignal),
	});
	expect(sender.listenerCount("destroyed")).toBe(0);
});
it.each([
	["../escape", gif()],
	["", gif()],
	["x".repeat(129), gif()],
	[7, gif()],
	["gif-123", "/local/private.gif"],
	["gif-123", new Uint8Array(14)],
	["gif-123", new ArrayBuffer(2)],
])("rejects invalid request %s", async (requestId, data) => {
	expect(await optimize({ sender }, requestId, data)).toMatchObject({ success: false });
	expect(mocks.compress).not.toHaveBeenCalled();
});
it("rejects destroyed requesters", async () => {
	sender.isDestroyed.mockReturnValue(true);
	expect(await optimize({ sender }, "gif-1", gif())).toMatchObject({ success: false });
	expect(mocks.compress).not.toHaveBeenCalled();
});
it("allows only one active compression per owner and releases the reservation", async () => {
	let finish!: (value: Uint8Array) => void;
	mocks.compress.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const pending = optimize({ sender }, "first", gif());
	expect(await optimize({ sender }, "second", gif())).toMatchObject({ success: false });
	finish(new Uint8Array());
	await pending;
	expect(await optimize({ sender }, "third", gif())).toMatchObject({ success: true });
});
it("bounds concurrent owners", async () => {
	const finishes: Array<() => void> = [];
	mocks.compress.mockImplementation(
		() =>
			new Promise((resolve) => {
				finishes.push(() => resolve(new Uint8Array()));
			}),
	);
	const first = optimize({ sender }, "first", gif());
	const second = optimize({ sender: owner(2) }, "second", gif());
	expect(await optimize({ sender: owner(3) }, "third", gif())).toMatchObject({ success: false });
	for (const finish of finishes) finish();
	await Promise.all([first, second]);
});
it("cancels only the matching request owned by the sender", async () => {
	let signal!: AbortSignal;
	mocks.compress.mockImplementation(
		(_input, options) =>
			new Promise((_resolve, reject) => {
				signal = options.signal;
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			}),
	);
	const pending = optimize({ sender }, "first", gif());
	cancel({ sender: owner(7) }, "first");
	cancel({ sender }, "other");
	expect(signal.aborted).toBe(false);
	cancel({ sender }, "first");
	expect(signal.aborted).toBe(true);
	expect(await pending).toMatchObject({ success: false, error: "GIF optimization canceled" });
	expect(sender.listenerCount("destroyed")).toBe(0);
});
it("aborts pending work when the owner is destroyed", async () => {
	mocks.compress.mockImplementation(
		(_input, options) =>
			new Promise((_resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(options.signal.reason), {
					once: true,
				});
			}),
	);
	const pending = optimize({ sender }, "first", gif());
	sender.emit("destroyed");
	expect(await pending).toMatchObject({ success: false, error: "GIF optimization canceled" });
	expect(sender.listenerCount("destroyed")).toBe(0);
});
it("does not return bytes if cancellation races with completion", async () => {
	let finish!: (value: Uint8Array) => void;
	mocks.compress.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const pending = optimize({ sender }, "first", gif());
	cancel({ sender }, "first");
	finish(new Uint8Array([1]));
	expect(await pending).toMatchObject({ success: false, error: "GIF optimization canceled" });
});
it("releases listeners and ownership after errors", async () => {
	mocks.compress.mockRejectedValueOnce(new Error("Encoding failed"));
	expect(await optimize({ sender }, "first", gif())).toEqual({
		success: false,
		error: "Encoding failed",
	});
	expect(sender.listenerCount("destroyed")).toBe(0);
	expect(await optimize({ sender }, "second", gif())).toMatchObject({ success: true });
});
