import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { ForwardFrameSource } from "./forwardFrameSource";

/** Restarts the forward decoder when an uploaded webcam reaches a new loop. */
export class WebcamFrameSource {
	private source: ForwardFrameSource;
	private lastTime = 0;
	private cancelled = false;
	duration: number | undefined;

	constructor(
		private readonly url: string,
		private readonly loop: boolean,
		private readonly signal?: AbortSignal,
	) {
		this.source = new ForwardFrameSource(signal);
	}

	async initialize(): Promise<void> {
		const metadata = await this.source.initialize(this.url);
		this.duration = getEffectiveVideoStreamDurationSeconds(metadata);
	}

	async getFrameAtTime(time: number): Promise<VideoFrame | null> {
		if (this.loop && time + 0.001 < this.lastTime) {
			const previous = this.source;
			previous.destroy();
			if (this.cancelled) return null;
			const next = new ForwardFrameSource(this.signal);
			this.source = next;
			try {
				await this.initialize();
			} finally {
				if (this.cancelled) next.destroy();
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

	destroy(): void {
		this.cancel();
		this.source.destroy();
	}
}
