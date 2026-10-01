import { type Container, Matrix, RenderTexture } from "pixi.js";
import type { NativeCursorSpritePosition } from "./nativeStaticLayoutOverlays";

/**
 * Renderer-side cursor ROI sprite primitive.
 *
 * A cursor-sprite export captures only the cursor region instead of doing a
 * full-canvas RGBA readback. The cursor is still rendered by the existing Pixi
 * cursor container (`PixiCursorOverlay`); this module only packages that
 * rendered region into a fixed-size RGBA frame strip plus a per-output-frame
 * positions array that downstream native composition consumes (manifest kind
 * `cursor-sprite`).
 *
 * Design notes:
 * - The ROI is derived from the cursor container's actual world bounds after
 *   the overlay has been updated for a frame, expanded for filter padding,
 *   rotation/sway extents, click rings and motion blur, then clamped safely to
 *   the output canvas. If a safe ROI cannot be established the capture reports
 *   an explicit `unavailable` result so the caller keeps the existing
 *   full-canvas path.
 * - The frame strip is a fixed-size RGBA canvas for the whole export: each
 *   frame's content is top-left aligned, the strip width/height grow only to
 *   the maximum seen (never clipping requested pixels), and the per-frame
 *   position records that frame's top-left output coordinate.
 * - Capture renders only the cursor container into a bounded RenderTexture and
 *   reads that texture back. The existing full-canvas capture path is
 *   untouched. Alpha/z-order and top-down orientation are identical to the
 *   existing overlay contract because the same container is rendered with the
 *   same world transform the full-canvas path would use.
 * - On WebGPU, calling renderer.clear() outside a render frame leaves the
 *   internal commandEncoder unset and crashes with "Cannot read properties of
 *   undefined (reading 'beginRenderPass')". We render with clear: true instead
 *   and emit a zeroed buffer when the cursor is hidden.
 */

export interface CursorRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Bounded expansion applied around the measured cursor bounds before capture. */
export interface CursorSpriteExpansion {
	/** Covers filter blur padding / shadow padding. */
	filterBlurPadding: number;
	/** Extra padding for rotation/sway extents. */
	rotationSwayPadding: number;
	/** Extra padding for click-effect rings. */
	clickRingPadding: number;
	/** Extra padding for motion-blur trails. */
	motionBlurPadding: number;
}

/** Conservative default expansion; safe when cursor size/effects are unknown. */
export const DEFAULT_CURSOR_SPRITE_EXPANSION: CursorSpriteExpansion = {
	filterBlurPadding: 24,
	rotationSwayPadding: 16,
	clickRingPadding: 44,
	motionBlurPadding: 64,
};

/**
 * Computes the fixed streaming cursor-sprite strip size (square) from the
 * cursor config: twice the sprite extent (dotRadius * cursorSize *
 * viewportScale * styleMultiplier, doubled to cover wide cursors and anchor
 * extremes) plus the full effect/filter expansion padding, clamped to the
 * output canvas. Shared by the exporter precompute and the streaming-sprite
 * tests so both always agree on the strip geometry.
 */
export function computeCursorSpriteStripSize(options: {
	dotRadius: number;
	cursorSize?: number;
	viewportScale: number;
	styleSizeMultiplier: number;
	outputWidth: number;
	outputHeight: number;
	cursorMotionBlur?: number;
	cursorSway?: number;
	cursorClickEffect?: string;
}): { width: number; height: number } {
	const expansion = buildCursorSpriteExpansionForConfig({
		cursorSize: options.cursorSize,
		cursorMotionBlur: options.cursorMotionBlur,
		cursorSway: options.cursorSway,
		cursorClickEffect: options.cursorClickEffect,
	});
	const scaledH =
		options.dotRadius *
		(options.cursorSize ?? 1.4) *
		options.viewportScale *
		options.styleSizeMultiplier;
	const halfExtent = Math.max(1, Math.ceil(scaledH * 2));
	const totalPadding = cursorSpriteTotalPadding(expansion);
	return {
		width: Math.max(
			1,
			Math.min(options.outputWidth, Math.ceil(2 * (halfExtent + totalPadding))),
		),
		height: Math.max(
			1,
			Math.min(options.outputHeight, Math.ceil(2 * (halfExtent + totalPadding))),
		),
	};
}

