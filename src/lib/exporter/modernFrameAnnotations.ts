import { Sprite, Texture } from "pixi.js";
import {
	type AnnotationRenderAssets,
	renderAnnotations,
	renderAnnotationToCanvas,
} from "./annotationRenderer";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { AnnotationSpriteEntry, ExportCompositeCanvasState } from "./modernFrameTypes";
import { configureHighQuality2DContext } from "./modernFrameUtils";
import { SourceRedactionCanvas } from "./sourceRedaction";

/** Owns annotations resources for one export renderer. */
export class FrameAnnotations {
	constructor(
		private readonly context: Pick<
			FrameRenderContext,
			"config" | "scene" | "motion" | "geometry" | "captions"
		>,
	) {}

	readonly sourceRedaction = new SourceRedactionCanvas();

	redactSourceFrame(frame: VideoFrame, timeMs: number): HTMLCanvasElement | null {
		return this.sourceRedaction.render(frame, {
			width: frame.displayWidth || this.context.config.videoWidth,
			height: frame.displayHeight || this.context.config.videoHeight,
			annotations: this.context.config.annotationRegions ?? [],
			timeMs,
			cropRegion: this.context.config.cropRegion,
		});
	}

	annotationAssets: AnnotationRenderAssets | null = null;

	annotationScaleFactor = 1;

	annotationSprites: AnnotationSpriteEntry[] = [];

	exportCompositeCanvas: ExportCompositeCanvasState | null = null;

	outputCanvasOverride: HTMLCanvasElement | null = null;

	calculateAnnotationScaleFactor(): number {
		const previewWidth = this.context.config.previewWidth || 1920;
		const previewHeight = this.context.config.previewHeight || 1080;
		return (
			(this.context.config.width / previewWidth +
				this.context.config.height / previewHeight) /
			2
		);
	}

	hasActiveBlurAnnotations(timeMs: number): boolean {
		return (this.context.config.annotationRegions ?? []).some(
			(annotation) =>
				annotation.type === "blur" &&
				timeMs >= annotation.startMs &&
				timeMs <= annotation.endMs,
		);
	}

	ensureExportCompositeCanvas(): ExportCompositeCanvasState | null {
		const targetWidth = Math.max(1, Math.ceil(this.context.config.width));
		const targetHeight = Math.max(1, Math.ceil(this.context.config.height));

		if (
			this.exportCompositeCanvas &&
			this.exportCompositeCanvas.canvas.width === targetWidth &&
			this.exportCompositeCanvas.canvas.height === targetHeight
		) {
			return this.exportCompositeCanvas;
		}

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;

		const context = configureHighQuality2DContext(canvas.getContext("2d"));
		if (!context) {
			return null;
		}

		this.exportCompositeCanvas = {
			canvas,
			context,
		};

		return this.exportCompositeCanvas;
	}

	async composeBlurAnnotationFrame(timeMs: number): Promise<void> {
		if (!this.context.scene.app) {
			this.outputCanvasOverride = null;
			return;
		}

		const compositeState = this.ensureExportCompositeCanvas();
		if (!compositeState) {
			this.outputCanvasOverride = null;
			return;
		}

		const { canvas, context } = compositeState;
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(this.context.scene.app.canvas as HTMLCanvasElement, 0, 0);

		await renderAnnotations(
			context,
			this.context.config.annotationRegions ?? [],
			this.context.config.width,
			this.context.config.height,
			timeMs,
			this.annotationScaleFactor,
			this.annotationAssets ?? undefined,
			{
				scale: this.context.motion.animationState.appliedScale,
				x: this.context.motion.animationState.x,
				y: this.context.motion.animationState.y,
			},
			this.context.geometry.layoutCache?.maskRect,
		);

		this.context.captions.drawCaptionOverlay(context);
		this.outputCanvasOverride = canvas;
	}

	async setupAnnotationLayer(): Promise<void> {
		if (!this.context.scene.annotationContainer) {
			return;
		}

		for (const entry of this.annotationSprites) {
			entry.sprite.destroy({ texture: false, textureSource: false });
			entry.texture.destroy(true);
		}
		this.annotationSprites = [];
		this.context.scene.annotationContainer.removeChildren();

		const annotations = [...(this.context.config.annotationRegions ?? [])].sort(
			(first, second) => first.zIndex - second.zIndex,
		);

		for (const annotation of annotations) {
			const annotationRect = this.context.geometry.layoutCache?.maskRect ?? {
				x: 0,
				y: 0,
				width: this.context.config.width,
				height: this.context.config.height,
			};
			const x = annotationRect.x + (annotation.position.x / 100) * annotationRect.width;
			const y = annotationRect.y + (annotation.position.y / 100) * annotationRect.height;
			const width = (annotation.size.width / 100) * annotationRect.width;
			const height = (annotation.size.height / 100) * annotationRect.height;

			if (width <= 0 || height <= 0) {
				continue;
			}

			const canvas = await renderAnnotationToCanvas(
				annotation,
				width,
				height,
				this.annotationScaleFactor,
				this.annotationAssets ?? undefined,
			);
			if (!canvas) {
				continue;
			}

			const texture = Texture.from(canvas);
			const sprite = new Sprite(texture);
			sprite.position.set(x, y);
			sprite.visible = false;
			this.context.scene.annotationContainer.addChild(sprite);
			this.annotationSprites.push({ annotation, sprite, texture });
		}
	}

	updateAnnotationLayer(currentTimeMs: number): void {
		for (const entry of this.annotationSprites) {
			entry.sprite.visible =
				currentTimeMs >= entry.annotation.startMs &&
				currentTimeMs <= entry.annotation.endMs;
		}
	}

	async renderOutput(timeMs: number): Promise<void> {
		if (this.hasActiveBlurAnnotations(timeMs)) {
			const annotationContainerVisible =
				this.context.scene.annotationContainer?.visible ?? true;
			const captionContainerVisible = this.context.scene.captionContainer?.visible ?? true;

			if (this.context.scene.annotationContainer) {
				this.context.scene.annotationContainer.visible = false;
			}
			if (this.context.scene.captionContainer) {
				this.context.scene.captionContainer.visible = false;
			}

			this.context.scene.app!.render();

			if (this.context.scene.annotationContainer) {
				this.context.scene.annotationContainer.visible = annotationContainerVisible;
			}
			if (this.context.scene.captionContainer) {
				this.context.scene.captionContainer.visible = captionContainerVisible;
			}

			await this.composeBlurAnnotationFrame(timeMs);
			return;
		}

		this.outputCanvasOverride = null;
		this.context.scene.app!.render();
	}
}
