import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildActiveCaptionLayout } from "@/components/video-editor/captionLayout";
import { applyCaptionPreset, getCaptionPreset } from "@/components/video-editor/captionPresets";
import {
	getCaptionFontBaseline,
	getCaptionScaledFontSize,
	getCaptionTextMaxWidth,
} from "@/components/video-editor/captionStyle";
import { CaptionGenerationSettings } from "@/components/video-editor/settings/CaptionGenerationSettings";
import {
	type AutoCaptionSettings,
	DEFAULT_AUTO_CAPTION_SETTINGS,
} from "@/components/video-editor/types";
import { useCaptionFont } from "@/components/video-editor/useCaptionFont";
import { PlaybackCaptions } from "@/components/video-editor/videoPlayback/PlaybackCaptions";
import { I18nProvider } from "@/contexts/I18nContext";
import "@/index.css";

function Preview() {
	const [time, setTime] = useState(700);
	const overlayRef = useRef<HTMLDivElement>(null);
	const captionBoxRef = useRef<HTMLDivElement>(null);
	const [settings, setSettings] = useState<AutoCaptionSettings>({
		...(new URLSearchParams(location.search).has("style")
			? applyCaptionPreset(
					DEFAULT_AUTO_CAPTION_SETTINGS,
					getCaptionPreset(new URLSearchParams(location.search).get("style")).id,
				)
			: DEFAULT_AUTO_CAPTION_SETTINGS),
		enabled: true,
		animationStyle: "none" as const,
	});
	const captionFont = useCaptionFont(settings);
	const cues = [
		{
			id: "a",
			startMs: 0,
			endMs: 1500,
			text: "Follow every word",
			words: [
				{ text: "Follow", startMs: 0, endMs: 400 },
				{ text: "every", startMs: 500, endMs: 900, leadingSpace: true },
				{ text: "word", startMs: 1000, endMs: 1400, leadingSpace: true },
			],
		},
		{
			id: "b",
			startMs: 3000,
			endMs: 5000,
			text: "Clean caption transitions",
			words: [
				{ text: "Clean", startMs: 3300, endMs: 3700 },
				{ text: "caption", startMs: 3800, endMs: 4200, leadingSpace: true },
				{ text: "transitions", startMs: 4300, endMs: 4900, leadingSpace: true },
			],
		},
	];
	const fontSize = getCaptionScaledFontSize(settings.fontSize, 960, settings.maxWidth);
	const ctx = document.createElement("canvas").getContext("2d")!;
	ctx.font = `${getCaptionPreset(settings.style).fontWeight} ${fontSize}px ${captionFont.fontFamily}`;
	const layout = !captionFont.ready
		? null
		: buildActiveCaptionLayout({
				fontBaselinePx: getCaptionFontBaseline(fontSize, ctx.measureText("Hg")),
				cues,
				timeMs: time,
				settings,
				maxWidthPx: getCaptionTextMaxWidth(
					960,
					settings.maxWidth,
					fontSize,
					settings.style,
				),
				measureText: (text) => ctx.measureText(text).width,
			});
	const input = {
		isGap: false,
		activeCaptionLayout: layout,
		autoCaptionSettings: settings,
		onEditAutoCaption: () => undefined,
		captionBoxRef,
		isCaptionEditing: false,
		te: (_key: string, fallback: string) => fallback,
		beginCaptionEdit: () => undefined,
		captionFontFamily: captionFont.fontFamily,
		overlayRef,
		captionEditSession: null,
	} as Parameters<typeof PlaybackCaptions>[0];
	return (
		<>
			<label>
				Time
				<input
					aria-label="Time"
					type="number"
					value={time}
					onChange={(e) => setTime(Number(e.target.value))}
				/>
			</label>
			<div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
				<div
					ref={overlayRef}
					style={{ position: "relative", width: 960, height: 540, background: "#a6b0bd" }}
				>
					<PlaybackCaptions {...input} />
				</div>
				<aside style={{ width: 280, padding: 12 }}>
					<CaptionGenerationSettings
						advanced={true}
						captionCueCount={cues.length}
						autoCaptionSettings={settings}
						onAutoCaptionSettingsChange={setSettings}
						whisperModelPath="/test-model"
						whisperModelDownloadStatus="downloaded"
						whisperModelDownloadProgress={100}
						isGeneratingCaptions={false}
					/>
				</aside>
			</div>
		</>
	);
}
createRoot(document.getElementById("root")!).render(
	<I18nProvider>
		<Preview />
	</I18nProvider>,
);
