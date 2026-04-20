import { Trash as Trash2 } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useI18n, useScopedT } from "../../../contexts/I18nContext";
import { loadEditorPreferences } from "../editorPreferences";
import { SliderControl } from "../SliderControl";
import { SectionLabel, ZOOM_DEPTH_OPTIONS } from "../settingsPanelConstants";
import type { ZoomDepth, ZoomMode } from "../types";
import { DEFAULT_ZOOM_MOTION_BLUR } from "../types";

interface ZoomSectionProps {
	selectedZoomId?: string | null;
	selectedZoomDepth?: ZoomDepth | null;
	onZoomDepthChange?: (depth: ZoomDepth) => void;
	selectedZoomMode?: ZoomMode | null;
	onZoomModeChange?: (mode: ZoomMode) => void;
	onZoomDelete?: (id: string) => void;
	zoomMotionBlur: number;
	onZoomMotionBlurChange?: (amount: number) => void;
	zoomSmoothness: number;
	onZoomSmoothnessChange?: (smoothness: number) => void;
	zoomClassicMode: boolean;
	onZoomClassicModeChange?: (enabled: boolean) => void;
	extensionContent?: ReactNode;
}

export function ZoomSection({
	selectedZoomId,
	selectedZoomDepth,
	onZoomDepthChange,
	selectedZoomMode,
	onZoomModeChange,
	onZoomDelete,
	zoomMotionBlur,
	onZoomMotionBlurChange,
	zoomSmoothness,
	onZoomSmoothnessChange,
	zoomClassicMode,
	onZoomClassicModeChange,
	extensionContent,
}: ZoomSectionProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);

	const resetZoomSection = () => {
		onZoomSmoothnessChange?.(0.5);
		onZoomMotionBlurChange?.(initialEditorPreferences.zoomMotionBlur);
		onZoomClassicModeChange?.(false);
	};

	return (
		<section className="flex flex-col gap-2">
			{selectedZoomId && (
				<>
					<div className="flex items-center justify-between gap-3">
						<SectionLabel>{tSettings("sections.zoom", "Zoom")}</SectionLabel>
						{selectedZoomDepth && (
							<span className="rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#2563EB]">
								{ZOOM_DEPTH_OPTIONS.find((o) => o.depth === selectedZoomDepth)?.label}
							</span>
						)}
					</div>
					<div className="mb-1">
						<div className="flex rounded-lg border border-foreground/10 bg-foreground/5 p-0.5">
							<button type="button" onClick={() => onZoomModeChange?.("auto")}
								className={cn(
									"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
									selectedZoomMode === "auto"
										? "bg-[#2563EB] text-white shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}>
								{tSettings("zoom.modeAuto", "Auto")}
							</button>
							<button type="button" onClick={() => onZoomModeChange?.("manual")}
								className={cn(
									"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
									selectedZoomMode === "manual"
										? "bg-[#2563EB] text-white shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}>
								{tSettings("zoom.modeManual", "Manual")}
							</button>
						</div>
						<p className="mt-1.5 text-[10px] text-muted-foreground/70">
							{selectedZoomMode === "manual"
								? tSettings("zoom.modeManualDescription", "Set a fixed focus point for this zoom")
								: tSettings("zoom.modeAutoDescription", "Camera follows cursor automatically")}
						</p>
					</div>
					<div className="grid grid-cols-6 gap-1.5">
						{ZOOM_DEPTH_OPTIONS.map((option) => {
							const isActive = selectedZoomDepth === option.depth;
							return (
								<Button key={option.depth} type="button"
									onClick={() => onZoomDepthChange?.(option.depth)}
									className={cn(
										"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
										isActive
											? "border-[#2563EB] bg-[#2563EB] text-white"
											: "border-foreground/5 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/10 hover:text-foreground",
									)}>
									<span className="text-xs font-semibold">{option.label}</span>
								</Button>
							);
						})}
					</div>
					<div className="h-px bg-foreground/[0.06] my-1" />
				</>
			)}
			<div className="flex items-center justify-between gap-3">
				<SectionLabel>{tSettings("zoom.globalSettings", "Animation")}</SectionLabel>
				<button type="button" onClick={resetZoomSection}
					className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80">
					{t("common.actions.reset", "Reset")}
				</button>
			</div>
			<div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
				<span className="text-[10px] text-muted-foreground">
					{tSettings("effects.classicZoom", "Classic Animation")}
				</span>
				<Switch checked={zoomClassicMode}
					onCheckedChange={(v) => onZoomClassicModeChange?.(v)}
					className="data-[state=checked]:bg-[#2563EB] scale-75" />
			</div>
			{!zoomClassicMode && (
				<SliderControl label={tSettings("effects.zoomSmoothness", "Zoom Smoothness")}
					value={zoomSmoothness} defaultValue={0.5}
					min={0} max={1} step={0.01}
					onChange={(v) => onZoomSmoothnessChange?.(v)}
					formatValue={(v) => (v <= 0 ? tSettings("effects.off") : v.toFixed(2))}
					parseInput={(text) => parseFloat(text)} />
			)}
			<SliderControl label={tSettings("effects.zoomMotionBlur")}
				value={zoomMotionBlur} defaultValue={DEFAULT_ZOOM_MOTION_BLUR}
				min={0} max={2} step={0.05}
				onChange={(v) => onZoomMotionBlurChange?.(v)}
				formatValue={(v) => `${v.toFixed(2)}×`}
				parseInput={(text) => parseFloat(text.replace(/×$/, ""))} />
			{selectedZoomId && (
				<Button onClick={() => { if (selectedZoomId && onZoomDelete) onZoomDelete(selectedZoomId); }}
					variant="destructive" size="sm"
					className="mt-1 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20">
					<Trash2 className="h-3 w-3" />
					{tSettings("zoom.deleteZoom")}
				</Button>
			)}
			{extensionContent}
		</section>
	);
}
