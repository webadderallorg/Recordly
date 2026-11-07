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
	it("bounds backlog and stops accepting chunks when storage stalls", async () => {
		const { api, writer, fail } = setup();
		writer.write(new Blob([new Uint8Array(33 * 1024 * 1024)]));
		expect(fail).toHaveBeenCalledOnce();
		expect((await writer.finish()).success).toBe(false);
		expect(api.openRecordingFileStream).not.toHaveBeenCalled();
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
});
