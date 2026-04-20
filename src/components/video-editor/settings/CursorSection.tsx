import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getRenderableAssetUrl } from "@/lib/assetPath";
import { extensionHost } from "@/lib/extensions";
import { cn } from "@/lib/utils";
import { useI18n, useScopedT } from "../../../contexts/I18nContext";
import { loadEditorPreferences } from "../editorPreferences";
import { CursorStylePreview, minimalCursorUrl, tahoeCursorUrl } from "../CursorStylePreview";
import { SliderControl } from "../SliderControl";
import { BUILTIN_CURSOR_STYLE_OPTIONS, SectionLabel, type CursorStyleOption } from "../settingsPanelConstants";
import { createInvertedPreview, createTrimmedSvgPreview } from "../settingsPanelUtils";
import type { CursorStyle } from "../types";
import {
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_CURSOR_SWAY,
} from "../types";
import { fromCursorSwaySliderValue, toCursorSwaySliderValue } from "../videoPlayback/cursorSway";
import { UPLOADED_CURSOR_SAMPLE_SIZE, uploadedCursorAssets } from "../videoPlayback/uploadedCursorAssets";

interface CursorSectionProps {
	showCursor: boolean;
	onShowCursorChange?: (enabled: boolean) => void;
	loopCursor: boolean;
	onLoopCursorChange?: (enabled: boolean) => void;
	cursorStyle: CursorStyle;
	onCursorStyleChange?: (style: CursorStyle) => void;
	cursorSize: number;
	onCursorSizeChange?: (size: number) => void;
	cursorSmoothing: number;
	onCursorSmoothingChange?: (smoothing: number) => void;
	cursorMotionBlur: number;
	onCursorMotionBlurChange?: (amount: number) => void;
	cursorClickBounce: number;
	onCursorClickBounceChange?: (amount: number) => void;
	cursorClickBounceDuration: number;
	onCursorClickBounceDurationChange?: (duration: number) => void;
	cursorSway: number;
	onCursorSwayChange?: (amount: number) => void;
	extensionContent?: ReactNode;
}