/**
 * Builds the bounded cursor-sprite expansion from the export cursor config.
 * Shared by the live capturer (modernFrameRenderer) and the streaming-sprite
 * precompute (ModernVideoExporter) so both always agree on the ROI padding.
 */
export function buildCursorSpriteExpansionForConfig(options: {
	cursorSize?: number;
	cursorMotionBlur?: number;
	cursorSway?: number;
	cursorClickEffect?: string;
}): CursorSpriteExpansion {
	const sizeScale = Math.max(0.5, (options.cursorSize ?? 1.4) / 1.4);
	const motionActive = (options.cursorMotionBlur ?? 0) > 0;
	const swayActive = (options.cursorSway ?? 0) > 0;
	const clickActive = (options.cursorClickEffect ?? "none") !== "none";
	return {
		filterBlurPadding: Math.ceil(DEFAULT_CURSOR_SPRITE_EXPANSION.filterBlurPadding * sizeScale),
		rotationSwayPadding:
			Math.ceil(DEFAULT_CURSOR_SPRITE_EXPANSION.rotationSwayPadding * sizeScale) *
			(swayActive ? 1 : 0),
		clickRingPadding: clickActive
			? Math.ceil(DEFAULT_CURSOR_SPRITE_EXPANSION.clickRingPadding * sizeScale)
			: 8,
		motionBlurPadding: motionActive
			? Math.ceil(DEFAULT_CURSOR_SPRITE_EXPANSION.motionBlurPadding * sizeScale)
			: 8,
	};
}

export type CursorSpriteRoiResult =
	| { available: true; roi: CursorRect }
	| { available: false; reason: string };

export interface CursorSpriteCaptureResult {
	captured: boolean;
	/**
	 * Unavailable only when a safe ROI could not be established for this frame
	 * or the session is closed; the caller must keep the full-canvas path.
	 */
	unavailableReason?: string;
	/** Top-left output-canvas coordinate where this frame's sprite is placed. */
	position?: NativeCursorSpritePosition;
}

/** Finished fixed-size RGBA frame strip plus per-output-frame positions. */
export interface CursorSpriteStripData {
	width: number;
	height: number;
	frameCount: number;
	/** Fixed-size strip (width*height*4 per frame, frames concatenated). */
	frames: Uint8Array;
	/** Exactly one top-left output position per frame, in ascending index. */
	positions: readonly NativeCursorSpritePosition[];
}

interface CursorSpriteFrameRecord {
	position: NativeCursorSpritePosition;
	width: number;
	height: number;
	data: Uint8Array;
	/** Content signature this frame was rendered from, or null when unknown. */
	contentSignature?: string | null;
}

/** Minimal pixi renderer surface the capturer needs, for deterministic tests. */
export interface CursorSpritePixelInfo {
	pixels: Uint8Array | Uint8ClampedArray;
	width: number;
	height: number;
}

export interface CursorSpriteRenderer {
	render(options: {
		container: Container;
		target: RenderTexture;
		transform: Matrix;
		clear: boolean;
	}): void;
	extract: {
		pixels(options: { target: RenderTexture }): CursorSpritePixelInfo;
	};
}

export interface CursorSpriteCapturerOptions {
	renderer: CursorSpriteRenderer;
	cursorContainer: Container;
	outputWidth: number;
	outputHeight: number;
	expansion: CursorSpriteExpansion;
	/**
	 * Optional precomputed bounding size for the fixed strip. When provided the
	 * strip is never larger than this (still clamped to the canvas); otherwise
	 * the strip grows to the maximum actual ROI seen.
	 */
	maxSpriteWidth?: number;
	maxSpriteHeight?: number;
}

