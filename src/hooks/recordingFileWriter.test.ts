import { describe, expect, it, vi } from "vitest";
import { RecordingFileWriter } from "./recordingFileWriter";

function setup() {
	const api = {
		openRecordingFileStream: vi.fn(async () => ({
			success: true,
			streamId: "1",
			path: "/partial.webm",
		})),
		appendRecordingFileStream: vi.fn(async () => ({ success: true })),
		closeRecordingFileStream: vi.fn(async () => ({ success: true, path: "/final.mp4" })),
		discardRecordingFileStream: vi.fn(async () => ({ success: true })),
	};
	const fail = vi.fn();
	return {
		api,
		fail,
		writer: new RecordingFileWriter(
			api,
			"recording-1-webcam.webm",
			"video/webm;codecs=h264",
			fail,
		),
	};
}
describe("recording chunk persistence", () => {
	it("writes in recorder event order and finishes only after writes", async () => {
		const { api, writer } = setup();
		writer.write(new Blob(["a"]));
		writer.write(new Blob(["bc"]));
		expect(await writer.finish(100)).toEqual({ success: true, path: "/final.mp4" });
		expect(api.openRecordingFileStream).toHaveBeenCalledOnce();
		expect(
			api.appendRecordingFileStream.mock.calls.map((call) =>
				new TextDecoder().decode(call[1]),
			),
		).toEqual(["a", "bc"]);
		expect(api.closeRecordingFileStream).toHaveBeenCalledWith("1", 100);
	});
	it("reports disk failures with the path returned by close", async () => {
		const { api, writer, fail } = setup();
		api.appendRecordingFileStream.mockRejectedValueOnce(new Error("Disk full"));
		writer.write(new Blob(["a"]));
		const result = await writer.finish();
		expect(result.success).toBe(false);
		expect(result.path).toBe("/final.mp4");
		expect(result.message).toBe("Disk full Partial recording: /final.mp4");
		expect(fail).toHaveBeenCalledOnce();
	});
	it("reports file open failures instead of keeping an unbounded memory fallback", async () => {
		const { api, writer } = setup();
		api.openRecordingFileStream.mockRejectedValueOnce(new Error("No space"));
		writer.write(new Blob(["a"]));
		expect(await writer.finish()).toMatchObject({ success: false, message: "No space" });
		expect(api.appendRecordingFileStream).not.toHaveBeenCalled();
	});
	it("accepts a single large chunk on an empty queue and drains it in ordered bounded IPC writes", async () => {
		const { api, writer, fail } = setup();
		const slices = Array.from({ length: 9 }, (_, index) =>
			new Uint8Array((index === 8 ? 1 : 4) * 1024 * 1024).fill(index),
		);
		writer.write(new Blob(slices));
		await expect(writer.finish(100)).resolves.toEqual({ success: true, path: "/final.mp4" });
		expect(fail).not.toHaveBeenCalled();
		expect(api.openRecordingFileStream).toHaveBeenCalledOnce();
		expect(api.appendRecordingFileStream.mock.calls).toHaveLength(9);
		for (const [index, call] of api.appendRecordingFileStream.mock.calls.entries()) {
			const bytes = new Uint8Array(call[1]);
			expect(bytes.byteLength).toBe(slices[index].byteLength);
			expect(bytes[0]).toBe(index);
			expect(bytes.at(-1)).toBe(index);
		}
		expect(api.closeRecordingFileStream.mock.invocationCallOrder[0]).toBeGreaterThan(
			api.appendRecordingFileStream.mock.invocationCallOrder.at(-1)!,
		);
	});
	it.each([
		16, 33,
	])("bounds queued backlog while a %s MiB chunk is already stalled", async (sizeMiB) => {
		const { api, writer, fail } = setup();
		let release!: () => void;
		api.appendRecordingFileStream.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ success: true });
				}),
		);
		writer.write(new Blob([new Uint8Array(sizeMiB * 1024 * 1024)]));
		await vi.waitFor(() => expect(api.appendRecordingFileStream).toHaveBeenCalledOnce());
		if (sizeMiB === 16) writer.write(new Blob([new Uint8Array(16 * 1024 * 1024)]));
		expect(fail).not.toHaveBeenCalled();
		writer.write(new Blob(["overflow"]));
		writer.write(new Blob(["ignored after failure"]));
		expect(fail).toHaveBeenCalledOnce();
		const finished = writer.finish();
		expect(api.closeRecordingFileStream).not.toHaveBeenCalled();
		release();
		await expect(finished).resolves.toMatchObject({ success: false, path: "/final.mp4" });
		expect((await finished).message).toContain("Partial recording: /final.mp4");
		expect(api.appendRecordingFileStream).toHaveBeenCalledOnce();
		expect(api.closeRecordingFileStream).toHaveBeenCalledOnce();
	});
	it("stops draining a large chunk and discards its stream when cancelled", async () => {
		const { api, writer, fail } = setup();
		let release!: () => void;
		api.appendRecordingFileStream.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ success: true });
				}),
		);
		writer.write(new Blob([new Uint8Array(33 * 1024 * 1024)]));
		await vi.waitFor(() => expect(api.appendRecordingFileStream).toHaveBeenCalledOnce());
		writer.cancel();
		const finished = writer.finish();
		release();
		await expect(finished).resolves.toEqual({
			success: false,
			message: "Recording cancelled.",
		});
		expect(fail).not.toHaveBeenCalled();
		expect(api.appendRecordingFileStream).toHaveBeenCalledOnce();
		expect(api.discardRecordingFileStream).toHaveBeenCalledExactlyOnceWith("1");
		expect(api.closeRecordingFileStream).not.toHaveBeenCalled();
	});
	it("splits large recorder chunks into bounded IPC messages", async () => {
		const { api, writer } = setup();
		writer.write(new Blob([new Uint8Array(9 * 1024 * 1024)]));
		await writer.finish();
		expect(api.appendRecordingFileStream.mock.calls.map((call) => call[1].byteLength)).toEqual([
			4 * 1024 * 1024,
			4 * 1024 * 1024,
			1024 * 1024,
		]);
	});
	it("discards a cancelled writer without cancelling the next session", async () => {
		const { api, writer } = setup();
		writer.write(new Blob(["a"]));
		await writer.finish();
		const cancelled = new RecordingFileWriter(api, "recording-2.webm", "video/webm");
		cancelled.cancel();
		cancelled.write(new Blob(["ignored"]));
		await cancelled.discard();
		const next = new RecordingFileWriter(api, "recording-3.webm", "video/webm");
		next.write(new Blob(["next"]));
		expect((await next.finish()).success).toBe(true);
		expect(api.openRecordingFileStream).toHaveBeenCalledTimes(2);
	});
	it("propagates a rejected discard response and preserves identity for a later cleanup retry", async () => {
		const { api, writer } = setup();
		writer.write(new Blob(["private recording"]));
		await vi.waitFor(() => expect(api.appendRecordingFileStream).toHaveBeenCalledOnce());
		api.discardRecordingFileStream.mockResolvedValueOnce({
			success: false,
			error: "Cannot unlink",
		});
		await expect(writer.discard()).rejects.toThrow(
			"Cannot unlink Partial recording: /partial.webm",
		);
		expect(writer.isCancelled).toBe(true);
		await writer.discard();
		expect(api.discardRecordingFileStream).toHaveBeenCalledTimes(2);
	});
	it("returns a cancellation cleanup failure without rejecting and allows a later cleanup retry", async () => {
		const { api, writer } = setup();
		writer.write(new Blob(["private recording"]));
		await vi.waitFor(() => expect(api.appendRecordingFileStream).toHaveBeenCalledOnce());
		writer.cancel();
		api.discardRecordingFileStream.mockResolvedValueOnce({
			success: false,
			error: "Cannot unlink",
		});
		await expect(writer.finish()).resolves.toEqual({
			success: false,
			path: "/partial.webm",
			message: "Cannot unlink Partial recording: /partial.webm",
		});
		expect(api.closeRecordingFileStream).not.toHaveBeenCalled();
		await expect(writer.finish()).resolves.toEqual({
			success: false,
			message: "Recording cancelled.",
		});
		expect(api.discardRecordingFileStream).toHaveBeenCalledTimes(2);
		await writer.discard();
		expect(api.discardRecordingFileStream).toHaveBeenCalledTimes(2);
	});
});