export function CursorSection({
	showCursor,
	onShowCursorChange,
	loopCursor,
	onLoopCursorChange,
	cursorStyle,
	onCursorStyleChange,
	cursorSize,
	onCursorSizeChange,
	cursorSmoothing,
	onCursorSmoothingChange,
	cursorMotionBlur,
	onCursorMotionBlurChange,
	cursorClickBounce,
	onCursorClickBounceChange,
	cursorClickBounceDuration,
	onCursorClickBounceDurationChange,
	cursorSway,
	onCursorSwayChange,
	extensionContent,
}: CursorSectionProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);

	const [extensionCursorStyles, setExtensionCursorStyles] = useState<
		ReturnType<typeof extensionHost.getContributedCursorStyles>
	>([]);
	const [builtInCursorPreviewUrls, setBuiltInCursorPreviewUrls] = useState<
		Partial<Record<string, string>>
	>({});
	const [extensionCursorPreviewUrls, setExtensionCursorPreviewUrls] = useState<
		Partial<Record<string, string>>
	>({});

	const cursorPreviewUrls = useMemo(
		() => ({ ...builtInCursorPreviewUrls, ...extensionCursorPreviewUrls }),
		[builtInCursorPreviewUrls, extensionCursorPreviewUrls],
	);
	const cursorStyleOptions = useMemo<CursorStyleOption[]>(
		() => [
			...BUILTIN_CURSOR_STYLE_OPTIONS,
			...extensionCursorStyles.map((cs) => ({
				value: cs.id as CursorStyle,
				label: cs.cursorStyle.label,
			})),
		],
		[extensionCursorStyles],
	);

	useEffect(() => {
		let cancelled = false;
		const updateCursorAssets = async () => {
			const cursorStyles = extensionHost.getContributedCursorStyles();
			const entries = await Promise.all(
				cursorStyles.map(
					async (cs) => [cs.id, await getRenderableAssetUrl(cs.resolvedDefaultUrl)] as const,
				),
			);
			if (cancelled) return;
			setExtensionCursorStyles(cursorStyles);
			setExtensionCursorPreviewUrls(Object.fromEntries(entries));
		};
		void extensionHost.autoActivateBuiltins().then(updateCursorAssets);
		const unsubscribe = extensionHost.onChange(() => void updateCursorAssets());
		return () => { cancelled = true; unsubscribe(); };
	}, []);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const tahoeAsset = uploadedCursorAssets.arrow;
				const tahoePreview = tahoeAsset
					? await createTrimmedSvgPreview(tahoeAsset.url, UPLOADED_CURSOR_SAMPLE_SIZE, tahoeAsset.trim)
					: tahoeCursorUrl;
				const minimalPreview = await createTrimmedSvgPreview(minimalCursorUrl, 512);
				const invertedPreview = await createInvertedPreview(tahoePreview);
				if (!cancelled) {
					setBuiltInCursorPreviewUrls({ tahoe: tahoePreview, figma: minimalPreview, mono: invertedPreview });
				}
			} catch {
				if (!cancelled) {
					setBuiltInCursorPreviewUrls({ tahoe: tahoeCursorUrl, figma: minimalCursorUrl, mono: tahoeCursorUrl });
				}
			}
		})();
		return () => { cancelled = true; };
	}, []);

	const resetCursorSection = () => {
		onShowCursorChange?.(initialEditorPreferences.showCursor);
		onLoopCursorChange?.(initialEditorPreferences.loopCursor);
		onCursorStyleChange?.(initialEditorPreferences.cursorStyle);
		onCursorSizeChange?.(initialEditorPreferences.cursorSize);
		onCursorSmoothingChange?.(initialEditorPreferences.cursorSmoothing);
		onCursorMotionBlurChange?.(initialEditorPreferences.cursorMotionBlur);
		onCursorClickBounceChange?.(initialEditorPreferences.cursorClickBounce);
		onCursorClickBounceDurationChange?.(DEFAULT_CURSOR_CLICK_BOUNCE_DURATION);
		onCursorSwayChange?.(initialEditorPreferences.cursorSway);
	};

	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<SectionLabel>{tSettings("sections.cursor", "Cursor")}</SectionLabel>
					<button type="button" onClick={resetCursorSection}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80">
						{t("common.actions.reset", "Reset")}
					</button>
				</div>
				<div className="flex items-center gap-3">
					<label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<span>{tSettings("effects.showCursor")}</span>
						<Switch checked={showCursor} onCheckedChange={onShowCursorChange}
							className="data-[state=checked]:bg-[#2563EB] scale-75" />
					</label>
					<label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<span>{tSettings("effects.loopCursor")}</span>
						<Switch checked={loopCursor} onCheckedChange={onLoopCursorChange}
							className="data-[state=checked]:bg-[#2563EB] scale-75" />
					</label>
				</div>
			</div>
			<div className="flex flex-col gap-1.5">
				<div className="space-y-1.5">
					<ToggleGroup type="single" value={cursorStyle}
						onValueChange={(v) => { if (v) onCursorStyleChange?.(v as CursorStyle); }}
						className="grid grid-cols-4 gap-2"
						aria-label={tSettings("effects.cursorStyle", "Cursor Style")}>
						{cursorStyleOptions.map((option) => (
							<ToggleGroupItem key={option.value} value={option.value}
								title={option.label} aria-label={option.label}
								className={cn(
									"group aspect-square h-auto min-w-0 rounded-[10px] border border-foreground/10 bg-foreground/[0.03] p-3 text-left text-foreground shadow-none transition-all hover:border-foreground/20 hover:bg-foreground/[0.06]",
									"data-[state=on]:border-[#2563EB]/70 data-[state=on]:bg-[#2563EB]/12 data-[state=on]:text-foreground",
								)}>
								<div className="flex h-full flex-col items-center justify-between gap-3">
									<div className="flex min-h-0 flex-1 items-center justify-center rounded-lg px-2 py-1.5">
										<CursorStylePreview style={option.value} previewUrls={cursorPreviewUrls} />
									</div>
								</div>
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
				<SliderControl label={tSettings("effects.cursorSize")} value={cursorSize}
					defaultValue={DEFAULT_CURSOR_SIZE} min={0.5} max={10} step={0.05}
					onChange={(v) => onCursorSizeChange?.(v)}
					formatValue={(v) => `${v.toFixed(2)}×`}
					parseInput={(text) => parseFloat(text.replace(/×$/, ""))} />
				<SliderControl label={tSettings("effects.cursorSmoothing")} value={cursorSmoothing}
					defaultValue={DEFAULT_CURSOR_SMOOTHING} min={0} max={2} step={0.01}
					onChange={(v) => onCursorSmoothingChange?.(v)}
					formatValue={(v) => v <= 0 ? tSettings("effects.off") : v.toFixed(2)}
					parseInput={(text) => parseFloat(text)} />
				<SliderControl label={tSettings("effects.cursorMotionBlur")} value={cursorMotionBlur}
					defaultValue={DEFAULT_CURSOR_MOTION_BLUR} min={0} max={2} step={0.05}
					onChange={(v) => onCursorMotionBlurChange?.(v)}
					formatValue={(v) => `${v.toFixed(2)}×`}
					parseInput={(text) => parseFloat(text.replace(/×$/, ""))} />
				<SliderControl label={tSettings("effects.cursorClickBounce")} value={cursorClickBounce}
					defaultValue={DEFAULT_CURSOR_CLICK_BOUNCE} min={0} max={5} step={0.05}
					onChange={(v) => onCursorClickBounceChange?.(v)}
					formatValue={(v) => `${v.toFixed(2)}×`}
					parseInput={(text) => parseFloat(text.replace(/×$/, ""))} />
				<SliderControl label={tSettings("effects.cursorClickBounceDuration", "Bounce Speed")}
					value={cursorClickBounceDuration}
					defaultValue={DEFAULT_CURSOR_CLICK_BOUNCE_DURATION}
					min={60} max={500} step={5}
					onChange={(v) => onCursorClickBounceDurationChange?.(v)}
					formatValue={(v) => `${Math.round(v)} ms`}
					parseInput={(text) => parseFloat(text.replace(/ms$/i, "").trim())} />
				<SliderControl label={tSettings("effects.cursorSway")}
					value={toCursorSwaySliderValue(cursorSway)}
					defaultValue={toCursorSwaySliderValue(DEFAULT_CURSOR_SWAY)}
					min={0} max={toCursorSwaySliderValue(2)} step={toCursorSwaySliderValue(0.05)}
					onChange={(v) => onCursorSwayChange?.(fromCursorSwaySliderValue(v))}
					formatValue={(v) => v <= 0 ? tSettings("effects.off") : `${v.toFixed(2)}×`}
					parseInput={(text) => {
						const normalized = text.trim().toLowerCase();
						if (normalized === "off") return 0;
						return parseFloat(text.replace(/×$/, ""));
					}} />
			</div>
			{extensionContent}
		</section>
	);
}
