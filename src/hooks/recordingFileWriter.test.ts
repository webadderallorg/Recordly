import { describe, expect, it, vi } from "vitest";
import { type RecordingFileStreamApi, RecordingFileWriter } from "./recordingFileWriter";

function fakeApi(overrides: Partial<RecordingFileStreamApi> = {}) {
	const written: string[] = [];
	const api = {
		openRecordingFileStream: vi.fn(async () => ({ success: true, streamId: "s1" })),
		appendRecordingFileStream: vi.fn(async (_id: string, chunk: ArrayBuffer) => {
			written.push(new TextDecoder().decode(chunk));
			return { success: true };
		}),
		closeRecordingFileStream: vi.fn(async (_id: string, fileName: string) => ({
			success: true,
			path: `/recordings/${fileName}`,
		})),
		discardRecordingFileStream: vi.fn(async () => ({ success: true })),
		...overrides,
	} satisfies RecordingFileStreamApi;
	return { api, written };
}

const chunk = (text: string) => new Blob([text]);

describe("RecordingFileWriter", () => {
	it("opens one file and appends every chunk in order", async () => {
		const { api, written } = fakeApi();
		const writer = new RecordingFileWriter(api, () => "rec.webm", "screen");
		for (const text of ["a", "b", "c"]) writer.write(chunk(text));

		const finished = await writer.finish("rec.webm");

		expect(api.openRecordingFileStream).toHaveBeenCalledTimes(1);
		expect(api.openRecordingFileStream).toHaveBeenCalledWith("rec.webm");
		expect(written).toEqual(["a", "b", "c"]);
		expect(api.closeRecordingFileStream).toHaveBeenCalledWith("s1", "rec.webm");
		expect(finished).toEqual({
			kind: "file",
			result: { success: true, path: "/recordings/rec.webm" },
		});
	});

	it("keeps chunks in memory when the file cannot be opened", async () => {
		const { api } = fakeApi({
			openRecordingFileStream: vi.fn(async () => ({ success: false, error: "EACCES" })),
		});
		const writer = new RecordingFileWriter(api, () => "rec.webm", "webcam");
		const a = chunk("a");
		const b = chunk("b");
		writer.write(a);
		writer.write(b);

		const finished = await writer.finish("rec.webm");

		expect(api.openRecordingFileStream).toHaveBeenCalledTimes(1);
		expect(api.appendRecordingFileStream).not.toHaveBeenCalled();
		expect(finished).toEqual({ kind: "memory", chunks: [a, b] });
	});

	it("keeps what is on disk and drops later chunks after a failed write", async () => {
		const { api, written } = fakeApi();
		api.appendRecordingFileStream
			.mockImplementationOnce(async (_id, data) => {
				written.push(new TextDecoder().decode(data));
				return { success: true };
			})
			.mockImplementationOnce(async () => ({ success: false, error: "ENOSPC" }));
		const writer = new RecordingFileWriter(api, () => "rec.webm", "screen");
		for (const text of ["a", "b", "c"]) writer.write(chunk(text));

		const finished = await writer.finish("rec.webm");

		expect(api.appendRecordingFileStream).toHaveBeenCalledTimes(2);
		expect(written).toEqual(["a"]);
		expect(finished).toMatchObject({ kind: "file", result: { success: false } });
	});

	it("reports failure, not success, when sending a chunk throws", async () => {
		const { api, written } = fakeApi();
		api.appendRecordingFileStream.mockImplementationOnce(async () => {
			throw new Error("IPC channel closed");
		});
		const writer = new RecordingFileWriter(api, () => "rec.webm", "webcam");
		for (const text of ["a", "b"]) writer.write(chunk(text));

		const finished = await writer.finish("rec.webm");

		expect(written).toEqual([]);
		expect(finished).toEqual({
			kind: "file",
			result: {
				success: false,
				path: "/recordings/rec.webm",
				message:
					"Part of the webcam recording could not be written to disk. The part that was written is at /recordings/rec.webm.",
			},
		});
	});

	it("remembers a cancel on the writer itself", () => {
		const { api } = fakeApi();
		const first = new RecordingFileWriter(api, () => "rec-1.webm", "screen");
		const second = new RecordingFileWriter(api, () => "rec-2.webm", "screen");

		first.cancel();

		expect(first.isCancelled).toBe(true);
		expect(second.isCancelled).toBe(false);
	});

	it("deletes the file on discard after pending writes finish", async () => {
		const { api, written } = fakeApi();
		const writer = new RecordingFileWriter(api, () => "rec.webm", "webcam");
		writer.write(chunk("a"));

		await writer.discard();

		expect(written).toEqual(["a"]);
		expect(api.discardRecordingFileStream).toHaveBeenCalledWith("s1");
		expect(api.closeRecordingFileStream).not.toHaveBeenCalled();
	});

	it("reports an empty recording without opening a file", async () => {
		const { api } = fakeApi();
		const writer = new RecordingFileWriter(api, () => "rec.webm", "screen");

		expect(await writer.finish("rec.webm")).toEqual({ kind: "empty" });
		expect(api.openRecordingFileStream).not.toHaveBeenCalled();
	});
});
