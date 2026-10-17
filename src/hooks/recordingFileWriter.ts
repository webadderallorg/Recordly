type StoredVideoResult = { success: boolean; path?: string; message?: string };

export type RecordingFileStreamApi = Pick<
	Window["electronAPI"],
	| "openRecordingFileStream"
	| "appendRecordingFileStream"
	| "closeRecordingFileStream"
	| "discardRecordingFileStream"
>;

export type FinishedRecording =
	| { kind: "file"; result: StoredVideoResult }
	| { kind: "memory"; chunks: Blob[] }
	| { kind: "empty" };

/**
 * Sends MediaRecorder chunks to a file in the main process as they arrive, so a
 * long recording never has to sit in renderer memory (issue #1139). Chunks are
 * written one at a time, in order.
 *
 * If the file cannot be opened, the chunks are kept in memory instead and
 * returned by finish(), so the caller can store them the old way. If a write
 * fails later, what is already on disk is kept, later chunks are dropped, and
 * finish() reports the recording as failed, so the caller tells the user.
 */
export class RecordingFileWriter {
	private streamId: string | null = null;
	private writes: Promise<void> = Promise.resolve();
	private memoryChunks: Blob[] = [];
	private streamUnavailable = false;
	private writeFailed = false;
	private cancelled = false;

	constructor(
		private readonly api: RecordingFileStreamApi,
		private readonly getFileName: () => string,
		private readonly label: string,
	) {}

	/** Marks this recording as cancelled; the recorder's onstop reads it via isCancelled. */
	cancel() {
		this.cancelled = true;
	}

	get isCancelled() {
		return this.cancelled;
	}

	write(chunk: Blob) {
		this.writes = this.writes
			.then(() => this.writeChunk(chunk))
			.catch((error) => {
				this.writeFailed = true;
				console.error(`Failed to write ${this.label} recording to disk:`, error);
			});
	}

	/** Waits for pending writes, then closes the file under `fileName`. */
	async finish(fileName: string): Promise<FinishedRecording> {
		await this.writes;
		const streamId = this.streamId;
		this.streamId = null;
		if (streamId) {
			const result = await this.api.closeRecordingFileStream(streamId, fileName);
			if (this.writeFailed && result.success) {
				return {
					kind: "file",
					result: {
						success: false,
						path: result.path,
						message: `Part of the ${this.label} recording could not be written to disk. The part that was written is at ${result.path}.`,
					},
				};
			}
			return { kind: "file", result };
		}
		const chunks = this.memoryChunks;
		this.memoryChunks = [];
		return chunks.length > 0 ? { kind: "memory", chunks } : { kind: "empty" };
	}

	/** Waits for pending writes, then deletes the file and drops any chunks in memory. */
	async discard() {
		await this.writes;
		const streamId = this.streamId;
		this.streamId = null;
		this.memoryChunks = [];
		if (streamId) {
			await this.api.discardRecordingFileStream(streamId);
		}
	}

	private async writeChunk(chunk: Blob) {
		if (this.streamUnavailable) {
			this.memoryChunks.push(chunk);
			return;
		}
		if (this.writeFailed) {
			return;
		}
		if (!this.streamId) {
			const opened = await this.api.openRecordingFileStream(this.getFileName());
			if (!opened.success || !opened.streamId) {
				console.warn(
					`Could not stream ${this.label} recording to disk; keeping it in memory:`,
					opened.error,
				);
				this.streamUnavailable = true;
				this.memoryChunks.push(chunk);
				return;
			}
			this.streamId = opened.streamId;
		}
		const appended = await this.api.appendRecordingFileStream(
			this.streamId,
			await chunk.arrayBuffer(),
		);
		if (!appended.success) {
			// Keep what is already on disk; later chunks would fail the same way.
			this.writeFailed = true;
			console.error(`Failed to write ${this.label} recording to disk:`, appended.error);
		}
	}
}
