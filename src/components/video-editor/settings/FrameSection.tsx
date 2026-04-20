import { useEffect, useMemo, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { extensionHost, type FrameInstance } from "@/lib/extensions";
import { cn } from "@/lib/utils";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { useI18n, useScopedT } from "../../../contexts/I18nContext";
import { loadEditorPreferences } from "../editorPreferences";
import { SliderControl } from "../SliderControl";
import { SectionLabel } from "../settingsPanelConstants";
import type { CropRegion } from "../types";
import { DEFAULT_CROP_REGION } from "../types";

interface FrameSectionProps {
	shadowIntensity: number;
	onShadowChange?: (intensity: number) => void;
	borderRadius: number;
	onBorderRadiusChange?: (radius: number) => void;
	padding: number;
	onPaddingChange?: (padding: number) => void;
	frame: string | null;
	onFrameChange?: (frameId: string | null) => void;
	aspectRatio: AspectRatio;
	onAspectRatioChange?: (ratio: AspectRatio) => void;
	cropRegion?: CropRegion;
	onCropChange?: (region: CropRegion) => void;
}

export function FrameSection({
	shadowIntensity,
	onShadowChange,
	borderRadius,
	onBorderRadiusChange,
	padding,
	onPaddingChange,
	frame,
	onFrameChange,
	aspectRatio,
	onAspectRatioChange,
	cropRegion,
	onCropChange,
}: FrameSectionProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);

	const [availableFrames, setAvailableFrames] = useState<FrameInstance[]>([]);
	useEffect(() => {
		const update = () => setAvailableFrames(extensionHost.getFrames());
		update();
		return extensionHost.onChange(update);
	}, []);

	const removeBackgroundStateRef = useRef<{ aspectRatio: AspectRatio; padding: number } | null>(null);
	const removeBackgroundEnabled = aspectRatio === "native" && padding === 0;

	const handleRemoveBackgroundToggle = (checked: boolean) => {
		if (checked) {
			removeBackgroundStateRef.current = { aspectRatio, padding };
			onAspectRatioChange?.("native");
			onPaddingChange?.(0);
			return;
		}
		if (removeBackgroundStateRef.current) {
			onAspectRatioChange?.(removeBackgroundStateRef.current.aspectRatio);
			onPaddingChange?.(removeBackgroundStateRef.current.padding);
			removeBackgroundStateRef.current = null;
		}
	};

	const resetFrameSection = () => {
		onShadowChange?.(initialEditorPreferences.shadowIntensity);
		onBorderRadiusChange?.(initialEditorPreferences.borderRadius);
		onPaddingChange?.(initialEditorPreferences.padding);
		onFrameChange?.(null);
		onAspectRatioChange?.(initialEditorPreferences.aspectRatio);
		removeBackgroundStateRef.current = null;
	};

	const crop = cropRegion ?? { x: 0, y: 0, width: 1, height: 1 };
	const cropTop = Math.round(crop.y * 100);
	const cropLeft = Math.round(crop.x * 100);
	const cropBottom = Math.round((1 - crop.y - crop.height) * 100);
	const cropRight = Math.round((1 - crop.x - crop.width) * 100);
	const isCropped = cropTop > 0 || cropLeft > 0 || cropBottom > 0 || cropRight > 0;

	const setCropInset = (side: "top" | "bottom" | "left" | "right", pct: number) => {
		if (!onCropChange) return;
		const v = pct / 100;
		let { x, y, width, height } = crop;
		if (side === "top") {
			const nextY = Math.min(v, 1 - y - height + v);
			y = nextY;
			height = Math.max(0.05, height - (nextY - crop.y));
		}
		if (side === "left") {
			const nextX = Math.min(v, 1 - x - width + v);
			x = nextX;
			width = Math.max(0.05, width - (nextX - crop.x));
		}
		if (side === "bottom") {
			height = Math.max(0.05, 1 - crop.y - v);
		}
		if (side === "right") {
			width = Math.max(0.05, 1 - crop.x - v);
		}
		onCropChange({ x, y, width, height });
	};

	return (
		<>
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<SectionLabel>{tSettings("sections.frame", "Frame")}</SectionLabel>
					<button type="button" onClick={resetFrameSection}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80">
						{t("common.actions.reset", "Reset")}
					</button>
				</div>
				<div className="flex flex-col gap-1.5">
					<SliderControl
						label={tSettings("effects.shadow")} value={shadowIntensity}
						defaultValue={initialEditorPreferences.shadowIntensity}
						min={0} max={1} step={0.01}
						onChange={(v) => onShadowChange?.(v)}
						formatValue={(v) => `${Math.round(v * 100)}%`}
						parseInput={(text) => parseFloat(text.replace(/%$/, "")) / 100} />
					<SliderControl
						label={tSettings("effects.radius", "Radius")} value={borderRadius}
						defaultValue={initialEditorPreferences.borderRadius}
						min={0} max={50} step={0.5}
						onChange={(v) => onBorderRadiusChange?.(v)}
						formatValue={(v) => `${v}px`}
						parseInput={(text) => parseFloat(text.replace(/px$/, ""))} />
					<SliderControl
						label={tSettings("effects.padding")} value={padding}
						defaultValue={initialEditorPreferences.padding}
						min={0} max={100} step={1}
						onChange={(v) => onPaddingChange?.(v)}
						formatValue={(v) => `${v}%`}
						parseInput={(text) => parseFloat(text.replace(/%$/, ""))} />
					<div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
						<span className="text-[10px] text-muted-foreground">
							{tSettings("effects.removeBackground")}
						</span>
						<Switch checked={removeBackgroundEnabled}
							onCheckedChange={handleRemoveBackgroundToggle}
							className="data-[state=checked]:bg-[#2563EB] scale-75" />
					</div>
					{availableFrames.length > 0 && (
						<div className="flex flex-col gap-1.5 mt-1">
							<div className="flex items-center justify-between">
								<span className="text-[10px] text-muted-foreground">Frame</span>
								{frame && (
									<button type="button" onClick={() => onFrameChange?.(null)}
										className="text-[9px] text-[#2563EB] hover:opacity-80">Remove</button>
								)}
							</div>
							<div className="grid grid-cols-3 gap-1.5">
								{availableFrames.map((f) => {
									const isSelected = frame === f.id;
									return (
										<button key={f.id} type="button"
											onClick={() => onFrameChange?.(isSelected ? null : f.id)}
											className={cn(
												"flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all text-center",
												isSelected
													? "border-[#2563EB]/50 bg-[#2563EB]/10 ring-1 ring-[#2563EB]/30"
													: "border-foreground/[0.06] bg-white/[0.02] hover:bg-foreground/[0.05]",
											)}>
											<div className="w-full aspect-video rounded bg-foreground/10 overflow-hidden flex items-center justify-center">
												<img src={f.thumbnailPath} alt={f.label}
													className="w-full h-full object-contain" draggable={false} />
											</div>
											<span className="text-[8px] text-muted-foreground truncate w-full leading-tight">
												{f.label}
											</span>
										</button>
									);
								})}
							</div>
						</div>
					)}
				</div>
			</section>

			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<SectionLabel>{tSettings("sections.crop", "Crop")}</SectionLabel>
					{isCropped ? (
						<button type="button" onClick={() => onCropChange?.(DEFAULT_CROP_REGION)}
							className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80">
							{t("common.actions.reset", "Reset")}
						</button>
					) : null}
				</div>
				<div className="flex flex-col gap-1.5">
					<SliderControl label={tSettings("crop.top", "Top")} value={cropTop} defaultValue={0}
						min={0} max={50} step={1} onChange={(v) => setCropInset("top", v)}
						formatValue={(v) => `${Math.round(v)}%`}
						parseInput={(text) => parseFloat(text.replace(/%$/, ""))} />
					<SliderControl label={tSettings("crop.bottom", "Bottom")} value={cropBottom} defaultValue={0}
						min={0} max={50} step={1} onChange={(v) => setCropInset("bottom", v)}
						formatValue={(v) => `${Math.round(v)}%`}
						parseInput={(text) => parseFloat(text.replace(/%$/, ""))} />
					<SliderControl label={tSettings("crop.left", "Left")} value={cropLeft} defaultValue={0}
						min={0} max={50} step={1} onChange={(v) => setCropInset("left", v)}
						formatValue={(v) => `${Math.round(v)}%`}
						parseInput={(text) => parseFloat(text.replace(/%$/, ""))} />
					<SliderControl label={tSettings("crop.right", "Right")} value={cropRight} defaultValue={0}
						min={0} max={50} step={1} onChange={(v) => setCropInset("right", v)}
						formatValue={(v) => `${Math.round(v)}%`}
						parseInput={(text) => parseFloat(text.replace(/%$/, ""))} />
				</div>
			</section>
		</>
	);
}
