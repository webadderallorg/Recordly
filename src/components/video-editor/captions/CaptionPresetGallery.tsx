import { useEffect, useRef } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import {
	buildCaptionBlock,
	ensureCaptionSettingsFontLoaded,
	paintCaptionBlock,
} from "@/lib/captions/captionPainter";
import {
	applyCaptionPreset,
	CAPTION_PRESET_IDS,
	CAPTION_STYLE_PRESETS,
	type CaptionPresetId,
	findMatchingCaptionPreset,
} from "@/lib/captions/captionPresets";
import { cn } from "@/lib/utils";
import type { AutoCaptionSettings, CaptionCue } from "../types";

const THUMBNAIL_SIZE = { width: 280, height: 96 };
const THUMBNAIL_WORD_MS = 300;
const THUMBNAIL_ACTIVE_WORD_INDEX = 1;

function buildSampleCue(text: string): CaptionCue {
	const tokens = text.split(/\s+/).filter(Boolean);
	return {
		id: "preset-sample",
		startMs: 0,
		endMs: tokens.length * THUMBNAIL_WORD_MS,
		text,
		words: tokens.map((token, index) => ({
			text: token,
			startMs: index * THUMBNAIL_WORD_MS,
			endMs: (index + 1) * THUMBNAIL_WORD_MS,
			...(index > 0 ? { leadingSpace: true } : {}),
		})),
	};
}

function getThumbnailSettings(
	settings: AutoCaptionSettings,
	presetId: CaptionPresetId,
): AutoCaptionSettings {
	return {
		...applyCaptionPreset(settings, presetId),
		enabled: true,
		animationStyle: "none",
		verticalPosition: "middle",
		horizontalAlign: "center",
		maxRows: 1,
		maxWidth: 95,
	};
}

function CaptionPresetThumbnail(props: {
	presetId: CaptionPresetId;
	settings: AutoCaptionSettings;
	sampleText: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { presetId, settings, sampleText } = props;

	useEffect(() => {
		let cancelled = false;
		const thumbnailSettings = getThumbnailSettings(settings, presetId);
		void ensureCaptionSettingsFontLoaded(thumbnailSettings, THUMBNAIL_SIZE.width).then(() => {
			const canvas = canvasRef.current;
			const ctx = canvas?.getContext("2d");
			if (cancelled || !canvas || !ctx) return;
			const pixelRatio = window.devicePixelRatio || 1;
			canvas.width = THUMBNAIL_SIZE.width * pixelRatio;
			canvas.height = THUMBNAIL_SIZE.height * pixelRatio;
			ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
			const block = buildCaptionBlock({
				cues: [buildSampleCue(sampleText)],
				timeMs: THUMBNAIL_WORD_MS * THUMBNAIL_ACTIVE_WORD_INDEX + THUMBNAIL_WORD_MS / 2,
				settings: thumbnailSettings,
				frame: THUMBNAIL_SIZE,
				measureContext: ctx,
			});
			ctx.clearRect(0, 0, THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height);
			if (block) paintCaptionBlock(ctx, block, thumbnailSettings);
		});
		return () => {
			cancelled = true;
		};
	}, [presetId, settings, sampleText]);

	return (
		<canvas
			ref={canvasRef}
			className="block aspect-[280/96] w-full rounded-md bg-gradient-to-br from-slate-700 to-slate-400"
			aria-hidden
		/>
	);
}

/** One-click caption looks, each previewed with the real caption painter. */
export function CaptionPresetGallery(props: {
	settings: AutoCaptionSettings;
	onChange: (partial: Partial<AutoCaptionSettings>) => void;
}) {
	const t = useScopedT("settings");
	const activePresetId = findMatchingCaptionPreset(props.settings);
	const sampleText = t("captions.presetSample", "Your captions look like this");

	return (
		<div className="flex flex-col gap-1.5">
			<div className="mb-1 text-sm font-medium text-foreground">
				{t("captions.presets", "Style presets")}
			</div>
			<div className="grid grid-cols-2 gap-2">
				{CAPTION_PRESET_IDS.map((presetId) => {
					const preset = CAPTION_STYLE_PRESETS[presetId];
					const label = t(`captions.preset.${presetId}`, preset.label);
					return (
						<button
							key={presetId}
							type="button"
							aria-pressed={activePresetId === presetId}
							onClick={() => props.onChange(preset.style)}
							className={cn(
								"flex flex-col gap-1 rounded-lg border border-foreground/10 bg-foreground/[0.03] p-1.5 text-left transition-colors hover:border-foreground/20",
								"aria-pressed:border-[#2563EB]/70 aria-pressed:bg-[#2563EB]/12",
							)}
						>
							<CaptionPresetThumbnail
								presetId={presetId}
								settings={props.settings}
								sampleText={sampleText}
							/>
							<span className="px-0.5 text-[11px] text-foreground">{label}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