export function isValidCursorBounds(bounds: CursorRect): boolean {
	return (
		Number.isFinite(bounds.x) &&
		Number.isFinite(bounds.y) &&
		Number.isFinite(bounds.width) &&
		Number.isFinite(bounds.height) &&
		bounds.width > 0 &&
		bounds.height > 0
	);
}

export function cursorSpriteTotalPadding(expansion: CursorSpriteExpansion): number {
	return Math.max(
		0,
		(Number.isFinite(expansion.filterBlurPadding) ? expansion.filterBlurPadding : 0) +
			(Number.isFinite(expansion.rotationSwayPadding) ? expansion.rotationSwayPadding : 0) +
			(Number.isFinite(expansion.clickRingPadding) ? expansion.clickRingPadding : 0) +
			(Number.isFinite(expansion.motionBlurPadding) ? expansion.motionBlurPadding : 0),
	);
}

/** Expands bounds by every effect padding, aligned to whole pixels. */
export function expandCursorBounds(
	bounds: CursorRect,
	expansion: CursorSpriteExpansion,
): CursorRect {
	const pad = cursorSpriteTotalPadding(expansion);
	return {
		x: Math.floor(bounds.x - pad),
		y: Math.floor(bounds.y - pad),
		width: Math.ceil(bounds.width + 2 * pad),
		height: Math.ceil(bounds.height + 2 * pad),
	};
}

/** Clamps a ROI so it stays within the output canvas (at least 1px kept). */
export function clampCursorRoiToCanvas(
	roi: CursorRect,
	outputWidth: number,
	outputHeight: number,
): CursorRect {
	const minX = Math.max(0, Math.floor(roi.x));
	const minY = Math.max(0, Math.floor(roi.y));
	const maxRight = Math.min(outputWidth, Math.ceil(roi.x + roi.width));
	const maxBottom = Math.min(outputHeight, Math.ceil(roi.y + roi.height));
	return {
		x: minX,
		y: minY,
		width: Math.max(1, maxRight - minX),
		height: Math.max(1, maxBottom - minY),
	};
}

/**
 * Resolves a cursor bounds rect into a clamped, expanded ROI, or reports an
 * explicit unavailable result when safe bounds cannot be established.
 */
export function resolveCursorRoi(
	bounds: CursorRect,
	outputWidth: number,
	outputHeight: number,
	expansion: CursorSpriteExpansion,
): CursorSpriteRoiResult {
	if (!isValidCursorBounds(bounds)) {
		return { available: false, reason: "cursor bounds are invalid or empty" };
	}
	if (
		!Number.isFinite(outputWidth) ||
		!Number.isFinite(outputHeight) ||
		outputWidth <= 0 ||
		outputHeight <= 0
	) {
		return { available: false, reason: "output canvas dimensions are invalid" };
	}
	const expanded = expandCursorBounds(bounds, expansion);
	const roi = clampCursorRoiToCanvas(expanded, outputWidth, outputHeight);
	if (!isValidCursorBounds(roi)) {
		return { available: false, reason: "cursor ROI could not be clamped safely" };
	}
	return { available: true, roi };
}

/**
 * Builds the render transform used to draw the cursor into the bounded capture
 * target. The cursor is rendered exactly as the full-canvas path would show it
 * (same world transform), then translated so the ROI's top-left maps to the
 * capture canvas origin. Translation is applied after the world transform, so
 * this is the world matrix with its tx/ty shifted by (-roiX, -roiY).
 */
export function buildCursorSpriteRenderTransform(
	world: Matrix,
	roiX: number,
	roiY: number,
): Matrix {
	return new Matrix(world.a, world.b, world.c, world.d, world.tx - roiX, world.ty - roiY);
}

function copyTopLeftAligned(
	target: Uint8Array,
	targetWidth: number,
	source: Uint8Array,
	sourceWidth: number,
	sourceHeight: number,
): void {
	const width = Math.min(targetWidth, sourceWidth);
	for (let row = 0; row < sourceHeight; row += 1) {
		const sourceStart = row * sourceWidth * 4;
		const targetStart = row * targetWidth * 4;
		target.set(source.subarray(sourceStart, sourceStart + width * 4), targetStart);
	}
}

