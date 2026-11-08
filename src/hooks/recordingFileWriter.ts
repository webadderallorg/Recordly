type Result = { success: boolean; path?: string; error?: string; message?: string };
type Api = Pick<
	Window["electronAPI"],
	| "openRecordingFileStream"
	| "appendRecordingFileStream"
	| "closeRecordingFileStream"
	| "discardRecordingFileStream"
>;

/** Serial chunk writes with a bounded backlog. A storage failure never falls back to an unbounded Blob. */
export class RecordingFileWriter {
	private queue = Promise.resolve();
	private streamId: string | undefined;
	private pendingBytes = 0;
	private failure: string | undefined;
	private cancelled = false;
	private path: string | undefined;
	constructor(
		private api: Api,
		private fileName: string,
		private mimeType: string,
		private onFailure: (message: string) => void = () => undefined,
	) {}
	private fail(error: unknown) {
		if (this.failure) return;
		this.failure = error instanceof Error ? error.message : String(error);
		this.onFailure(this.failure);
	}
	write(chunk: Blob) {
		if (this.cancelled || this.failure || !chunk.size) return;
		// A single delayed recorder Blob drains in slices; bound additional queued data.
		if (this.pendingBytes > 0 && this.pendingBytes + chunk.size > 32 * 1024 * 1024) {
			this.fail(
				new Error(
					"Recording storage cannot keep up. The partial recording will be preserved.",
				),
			);
			return;
		}
		this.pendingBytes += chunk.size;
		this.queue = this.queue
			.then(async () => {
				if (this.cancelled || this.failure) return;
				if (!this.streamId) {
					const opened = await this.api.openRecordingFileStream(
						this.fileName,
						this.mimeType,
					);
					if (!opened.success || !opened.streamId)
						throw new Error(opened.error || "Could not open the recording file.");
					this.streamId = opened.streamId;
					this.path = opened.path;
				}
				// Limit individual IPC payloads even when Chromium produces a large chunk after a stall.
				for (
					let offset = 0;
					offset < chunk.size && !this.cancelled && !this.failure;
					offset += 4 * 1024 * 1024
				) {
					const result = await this.api.appendRecordingFileStream(
						this.streamId,
						await chunk.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer(),
					);
					if (!result.success)
						throw new Error(result.error || "Could not write the recording file.");
				}
			})
			.catch((error) => this.fail(error))
			.finally(() => {
				this.pendingBytes -= chunk.size;
			});
	}
	cancel() {
		this.cancelled = true;
	}
	get isCancelled() {
		return this.cancelled;
	}
	async finish(durationMs?: number): Promise<Result> {
		await this.queue;
		if (this.cancelled) {
			try {
				await this.discard();
			} catch (error) {
				return {
					success: false,
					path: this.path,
					message: error instanceof Error ? error.message : String(error),
				};
			}
			return { success: false, message: "Recording cancelled." };
		}
		if (!this.streamId)
			return { success: false, message: this.failure || "No video frames were captured." };
		const result = await this.api.closeRecordingFileStream(this.streamId, durationMs);
		this.streamId = undefined;
		if (this.failure || !result.success)
			return {
				success: false,
				path: result.path || this.path,
				message: `${this.failure || result.message || result.error || "Could not save the complete recording."}${result.path || this.path ? ` Partial recording: ${result.path || this.path}` : ""}`,
			};
		return result;
	}
	async discard() {
		this.cancelled = true;
		await this.queue;
		if (this.streamId) {
			const id = this.streamId;
			const result = await this.api.discardRecordingFileStream(id);
			if (!result.success)
				throw new Error(
					`${result.error || "Could not discard the recording."}${this.path ? ` Partial recording: ${this.path}` : ""}`,
				);
			this.streamId = undefined;
		}
	}
}
