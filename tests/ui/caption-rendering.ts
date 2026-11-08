import { ensureCaptionFontLoaded } from "@/components/video-editor/captionFonts";
import { Container } from "pixi.js";
import { renderCaptions } from "@/lib/exporter/captionRenderer";
import { FrameCaptions } from "@/lib/exporter/modernFrameCaptions";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "@/components/video-editor/types";
import { applyCaptionPreset, CAPTION_PRESETS } from "@/components/video-editor/captionPresets";
import { getCaptionPadding } from "@/components/video-editor/captionStyle";
import type { FrameRenderContext } from "@/lib/exporter/modernFrameRenderer";

async function run() {
	await ensureCaptionFontLoaded({ style: "tiktok", fontFamily: "" });
	const width = 960,
		height = 540;
	const settings = {
		...DEFAULT_AUTO_CAPTION_SETTINGS,
		enabled: true,
		animationStyle: "none",
	};
	const cues = [
		{
			id: "one",
			startMs: 0,
			endMs: 1000,
			text: "Follow every word",
			words: [
				{ text: "Follow", startMs: 80, endMs: 300 },
				{ text: "every", startMs: 400, endMs: 700, leadingSpace: true },
				{ text: "word", startMs: 750, endMs: 950, leadingSpace: true },
			],
		},
		{
			id: "two",
			startMs: 2000,
			endMs: 3000,
			text: "Next phrase",
			words: [
				{ text: "Next", startMs: 2100, endMs: 2400 },
				{ text: "phrase", startMs: 2500, endMs: 2900, leadingSpace: true },
			],
		},
	];
	const frame = new FrameCaptions({
		config: { width, height, autoCaptions: cues, autoCaptionSettings: settings },
		scene: { captionContainer: new Container() },
	} as unknown as Pick<FrameRenderContext, "scene" | "config">);
	frame.setupCaptionResources();
	function draw(time: number, modern: boolean) {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d")!;
		if (modern) {
			frame.updateCaptionLayer(time);
			frame.drawCaptionOverlay(ctx);
		} else renderCaptions(ctx, cues, settings, width, height, time);
		return ctx;
	}
	const state = frame.buildCaptionRenderState(500)!;
	const line = state.layout.visibleLines[0];
	const measure = frame.captionMeasureCtx;
	const sampleX =
		state.centerX -
		line.width / 2 +
		measure.measureText("Follow ").width +
		measure.measureText("every").width / 2;
	const sampleY = state.centerY + state.fontSize * 0.48;
	const pixel = (ctx: CanvasRenderingContext2D) =>
		Array.from(ctx.getImageData(Math.floor(sampleX), Math.floor(sampleY), 1, 1).data);
	const samples = [false, true].map((modern) => {
		const backgroundBounds = [0, 150, 500, 800, 999].map((time) => {
			const row = draw(time, modern).getImageData(
				0,
				Math.floor(state.centerY),
				width,
				1,
			).data;
			const filled = Array.from({ length: width }, (_, x) => x).filter(
				(x) => row[x * 4 + 3] > 0,
			);
			return [filled[0], filled[filled.length - 1]];
		});
		const active = draw(500, modern),
			// Only the cue lead-in is unhighlighted now; gaps hold the previous word.
			inactive = draw(0, modern);
		const held = draw(725, modern);
		const activePixels = active.getImageData(0, 0, width, height).data;
		const heldPixels = held.getImageData(0, 0, width, height).data;
		const inactivePixels = inactive.getImageData(0, 0, width, height).data;
		return {
			backgroundBounds,
			heldMatchesActive: activePixels.every((value, index) => value === heldPixels[index]),
			activePixelsDiffer: activePixels.some(
				(value, index) => value !== inactivePixels[index],
			),
			cornerAlpha: active.getImageData(
				Math.floor(state.centerX - state.boxWidth / 2 + 1),
				Math.floor(state.centerY - state.boxHeight / 2 + 1),
				1,
				1,
			).data[3],
			pause: pixel(inactive),
			silence: pixel(draw(1500, modern)),
		};
	});
	const next = frame.buildCaptionRenderState(2000);
	const styles = CAPTION_PRESETS.map((preset) => {
		const styledSettings = {
			...applyCaptionPreset(settings, preset.id),
			animationStyle: "none" as const,
		};
		const styledFrame = new FrameCaptions({
			config: { width, height, autoCaptions: cues, autoCaptionSettings: styledSettings },
			scene: { captionContainer: new Container() },
		} as unknown as Pick<FrameRenderContext, "scene" | "config">);
		styledFrame.setupCaptionResources();
		const state = styledFrame.buildCaptionRenderState(500)!;
		const foreground = preset.highlightTextColor ?? styledSettings.textColor;
		const target = [1, 3, 5].map((i) => parseInt(foreground.slice(i, i + 2), 16));
		const samples = [false, true].map((modern) => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d")!;
			if (modern) {
				styledFrame.updateCaptionLayer(500);
				styledFrame.drawCaptionOverlay(ctx);
			} else renderCaptions(ctx, cues, styledSettings, width, height, 500);
			const pixels = ctx.getImageData(0, 0, width, height).data;
			let foregroundPixels = 0;
			let highlightPixels = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				if (
					pixels[i + 3] > 200 &&
					// Small fixed-size text is antialiased rather than solid foreground pixels.
					target.every((value, channel) => Math.abs(value - pixels[i + channel]) < 24)
				)
					foregroundPixels++;
				if (
					pixels[i + 3] > 200 &&
					pixels[i] > 230 &&
					pixels[i + 1] > 200 &&
					pixels[i + 2] < 24
				)
					highlightPixels++;
			}
			const backgroundPixel = Array.from(
				ctx.getImageData(
					Math.floor(
						state.centerX -
							state.boxWidth / 2 +
							getCaptionPadding(state.fontSize).x / 4,
					),
					Math.floor(state.centerY),
					1,
					1,
				).data,
			);
			let darkPixelsOnWhite = 0;
			let whiteCorner: number[] = [];
			if (preset.id === "tiktok") {
				ctx.globalCompositeOperation = "destination-over";
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, width, height);
				const onWhite = ctx.getImageData(0, 0, width, height).data;
				for (let i = 0; i < onWhite.length; i += 4) {
					if (onWhite[i] < 64 && onWhite[i + 1] < 64 && onWhite[i + 2] < 64)
						darkPixelsOnWhite++;
				}
				whiteCorner = Array.from(ctx.getImageData(0, 0, 1, 1).data);
			}
			return {
				foregroundPixels,
				highlightPixels,
				backgroundAlpha: backgroundPixel[3],
				backgroundPixel,
				darkPixelsOnWhite,
				whiteCorner,
			};
		});
		return {
			id: preset.id,
			samples,
			widths: [0, 150, 500, 800, 999].map(
				(time) => styledFrame.buildCaptionRenderState(time)!.boxWidth,
			),
			heightInEm: state.boxHeight / state.fontSize,
			backgroundOpacity: styledSettings.backgroundOpacity,
		};
	});
	return {
		styles,
		samples,
		nextText: next.layout.editTarget.text,
		nextActiveWord: next.layout.activeWordIndex,
	};
}
void run()
	.then((result) => {
		document.body.dataset.result = JSON.stringify(result);
	})
	.catch((error: unknown) => {
		document.body.dataset.error = String(error);
	});