/**
 * Captures cursor-sprite frames into a bounded RGBA strip plus positions.
 *
 * The instance holds one growable RenderTexture (bounded, reused across
 * frames) so per-frame work is just a render into it and a readback of the
 * sprite-sized region; it is not reallocated unless the cursor ROI grows.
 * `finish()` normalizes every captured frame to the fixed strip size (content
 * top-left aligned, zero padded) so the output is a fixed-size canvas for the
 * whole export.
 */
export class CursorSpriteCapturer {
	private readonly renderer: CursorSpriteRenderer;
	private readonly cursorContainer: Container;
	private readonly outputWidth: number;
	private readonly outputHeight: number;
	private readonly expansion: CursorSpriteExpansion;
	private readonly maxSpriteWidth: number;
	private readonly maxSpriteHeight: number;
	private renderTexture: RenderTexture | null = null;
	private records: CursorSpriteFrameRecord[] = [];
	private closed = false;

	constructor(options: CursorSpriteCapturerOptions) {
		this.renderer = options.renderer;
		this.cursorContainer = options.cursorContainer;
		this.outputWidth = options.outputWidth;
		this.outputHeight = options.outputHeight;
		this.expansion = options.expansion;
		this.maxSpriteWidth = Math.max(0, Math.floor(options.maxSpriteWidth ?? 0));
		this.maxSpriteHeight = Math.max(0, Math.floor(options.maxSpriteHeight ?? 0));
	}

	get isClosed(): boolean {
		return this.closed;
	}

	get renderedFrameCount(): number {
		return this.records.length;
	}

	/**
	 * The most recently captured frame's raw RGBA buffer (fixed strip size when
	 * maxSpriteWidth/Height were supplied), or null before the first capture.
	 * Streaming writers use this to write each frame at its fixed strip offset
	 * without accumulating the whole strip in memory.
	 */
	get lastCapturedFrameData(): Uint8Array | null {
		const record = this.records[this.records.length - 1];
		return record ? record.data : null;
	}

	/**
	 * Whether the cursor is currently visible. Exposed so callers/tests can
	 * verify that invisible cursor frames produce transparent placeholders.
	 */
	get isCursorVisible(): boolean {
		return Boolean(this.cursorContainer.visible);
	}

