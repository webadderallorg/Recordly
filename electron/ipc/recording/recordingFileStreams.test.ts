import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	finalizeKeepingPath,
	RecordingFileCloseError,
	type RecordingFileStreamOwner,
	RecordingFileStreams,
} from "./recordingFileStreams";

const OWNER = 1;
const OTHER_OWNER = 2;

function bytes(...values: number[]) {
	return new Uint8Array(values);
}

describe("RecordingFileStreams", () => {
	let dir: string;
	let streams: RecordingFileStreams;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-file-streams-"));
		streams = new RecordingFileStreams();
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("writes chunks to disk in the order they were sent", async () => {
		const filePath = path.join(dir, "recording-1-webcam.mp4");
		const streamId = await streams.open(filePath, OWNER);

		// Fire without awaiting each write, like back-to-back IPC messages.
		await Promise.all([
			streams.append(streamId, OWNER, bytes(1, 2)),
			streams.append(streamId, OWNER, bytes(3)),
			streams.append(streamId, OWNER, bytes(4, 5, 6)),
		]);

		expect([...(await fs.readFile(filePath))]).toEqual([1, 2, 3, 4, 5, 6]);

		const closed = await streams.close(streamId, OWNER);
		expect(closed).toEqual({ path: filePath, bytesWritten: 6 });
	});

	it("renames the file on close when the final name differs", async () => {
		const openedPath = path.join(dir, "recording-1-webcam.mp4");
		const finalPath = path.join(dir, "recording-2-webcam.mp4");
		const streamId = await streams.open(openedPath, OWNER);
		await streams.append(streamId, OWNER, bytes(7));

		const closed = await streams.close(streamId, OWNER, finalPath);

		expect(closed.path).toBe(finalPath);
		expect([...(await fs.readFile(finalPath))]).toEqual([7]);
		await expect(fs.access(openedPath)).rejects.toThrow();
	});

	it("rejects appends and closes from another renderer", async () => {
		const streamId = await streams.open(path.join(dir, "recording-1-webcam.mp4"), OWNER);

		expect(() => streams.append(streamId, OTHER_OWNER, bytes(1))).toThrow(
			"Unknown recording file stream",
		);
		await expect(streams.close(streamId, OTHER_OWNER)).rejects.toThrow(
			"Unknown recording file stream",
		);
	});

	it("keeps written data when the owning renderer goes away", async () => {
		const filePath = path.join(dir, "recording-1-webcam.mp4");
		const otherPath = path.join(dir, "recording-2-webcam.mp4");
		const streamId = await streams.open(filePath, OWNER);
		const otherStreamId = await streams.open(otherPath, OTHER_OWNER);
		await streams.append(streamId, OWNER, bytes(1, 2, 3));

		const closed = await streams.closeAllForOwner(OWNER);

		expect(closed).toEqual([{ path: filePath, bytesWritten: 3 }]);
		expect([...(await fs.readFile(filePath))]).toEqual([1, 2, 3]);
		expect(() => streams.append(streamId, OWNER, bytes(4))).toThrow(
			"Unknown recording file stream",
		);
		// Streams owned by other renderers stay open.
		await streams.append(otherStreamId, OTHER_OWNER, bytes(9));
		await streams.close(otherStreamId, OTHER_OWNER);
		expect([...(await fs.readFile(otherPath))]).toEqual([9]);
	});

	it("reports where the partial file is when the close fails", async () => {
		const filePath = path.join(dir, "recording-1-webcam.mp4");
		const streamId = await streams.open(filePath, OWNER);
		await streams.append(streamId, OWNER, bytes(1, 2, 3));

		const closing = streams.close(
			streamId,
			OWNER,
			path.join(dir, "missing-folder", "recording-1-webcam.mp4"),
		);

		await expect(closing).rejects.toBeInstanceOf(RecordingFileCloseError);
		await expect(closing).rejects.toMatchObject({ partialPath: filePath });
		expect([...(await fs.readFile(filePath))]).toEqual([1, 2, 3]);
	});

	it("deletes the file when a stream is discarded", async () => {
		const filePath = path.join(dir, "recording-1-webcam.mp4");
		const streamId = await streams.open(filePath, OWNER);
		await streams.append(streamId, OWNER, bytes(1, 2));

		await streams.discard(streamId, OWNER);

		await expect(fs.access(filePath)).rejects.toThrow();
		await expect(streams.close(streamId, OWNER)).rejects.toThrow(
			"Unknown recording file stream",
		);
	});

	it("does not accept a stream id twice after close", async () => {
		const streamId = await streams.open(path.join(dir, "recording-1-webcam.mp4"), OWNER);
		await streams.close(streamId, OWNER);

		await expect(streams.close(streamId, OWNER)).rejects.toThrow(
			"Unknown recording file stream",
		);
	});

	describe("closeWhenOwnerGoes", () => {
		// A stand-in for the renderer's WebContents: same events, no Electron.
		function owner() {
			return Object.assign(new EventEmitter(), { id: OWNER }) as EventEmitter &
				RecordingFileStreamOwner;
		}
		const EVENTS = ["destroyed", "render-process-gone", "did-start-navigation"];
		const listeners = (o: EventEmitter) => EVENTS.map((e) => o.listenerCount(e));

		for (const [label, fire] of [
			[
				"crashes",
				(o: EventEmitter) => o.emit("render-process-gone", {}, { reason: "crashed" }),
			],
			["is destroyed", (o: EventEmitter) => o.emit("destroyed")],
			[
				"reloads",
				(o: EventEmitter) =>
					o.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false }),
			],
		] as const) {
			it(`closes the owner's streams and keeps the file when the renderer ${label}`, async () => {
				const filePath = path.join(dir, "recording-1-webcam.mp4");
				const streamId = await streams.open(filePath, OWNER);
				await streams.append(streamId, OWNER, bytes(1, 2));
				const o = owner();
				const onClosed = vi.fn();
				streams.closeWhenOwnerGoes(o, onClosed);

				fire(o);

				await vi.waitFor(() =>
					expect(onClosed).toHaveBeenCalledWith([{ path: filePath, bytesWritten: 2 }]),
				);
				expect([...(await fs.readFile(filePath))]).toEqual([1, 2]);
				expect(listeners(o)).toEqual([0, 0, 0]);
			});
		}

		it("ignores in-page and subframe navigation", async () => {
			const streamId = await streams.open(path.join(dir, "recording-1-webcam.mp4"), OWNER);
			const o = owner();
			const onClosed = vi.fn();
			streams.closeWhenOwnerGoes(o, onClosed);

			o.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
			o.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });

			await streams.append(streamId, OWNER, bytes(7));
			expect(onClosed).not.toHaveBeenCalled();
			expect(listeners(o)).toEqual([1, 1, 1]);
		});

		it("closes a file that finishes opening after its owner went away", async () => {
			const o = owner();
			streams.closeWhenOwnerGoes(o, () => {});
			const filePath = path.join(dir, "recording-1-webcam.mp4");
			const opening = streams.open(filePath, OWNER);
			o.emit("render-process-gone", {}, { reason: "crashed" });

			await expect(opening).rejects.toThrow("Recording renderer went away");
			expect(await streams.closeAllForOwner(OWNER)).toEqual([]);
		});

		it("closes a file opened by a page that went away, even after a new page is watched", async () => {
			const o = owner();
			streams.closeWhenOwnerGoes(o, () => {});
			const opening = streams.open(path.join(dir, "recording-1-webcam.mp4"), OWNER);
			o.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
			// The new page starts recording before the old page's open finished.
			streams.closeWhenOwnerGoes(o, () => {});

			await expect(opening).rejects.toThrow("Recording renderer went away");
			expect(await streams.closeAllForOwner(OWNER)).toEqual([]);
		});

		it("adds one set of listeners per owner, and again after it fired", () => {
			const o = owner();
			for (let i = 0; i < 5; i++) streams.closeWhenOwnerGoes(o, () => {});
			expect(listeners(o)).toEqual([1, 1, 1]);

			o.emit("destroyed");
			streams.closeWhenOwnerGoes(o, () => {});
			expect(listeners(o)).toEqual([1, 1, 1]);
		});
	});
});

describe("finalizeKeepingPath", () => {
	it("returns the finalize result when it works", async () => {
		const result = await finalizeKeepingPath("/rec/recording-1.webm", async (filePath) => ({
			success: true,
			path: filePath,
		}));
		expect(result).toEqual({ success: true, path: "/rec/recording-1.webm" });
	});

	it("still names the file when finalizing throws", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await finalizeKeepingPath("/rec/recording-1.webm", async () => {
			throw new Error("ffprobe missing");
		});
		error.mockRestore();
		expect(result).toMatchObject({ success: false, path: "/rec/recording-1.webm" });
	});
});
