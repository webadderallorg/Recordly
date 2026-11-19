import { CanvasSource, Texture, type VideoSource } from "pixi.js";
import { SourceRedactionCanvas } from "@/lib/exporter/sourceRedaction";

type RedactionOptions = Omit<Parameters<SourceRedactionCanvas["render"]>[1], "width" | "height">;

/** Composes source privacy masks before any camera filter can sample the frame. */
export class PreviewFrameTexture {
	private readonly videoTexture: Texture;
	private redactedTexture: Texture<CanvasSource> | null = null;

	constructor(
		private readonly videoSource: VideoSource,
		private readonly redaction: Pick<
			SourceRedactionCanvas,
			"render" | "dispose"
		> = new SourceRedactionCanvas(),
	) {
		// Only the compositor may upload frames. An asynchronous video upload
		// must not put a new raw frame under the previous annotation timestamp.
		videoSource.autoUpdate = false;
		this.videoTexture = new Texture({ source: videoSource });
	}

	update(video: HTMLVideoElement, options: RedactionOptions): Texture {
		const canvas = this.redaction.render(video, {
			...options,
			width: video.videoWidth,
			height: video.videoHeight,
		});
		if (!canvas) {
			this.videoSource.update();
			return this.videoTexture;
		}

		if (this.redactedTexture?.source.resource !== canvas) {
			this.redactedTexture?.destroy(true);
			this.redactedTexture = new Texture({
				source: new CanvasSource({ resource: canvas, resolution: 1, autoDensity: false }),
			});
		}
		this.redactedTexture.source.update();
		return this.redactedTexture;
	}

	dispose(): void {
		this.videoTexture.destroy(false);
		this.redactedTexture?.destroy(true);
		this.redactedTexture = null;
		this.redaction.dispose();
	}
}