	/**
	 * Captures one sprite frame. `roiOverride` supplies the exact clamped ROI the
	 * caller precomputed (streaming sprite path): the ROI origin is recorded as
	 * the frame position and the cursor container is rendered with its world
	 * transform translated to that origin, so the emitted strip stays exactly
	 * aligned with the precomputed per-frame positions. Without an override the
	 * ROI is derived from the measured cursor bounds as before.
	 */
	capture(
		bounds: CursorRect,
		contentSignature?: string | null,
		roiOverride?: CursorRect,
	): CursorSpriteCaptureResult {
		if (this.closed) {
			return { captured: false, unavailableReason: "cursor sprite capture is closed" };
		}
		let roi: CursorRect;
		if (roiOverride) {
			if (!isValidCursorBounds(roiOverride)) {
				return {
					captured: false,
					unavailableReason: "cursor sprite ROI override is invalid",
				};
			}
			roi = clampCursorRoiToCanvas(roiOverride, this.outputWidth, this.outputHeight);
			if (!isValidCursorBounds(roi)) {
				return {
					captured: false,
					unavailableReason: "cursor sprite ROI override could not be clamped safely",
				};
			}
		} else {
			const resolved = resolveCursorRoi(
				bounds,
				this.outputWidth,
				this.outputHeight,
				this.expansion,
			);
			if (!resolved.available) {
				return { captured: false, unavailableReason: resolved.reason };
			}
			roi = resolved.roi;
		}

		// Pixel-exact reuse: when the caller reports an unchanged content signature
		// and the ROI (position + size) is identical to the previous frame, the
		// rendered sprite pixels are provably identical, so reuse the previous
		// capture without re-rendering or re-reading the GPU target. This is the
		// common cursor-at-rest case and avoids a per-frame ROI render + readback.
		const previous = this.records[this.records.length - 1];
		if (
			contentSignature !== undefined &&
			previous &&
			previous.contentSignature === contentSignature &&
			previous.position.x === roi.x &&
			previous.position.y === roi.y &&
			previous.width === roi.width &&
			previous.height === roi.height
		) {
			this.records.push({
				position: { x: roi.x, y: roi.y },
				width: previous.width,
				height: previous.height,
				data: previous.data,
				contentSignature,
			});
			return { captured: true, position: { x: roi.x, y: roi.y } };
		}

		this.ensureRenderTexture(roi);
		const renderTexture = this.renderTexture;
		if (!renderTexture) {
			return {
				captured: false,
				unavailableReason: "cursor sprite render target is unavailable",
			};
		}

		if (this.cursorContainer.visible) {
			const transform = buildCursorSpriteRenderTransform(
				this.cursorContainer.worldTransform,
				roi.x,
				roi.y,
			);
			this.renderer.render({
				container: this.cursorContainer,
				target: renderTexture,
				transform,
				clear: true,
			});
		}

		const pixelResult = this.cursorContainer.visible
			? this.renderer.extract.pixels({ target: renderTexture })
			: new Uint8Array(renderTexture.width * renderTexture.height * 4);
		const pixelData =
			pixelResult instanceof Uint8Array || pixelResult instanceof Uint8ClampedArray
				? pixelResult
				: pixelResult.pixels;
		const data =
			pixelData instanceof Uint8ClampedArray ? new Uint8Array(pixelData) : pixelData.slice();
		const record: CursorSpriteFrameRecord = {
			position: { x: roi.x, y: roi.y },
			width: renderTexture.width,
			height: renderTexture.height,
			data,
			contentSignature: contentSignature ?? null,
		};
		this.records.push(record);
		return { captured: true, position: { x: roi.x, y: roi.y } };
	}

	finish(): CursorSpriteStripData | null {
		if (this.records.length === 0) {
			return null;
		}
		let width = this.maxSpriteWidth;
		let height = this.maxSpriteHeight;
		for (const record of this.records) {
			width = Math.max(width, record.width);
			height = Math.max(height, record.height);
		}
		const frameBytes = width * height * 4;
		const frames = new Uint8Array(frameBytes * this.records.length);
		const positions: NativeCursorSpritePosition[] = new Array(this.records.length);
		for (let index = 0; index < this.records.length; index += 1) {
			const record = this.records[index];
			const view = frames.subarray(index * frameBytes, (index + 1) * frameBytes);
			copyTopLeftAligned(view, width, record.data, record.width, record.height);
			positions[index] = { x: record.position.x, y: record.position.y };
		}
		return {
			width,
			height,
			frameCount: this.records.length,
			frames,
			positions,
		};
	}

	/**
	 * Cancels the session, discarding captured frames. The render target is
	 * released; the instance is unusable afterwards.
	 */
	cancel(): void {
		this.closed = true;
		this.records = [];
		this.destroyRenderTexture();
	}

	destroy(): void {
		this.closed = true;
		this.records = [];
		this.destroyRenderTexture();
	}

	private ensureRenderTexture(roi: CursorRect): void {
		const targetWidth = Math.min(this.outputWidth, Math.max(roi.width, this.maxSpriteWidth));
		const targetHeight = Math.min(
			this.outputHeight,
			Math.max(roi.height, this.maxSpriteHeight),
		);
		if (
			this.renderTexture &&
			this.renderTexture.width >= targetWidth &&
			this.renderTexture.height >= targetHeight
		) {
			return;
		}
		this.destroyRenderTexture();
		this.renderTexture = RenderTexture.create({
			width: Math.max(1, Math.round(targetWidth)),
			height: Math.max(1, Math.round(targetHeight)),
		});
	}

	private destroyRenderTexture(): void {
		if (this.renderTexture) {
			try {
				this.renderTexture.destroy(true);
			} catch {
				// Ignore renderer-specific teardown errors; the session is already closing.
			}
			this.renderTexture = null;
		}
	}
}
