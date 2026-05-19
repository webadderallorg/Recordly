import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TEMPORAL_MOTION_BLUR_DEFAULT_SAMPLE_COUNT,
	TEMPORAL_MOTION_BLUR_DEFAULT_SHUTTER_FRACTION,
} from "@/lib/exporter/temporalMotionBlur";
import { cn } from "@/lib/utils";
import type { EditorPreferences } from "../../editorPreferences";
import type { ZoomDepth, ZoomMode } from "../../types";
import { ZOOM_DEPTH_OPTIONS } from "../constants";
import { SettingsExtensionPanels, type SettingsPanelExtension } from "./ExtensionSettingsSection";

export function ZoomSection({
	tSettings,
	t,
	selectedZoomId,
	selectedZoomDepth,
	selectedZoomMode,
	onZoomModeChange,
	onZoomDepthChange,
	zoomClassicMode,
	onZoomClassicModeChange,
	showDevMotionControls,
	onZoomDelete,
	initialEditorPreferences,
	onZoomMotionBlurTuningChange,
	onCameraSpringStiffnessMultiplierChange,
	onCameraSpringDampingMultiplierChange,
	onCameraSpringMassMultiplierChange,
	onZoomInDurationMsChange,
	onZoomOutDurationMsChange,
	extensionPanels,
	isInitialLoading = false,
}: {
	tSettings: (key: string, fallback?: string) => string;
	t: (key: string, fallback?: string) => string;
	selectedZoomId?: string | null;
	selectedZoomDepth?: ZoomDepth | null;
	selectedZoomMode?: ZoomMode | null;
	onZoomModeChange?: (mode: ZoomMode) => void;
	onZoomDepthChange?: (depth: ZoomDepth) => void;
	zoomClassicMode: boolean;
	onZoomClassicModeChange?: (enabled: boolean) => void;
	showDevMotionControls: boolean;
	onZoomDelete?: (id: string) => void;
	initialEditorPreferences: EditorPreferences;
	onZoomMotionBlurTuningChange?: (tuning: EditorPreferences["zoomMotionBlurTuning"]) => void;
	onCameraSpringStiffnessMultiplierChange?: (multiplier: number) => void;
	onCameraSpringDampingMultiplierChange?: (multiplier: number) => void;
	onCameraSpringMassMultiplierChange?: (multiplier: number) => void;
	onZoomInDurationMsChange?: (duration: number) => void;
	onZoomOutDurationMsChange?: (duration: number) => void;
	extensionPanels: SettingsPanelExtension[];
	isInitialLoading?: boolean;
}) {
	const resetZoomSection = () => {
		onZoomMotionBlurTuningChange?.(initialEditorPreferences.zoomMotionBlurTuning);
		onCameraSpringStiffnessMultiplierChange?.(
			initialEditorPreferences.cameraSpringStiffnessMultiplier,
		);
		onCameraSpringDampingMultiplierChange?.(
			initialEditorPreferences.cameraSpringDampingMultiplier,
		);
		onCameraSpringMassMultiplierChange?.(initialEditorPreferences.cameraSpringMassMultiplier);
		onZoomInDurationMsChange?.(initialEditorPreferences.zoomInDurationMs);
		onZoomOutDurationMsChange?.(initialEditorPreferences.zoomOutDurationMs);
		onZoomClassicModeChange?.(false);
	};

	if (isInitialLoading) {
		return (
			<section className="flex flex-col gap-2 animate-in fade-in duration-200">
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-3 w-16" variant="subtle" />
					<Skeleton className="h-3 w-10" variant="subtle" />
				</div>
				<Skeleton className="h-10 w-full rounded-lg mb-1" variant="subtle" animation="shimmer-premium" />
				<div className="grid grid-cols-6 gap-1.5">
					{[...Array(6)].map((_, i) => (
						<Skeleton key={i} className="h-10 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
					))}
				</div>
				<div className="h-px bg-foreground/[0.06] my-1" />
				<Skeleton className="h-10 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
				<Skeleton className="h-16 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
				<SettingsExtensionPanels
					panels={extensionPanels}
					sections={["zoom"]}
					isInitialLoading={true}
				/>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-2 animate-in fade-in duration-300">
			{selectedZoomId && (
				<>
					<div className="flex items-center justify-between gap-3">
						<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
							{tSettings("sections.zoom", "Zoom")}
						</p>
						{selectedZoomDepth && (
							<span className="rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#2563EB]">
								{
									ZOOM_DEPTH_OPTIONS.find((o) => o.depth === selectedZoomDepth)
										?.label
								}
							</span>
						)}
					</div>
					<div className="mb-1">
						<div className="flex rounded-lg border border-foreground/10 bg-foreground/5 p-0.5">
							<button
								type="button"
								onClick={() => onZoomModeChange?.("auto")}
								className={cn(
									"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
									selectedZoomMode === "auto"
										? "bg-[#2563EB] text-white shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{tSettings("zoom.modeAuto", "Auto")}
							</button>
							<button
								type="button"
								onClick={() => onZoomModeChange?.("manual")}
								className={cn(
									"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
									selectedZoomMode === "manual"
										? "bg-[#2563EB] text-white shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{tSettings("zoom.modeManual", "Manual")}
							</button>
						</div>
					</div>
					<div className="grid grid-cols-6 gap-1.5">
						{ZOOM_DEPTH_OPTIONS.map((option) => {
							const isActive = selectedZoomDepth === option.depth;
							return (
								<Button
									key={option.depth}
									type="button"
									onClick={() => onZoomDepthChange?.(option.depth)}
									className={cn(
										"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
										isActive
											? "border-[#2563EB] bg-[#2563EB] text-white"
											: "border-foreground/5 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/10 hover:text-foreground",
									)}
								>
									<span className="text-xs font-semibold">{option.label}</span>
								</Button>
							);
						})}
					</div>
					<div className="h-px bg-foreground/[0.06] my-1" />
				</>
			)}
			<div className="flex items-center justify-between gap-3">
				<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
					{tSettings("zoom.globalSettings", "Animation")}
				</p>
				<button
					type="button"
					onClick={resetZoomSection}
					className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
				>
					{t("common.actions.reset", "Reset")}
				</button>
			</div>
			<div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
				<span className="text-[10px] text-muted-foreground">
					{tSettings("effects.classicZoom", "Classic Animation")}
				</span>
				<Switch
					checked={zoomClassicMode}
					onCheckedChange={(v) => onZoomClassicModeChange?.(v)}
					className="data-[state=checked]:bg-[#2563EB] scale-75"
				/>
			</div>
			<div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
				<div className="text-[10px] text-muted-foreground">
					{showDevMotionControls
						? tSettings(
								"effects.exportBlurMovedToDev",
								"Export blur tuning is available in Settings > Dev.",
							)
						: tSettings(
								"effects.exportBlurLocked",
								"Export blur is fixed for this build.",
							)}
				</div>
				<div className="mt-1 text-[12px] font-medium text-foreground">{`${TEMPORAL_MOTION_BLUR_DEFAULT_SAMPLE_COUNT} samples · ${Math.round(TEMPORAL_MOTION_BLUR_DEFAULT_SHUTTER_FRACTION * 100)}% shutter`}</div>
			</div>
			{selectedZoomId && (
				<Button
					onClick={() => {
						if (selectedZoomId && onZoomDelete) onZoomDelete(selectedZoomId);
					}}
					variant="destructive"
					size="sm"
					className="mt-1 h-8 w-full gap-2 border border-red-500/20 bg-red-500/10 text-xs text-red-400 transition-all hover:border-red-500/30 hover:bg-red-500/20"
				>
					{tSettings("zoom.deleteZoom")}
				</Button>
			)}
			<SettingsExtensionPanels
				panels={extensionPanels}
				sections={["zoom", "appearance", "frame", "crop"]}
			/>
		</section>
	);
}
