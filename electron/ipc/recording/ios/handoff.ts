import type { CommittedIOSRecording } from "../../../../src/shared/iosCapture";

/** Concurrent recovery callers and native completion share one editor delivery. */
export class IOSRecordingHandoff {
	private readonly deliveries = new Map<string, Promise<void>>();
	constructor(private readonly deliver: (recording: CommittedIOSRecording) => Promise<void>) {}
	run(recording: CommittedIOSRecording): Promise<void> {
		const existing = this.deliveries.get(recording.sessionId);
		if (existing) return existing;
		const work = Promise.resolve().then(() => this.deliver(recording));
		this.deliveries.set(recording.sessionId, work);
		void work.then(
			() => {
				if (this.deliveries.size > 64)
					this.deliveries.delete(this.deliveries.keys().next().value!);
			},
			() => {
				this.deliveries.delete(recording.sessionId);
			},
		);
		return work;
	}
}
