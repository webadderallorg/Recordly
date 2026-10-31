import { VideoSource } from "pixi.js";

/** Own the GPU source for the lifetime of React's persistent video element. */
export class PreviewVideoSource {
	private video: HTMLVideoElement | null = null;
	private source: VideoSource | null = null;

	setVideo(video: HTMLVideoElement | null): void {
		if (video === this.video) return;

		if (this.source) {
			this.source.autoUpdate = false;
			this.source.destroy();
			this.source = null;
		}
		this.video = video;
	}

	getSource(): VideoSource {
		if (!this.video) throw new Error("Preview video element is not attached");
		this.source ??= new VideoSource({ resource: this.video, autoPlay: false });
		this.source.autoUpdate = true;
		// React can load another media URL into the same element.
		this.source.update();
		return this.source;
	}

	suspend(): void {
		if (!this.source) return;
		this.source.autoUpdate = false;
		this.source.unload();
	}
}
