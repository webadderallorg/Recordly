import type { FileHandle } from "node:fs/promises";
import fs from "node:fs/promises";

type RecordingFileStream = {
	path: string;
	ownerId: number;
	handle: FileHandle;
	bytesWritten: number;
	writeQueue: Promise<void>;
	writeError: Error | null;
};

export type ClosedRecordingFileStream = {
	path: string;
	bytesWritten: number;
};

/** A close that failed; the part written so far is still on disk at `partialPath`. */
export class RecordingFileCloseError extends Error {
	constructor(
		message: string,
		readonly partialPath: string,
	) {
		super(message);
		this.name = "RecordingFileCloseError";
	}
}

/**
 * Runs the finalize step for a recording that is already on disk. If it throws, the
 * result still names the file, so the caller can tell the user where the recording is.
 */
export async function finalizeKeepingPath<T>(
	filePath: string,
	finalize: (filePath: string) => Promise<T>,
): Promise<T | { success: false; path: string; message: string; error: string }> {
	try {
		return await finalize(filePath);
	} catch (error) {
		console.error("Failed to finalize the recording:", error);
		return {
			success: false,
			path: filePath,
			message: `The recording was saved to ${filePath}, but it could not be finalized.`,
			error: String(error),
		};
	}
}

/** The parts of Electron's WebContents that closeWhenOwnerGoes uses. */
export type RecordingFileStreamOwner = Pick<Electron.WebContents, "id" | "on" | "removeListener">;

/**
 * Appends MediaRecorder chunks to a file as they arrive, so a long recording
 * never has to sit in renderer memory. Each stream belongs to the webContents
 * that opened it; when that renderer dies, its streams are closed and the
 * partial files are kept on disk.
 */
export class RecordingFileStreams {
	private readonly streams = new Map<string, RecordingFileStream>();
	/** One token per watch of an owner; a new token means the owner went away in between. */
	private readonly ownerWatches = new Map<number, object>();
	private nextStreamId = 1;

	/**
	 * Closes the owner's streams when its renderer crashes, is destroyed, or loads a new
	 * page (a reload drops the renderer's writer without telling main). The files are kept.
	 * Listeners are added once per owner and removed when they fire.
	 */
	closeWhenOwnerGoes(
		owner: RecordingFileStreamOwner,
		onClosed: (closed: ClosedRecordingFileStream[]) => void,
	) {
		if (this.ownerWatches.has(owner.id)) {
			return;
		}
		this.ownerWatches.set(owner.id, {});
		const ownerId = owner.id;
		const stopWatching = () => {
			this.ownerWatches.delete(ownerId);
			owner.removeListener("destroyed", onGone);
			owner.removeListener("render-process-gone", onGone);
			owner.removeListener("did-start-navigation", onNavigation);
		};
		const onGone = () => {
			stopWatching();
			void this.closeAllForOwner(ownerId).then(onClosed);
		};
		const onNavigation = (
			details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
		) => {
			if (details?.isMainFrame && !details.isSameDocument) {
				onGone();
			}
		};
		owner.on("destroyed", onGone);
		owner.on("render-process-gone", onGone);
		owner.on("did-start-navigation", onNavigation);
	}

	async open(filePath: string, ownerId: number): Promise<string> {
		const watch = this.ownerWatches.get(ownerId);
		const handle = await fs.open(filePath, "w");
		if (watch && this.ownerWatches.get(ownerId) !== watch) {
			// The owner went away while the file was opening (and may be watched again by a
			// new page); its streams were already closed, so this one would be orphaned.
			await handle.close();
			throw new Error("Recording renderer went away");
		}
		const streamId = String(this.nextStreamId++);
		this.streams.set(streamId, {
			path: filePath,
			ownerId,
			handle,
			bytesWritten: 0,
			writeQueue: Promise.resolve(),
			writeError: null,
		});
		return streamId;
	}

	append(streamId: string, ownerId: number, data: Uint8Array): Promise<void> {
		const stream = this.getOwnedStream(streamId, ownerId);
		if (stream.writeError) {
			return Promise.reject(stream.writeError);
		}

		// Queue synchronously so chunks land in the order they were sent.
		const position = stream.bytesWritten;
		stream.bytesWritten += data.byteLength;
		stream.writeQueue = stream.writeQueue.then(async () => {
			if (stream.writeError) {
				return;
			}
			try {
				let offset = 0;
				while (offset < data.byteLength) {
					const { bytesWritten } = await stream.handle.write(
						data,
						offset,
						data.byteLength - offset,
						position + offset,
					);
					offset += bytesWritten;
				}
			} catch (error) {
				stream.writeError = error instanceof Error ? error : new Error(String(error));
			}
		});

		return stream.writeQueue.then(() => {
			if (stream.writeError) {
				throw stream.writeError;
			}
		});
	}

	/**
	 * Flushes pending writes and closes the file. When `targetPath` differs from
	 * the path the stream was opened with, the file is renamed to it.
	 */
	async close(
		streamId: string,
		ownerId: number,
		targetPath?: string,
	): Promise<ClosedRecordingFileStream> {
		const stream = this.getOwnedStream(streamId, ownerId);
		this.streams.delete(streamId);
		await this.closeHandle(stream);

		if (stream.writeError) {
			throw new RecordingFileCloseError(stream.writeError.message, stream.path);
		}

		let finalPath = stream.path;
		if (targetPath && targetPath !== stream.path) {
			try {
				await fs.rename(stream.path, targetPath);
			} catch (error) {
				throw new RecordingFileCloseError(String(error), stream.path);
			}
			finalPath = targetPath;
		}

		return { path: finalPath, bytesWritten: stream.bytesWritten };
	}

	/** Closes the file and deletes it, for a recording the user cancelled. */
	async discard(streamId: string, ownerId: number): Promise<void> {
		const stream = this.getOwnedStream(streamId, ownerId);
		this.streams.delete(streamId);
		await this.closeHandle(stream);
		await fs.rm(stream.path, { force: true });
	}

	/** Closes every stream a renderer opened and keeps what was written. */
	async closeAllForOwner(ownerId: number): Promise<ClosedRecordingFileStream[]> {
		const owned = [...this.streams.entries()].filter(
			([, stream]) => stream.ownerId === ownerId,
		);
		const closed: ClosedRecordingFileStream[] = [];
		for (const [streamId, stream] of owned) {
			this.streams.delete(streamId);
			try {
				await this.closeHandle(stream);
			} catch (error) {
				// Keep closing the others; this file keeps whatever reached the disk.
				console.error(`Failed to close recording file ${stream.path}:`, error);
			}
			closed.push({ path: stream.path, bytesWritten: stream.bytesWritten });
		}
		return closed;
	}

	private getOwnedStream(streamId: string, ownerId: number): RecordingFileStream {
		const stream = this.streams.get(streamId);
		if (!stream || stream.ownerId !== ownerId) {
			throw new Error("Unknown recording file stream");
		}
		return stream;
	}

	private async closeHandle(stream: RecordingFileStream) {
		await stream.writeQueue;
		await stream.handle.close();
	}
}
