import type { CaptureStopResult } from "./ownerRecovery";

/** The renderer and owner recovery must join the same finalization operation. */
export class WindowsRecordingFinalizer {
	private pending: Promise<CaptureStopResult> | null = null;
	constructor(
		private hasStoppedVideo: () => boolean,
		private perform: (expectedDurationMs?: number) => Promise<CaptureStopResult>,
	) {}
	get needsFinish() {
		return this.pending !== null || this.hasStoppedVideo();
	}
	run(expectedDurationMs?: number): Promise<CaptureStopResult> {
		if (this.pending) return this.pending;
		if (!this.hasStoppedVideo())
			return Promise.resolve({
				success: false,
				message: "No native Windows video pending for mux",
			});
		return this.reserve(() => this.perform(expectedDurationMs));
	}
	/** Reserve before recovery I/O so another capture cannot replace its state. */
	recover(prepare: () => Promise<CaptureStopResult | null>): Promise<CaptureStopResult> {
		if (this.pending) return this.pending;
		return this.reserve(async () => {
			const recovered = await prepare();
			if (!recovered?.success)
				return (
					recovered ?? {
						success: false,
						message: "No recoverable native Windows recording output was found.",
					}
				);
			const finished = await this.perform();
			return { ...finished, ...(recovered.error ? { error: recovered.error } : {}) };
		});
	}
	private reserve(perform: () => Promise<CaptureStopResult>) {
		const operation = Promise.resolve().then(perform);
		this.pending = operation;
		const clear = () => {
			if (this.pending === operation) this.pending = null;
		};
		void operation.then(clear, clear);
		return operation;
	}
}
