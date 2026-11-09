import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { getAssetPath, getRenderableAssetUrl } from "@/lib/assetPath";
import { getCaptionFontFamily } from "../captionFonts";
import { prepareCaptionLayout } from "../captionLayout";
import { CAPTION_STYLE_OPTIONS, getCaptionBackground, getCaptionPreset } from "../captionPresets";
import { getCaptionPadding, getCaptionScaledRadius } from "../captionStyle";
import { type AutoCaptionStyle, DEFAULT_AUTO_CAPTION_SETTINGS } from "../types";
import styles from "./CaptionStylePicker.module.css";

const SAMPLE = [
	{
		id: "style-preview",
		startMs: 0,
		endMs: 1900,
		text: "Make it clear",
		words: [
			{ text: "Make", startMs: 80, endMs: 440 },
			{ text: "it", startMs: 500, endMs: 800, leadingSpace: true },
			{ text: "clear", startMs: 900, endMs: 1800, leadingSpace: true },
		],
	},
];

function CaptionStylePreview({
	style,
	active,
	background,
}: {
	style: AutoCaptionStyle;
	active: boolean;
	background?: string;
}) {
	const stage = useRef<HTMLSpanElement>(null);
	const [width, setWidth] = useState(120);
	const [time, setTime] = useState(0);
	const reducedMotion = useReducedMotion();
	const playing = active && !reducedMotion;
	useEffect(() => {
		const node = stage.current;
		if (!node) return;
		const observer = new ResizeObserver(() => setWidth(node.clientWidth));
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (!playing) return;
		let frame = 0;
		const start = performance.now();
		setTime(0);
		const animate = (now: number) => {
			setTime((now - start) % 2200);
			frame = requestAnimationFrame(animate);
		};
		frame = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(frame);
	}, [playing]);
	const preset = getCaptionPreset(style);
	const fontSize = Math.max(8, Math.min(13, width * 0.1));
	const fontFamily = getCaptionFontFamily({ style, fontFamily: "" });
	const settings = useMemo(
		() => ({ ...DEFAULT_AUTO_CAPTION_SETTINGS, ...preset.settings, style }),
		[preset, style],
	);
	const sample = useMemo(() => {
		const context = document.createElement("canvas").getContext("2d")!;
		context.font = `${preset.fontWeight} ${fontSize}px ${fontFamily}`;
		return prepareCaptionLayout({
			cues: SAMPLE,
			settings,
			maxWidthPx: Math.max(1, width - 20),
			measureText: (text) => context.measureText(text).width,
		});
	}, [fontFamily, fontSize, preset.fontWeight, settings, width]);
	const layout = sample(playing ? time : 1500);
	const padding = getCaptionPadding(fontSize, style);
	return (
		<span
			ref={stage}
			className={styles.stage}
			aria-hidden="true"
			style={{ backgroundImage: background ? `url("${background}")` : undefined }}
			data-caption-style-preview={style}
			data-preview-playing={playing || undefined}
		>
			{layout && (
				<span
					className={styles.sample}
					style={{
						fontFamily,
						fontSize,
						fontWeight: preset.fontWeight,
						width: layout.visibleLines[0].width + padding.x * 2,
						padding: `${padding.y}px ${padding.x}px`,
						background: getCaptionBackground(settings),
						color: settings.textColor,
						borderRadius: getCaptionScaledRadius(settings.boxRadius, fontSize),
						boxShadow: preset.borderEm
							? `inset 0 0 0 ${preset.borderEm}em rgba(0, 0, 0, 0.12)`
							: undefined,
					}}
				>
					{layout.visibleLines[0].words.map((word) => (
						<span key={word.index}>
							{word.leadingSpace ? " " : ""}
							<span
								data-caption-preview-word=""
								style={{
									display: "inline-block",
									opacity: word.revealProgress,
									filter: `blur(${(1 - (word.revealProgress ?? 1)) * fontSize * 0.18}px)`,
								}}
							>
								{word.text}
							</span>
						</span>
					))}
				</span>
			)}
		</span>
	);
}

export function CaptionStylePicker({
	value,
	onChange,
}: {
	value: AutoCaptionStyle | undefined;
	onChange: (style: AutoCaptionStyle) => void;
}) {
	const te = useScopedT("editing");
	const [hovered, setHovered] = useState<AutoCaptionStyle | null>(null);
	const [focused, setFocused] = useState<AutoCaptionStyle | null>(null);
	const [background, setBackground] = useState<string>();
	useEffect(() => {
		let active = true;
		void getAssetPath("wallpapers/macos-hello-black.jpg")
			.then(getRenderableAssetUrl)
			.then((url) => {
				if (active) setBackground(url);
			})
			.catch((error: unknown) =>
				console.warn("Caption preview background unavailable", error),
			);
		return () => {
			active = false;
		};
	}, []);
	const selected = getCaptionPreset(value).id;
	return (
		<div className={styles.picker}>
			<div
				role="group"
				aria-label={te("captionStyle", "Caption style")}
				className={styles.options}
			>
				{CAPTION_STYLE_OPTIONS.map((preset) => {
					const label =
						preset.id === "serif"
							? te("captionStyleClassic", "Classic")
							: te("captionStyleReveal", "Reveal");
					return (
						<Button
							key={preset.id}
							type="button"
							variant="outline"
							aria-label={label}
							aria-pressed={selected === preset.id}
							data-selected={selected === preset.id}
							className={styles.card}
							onClick={() => onChange(preset.id)}
							onMouseEnter={() => setHovered(preset.id)}
							onMouseLeave={() => setHovered(null)}
							onFocus={(event) => {
								if (event.currentTarget.matches(":focus-visible"))
									setFocused(preset.id);
							}}
							onBlur={() => setFocused(null)}
						>
							<CaptionStylePreview
								style={preset.id}
								active={(hovered ?? focused) === preset.id}
								background={background}
							/>
						</Button>
					);
				})}
			</div>
		</div>
	);
}
