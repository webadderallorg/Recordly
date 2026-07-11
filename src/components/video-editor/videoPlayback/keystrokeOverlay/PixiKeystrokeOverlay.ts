// PixiKeystrokeOverlay — renders coalesced keystroke keycaps as a PIXI layer.
//
// Mirrors PixiCursorOverlay's contract: a parent-agnostic `container` built in
// the constructor (the caller attaches it), a per-frame `update(...)`, and
// `reset()` / `destroy()`. All *display logic* (which keys are visible, chord
// grouping, fade) comes from the pure keystrokeCoalescing core, so this file
// only turns groups into pooled Graphics + Text — keeping the hard parts unit-
// tested and the untestable Pixi parts thin.

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { CursorViewportRect } from "../cursorViewport";
import { detectGlyphStyle } from "./keyLabels";
import { buildKeycapGroups } from "./keystrokeCoalescing";
import {
	DEFAULT_KEYSTROKE_OVERLAY_POLICY,
	type KeycapGroup,
	type KeystrokeEvent,
	type KeystrokeOverlayPolicy,
	type KeystrokeOverlayPosition,
	type ModifierGlyphStyle,
} from "./keystrokeTypes";

export interface KeystrokeRenderConfig {
	/** Modifier glyph style (⌘⌥⇧⌃ vs Ctrl/Alt/Win/Super). */
	glyphStyle: ModifierGlyphStyle;
	/** Screen anchor for the keycap stack. */
	position: KeystrokeOverlayPosition;
	/** User size multiplier (settings `keystrokeSize`, ~0.5..2). */
	sizeScale: number;
	/** Coalescing / fade policy shared with the pure core. */
	policy: KeystrokeOverlayPolicy;
}

export const DEFAULT_KEYSTROKE_CONFIG: KeystrokeRenderConfig = {
	glyphStyle: detectGlyphStyle(),
	position: "bottom-center",
	sizeScale: 1,
	policy: DEFAULT_KEYSTROKE_OVERLAY_POLICY,
};

interface PooledKeycap {
	background: Graphics;
	label: Text;
}

const KEYCAP_FILL = 0x1b1b1f;
const KEYCAP_STROKE = 0x3a3a42;
const KEYCAP_TEXT = 0xf4f4f5;

export class PixiKeystrokeOverlay {
	public readonly container: Container;
	private config: KeystrokeRenderConfig;
	private readonly pool: PooledKeycap[] = [];

	constructor(config: Partial<KeystrokeRenderConfig> = {}) {
		this.config = { ...DEFAULT_KEYSTROKE_CONFIG, ...config };
		this.container = new Container();
		this.container.label = "keystroke-overlay";
	}

