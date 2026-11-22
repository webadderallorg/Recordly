import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { ForwardFrameSource } from "./forwardFrameSource";

/** Restarts the forward decoder when an uploaded webcam reaches a new loop. */
export class WebcamFrameSource {
	private source = new ForwardFrameSource();
	private lastTime = 0;
	private cancelled = false;
	duration: number | undefined;

	constructor(
		private readonly url: string,
		private readonly loop: boolean,
	) {}

	async initialize(): Promise<void> {
		const metadata = await this.source.initialize(this.url);
		this.duration = getEffectiveVideoStreamDurationSeconds(metadata);
	}

	async getFrameAtTime(time: number): Promise<VideoFrame | null> {
		if (this.loop && time + 0.001 < this.lastTime) {
			const previous = this.source;
			previous.cancel();
			await previous.destroy();
			if (this.cancelled) return null;
			const next = new ForwardFrameSource();
			this.source = next;
			try {
				await this.initialize();
			} finally {
				if (this.cancelled) await next.destroy();
			}
		}
		if (this.cancelled) return null;
		this.lastTime = time;
		return this.source.getFrameAtTime(time);
	}

	cancel(): void {
		this.cancelled = true;
		this.source.cancel();
	}

	async destroy(): Promise<void> {
		this.cancel();
		await this.source.destroy();
	}
}