	setConfig(config: Partial<KeystrokeRenderConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Per-frame render. Signature mirrors PixiCursorOverlay.update: samples must
	 * be sorted ascending by timeMs; `viewport` is the base frame rect; `visible`
	 * gates the whole layer. `freeze` is accepted for call-site parity but unused
	 * — the overlay is a pure function of `timeMs`, so scrubbing already snaps to
	 * the correct state without stepping any animation.
	 */
	update(
		samples: KeystrokeEvent[],
		timeMs: number,
		viewport: CursorViewportRect,
		visible: boolean,
		_freeze = false,
	): void {
		if (!visible || samples.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
			this.hide();
			return;
		}

		const groups = buildKeycapGroups(samples, timeMs, this.config.glyphStyle, this.config.policy);
		if (groups.length === 0) {
			this.hide();
			return;
		}

		this.container.visible = true;
		this.render(groups, viewport);
	}

	private hide(): void {
		this.container.visible = false;
		for (const keycap of this.pool) {
			keycap.background.visible = false;
			keycap.label.visible = false;
		}
	}

	private obtainKeycap(index: number): PooledKeycap {
		let keycap = this.pool[index];
		if (!keycap) {
			const background = new Graphics();
			const label = new Text({
				text: "",
				style: new TextStyle({
					fontFamily:
						"ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
					fontWeight: "600",
					fill: KEYCAP_TEXT,
				}),
			});
			label.anchor.set(0.5);
			keycap = { background, label };
			this.pool[index] = keycap;
			this.container.addChild(background, label);
		}
		keycap.background.visible = true;
		keycap.label.visible = true;
		return keycap;
	}

	private render(groups: KeycapGroup[], viewport: CursorViewportRect): void {
		// Size everything relative to viewport height so the overlay scales with
		// the rendered video, then apply the user's size multiplier.
		const fontSize = Math.max(10, Math.min(64, viewport.height * 0.032 * this.config.sizeScale));
		const padX = fontSize * 0.55;
		const capHeight = fontSize * 1.7;
		const capGap = fontSize * 0.32; // gap between keys within a group
		const rowGap = fontSize * 0.4; // gap between stacked groups
		const edgeMargin = fontSize * 1.1;
		const cornerRadius = fontSize * 0.32;

		// Lay out each group as a row of pill-shaped keycaps.
		let poolIndex = 0;
		const rows: { width: number; caps: { index: number; width: number }[] }[] = [];

		for (const group of groups) {
			const caps: { index: number; width: number }[] = [];
			let rowWidth = 0;
			for (const text of group.labels) {
				const index = poolIndex++;
				const keycap = this.obtainKeycap(index);
				keycap.label.style.fontSize = fontSize;
				keycap.label.text = text;
				const capWidth = Math.max(capHeight, keycap.label.width + padX * 2);
				caps.push({ index, width: capWidth });
				rowWidth += capWidth + capGap;
			}
			rows.push({ width: Math.max(0, rowWidth - capGap), caps });
		}

		// Hide pooled keycaps not used this frame.
		for (let i = poolIndex; i < this.pool.length; i++) {
			this.pool[i].background.visible = false;
			this.pool[i].label.visible = false;
		}

		const totalHeight = rows.length * capHeight + Math.max(0, rows.length - 1) * rowGap;
		const topY = this.resolveTopY(viewport, totalHeight, edgeMargin);

		rows.forEach((row, rowIndex) => {
			const rowY = topY + rowIndex * (capHeight + rowGap);
			const opacity = groups[rowIndex].opacity;
			let x = this.resolveRowStartX(viewport, row.width, edgeMargin);

			for (const cap of row.caps) {
				const keycap = this.pool[cap.index];
				keycap.background.clear();
				keycap.background
					.roundRect(x, rowY, cap.width, capHeight, cornerRadius)
					.fill({ color: KEYCAP_FILL, alpha: 0.82 * opacity })
					.stroke({ color: KEYCAP_STROKE, width: 1, alpha: 0.9 * opacity });
				keycap.label.position.set(x + cap.width / 2, rowY + capHeight / 2);
				keycap.label.alpha = opacity;
				x += cap.width + capGap;
			}
		});
	}

	private resolveTopY(
		viewport: CursorViewportRect,
		totalHeight: number,
		edgeMargin: number,
	): number {
		if (this.config.position === "top-center") {
			return viewport.y + edgeMargin;
		}
		// bottom-* anchors: stack upward from near the bottom edge.
		return viewport.y + viewport.height - edgeMargin - totalHeight;
	}

	private resolveRowStartX(
		viewport: CursorViewportRect,
		rowWidth: number,
		edgeMargin: number,
	): number {
		switch (this.config.position) {
			case "bottom-left":
				return viewport.x + edgeMargin;
			case "bottom-right":
				return viewport.x + viewport.width - edgeMargin - rowWidth;
			default:
				return viewport.x + (viewport.width - rowWidth) / 2;
		}
	}

	reset(): void {
		this.hide();
	}

	destroy(): void {
		for (const keycap of this.pool) {
			keycap.background.destroy();
			keycap.label.destroy();
		}
		this.pool.length = 0;
		this.container.destroy({ children: true });
	}
}
