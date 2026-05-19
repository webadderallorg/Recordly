import { Trash as Trash2, UploadSimple as Upload } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EditorPreferences } from "../../editorPreferences";
import { SliderControl } from "../../SliderControl";
import {
	type CropRegion,
	DEFAULT_CROP_REGION,
	DEFAULT_WEBCAM_CORNER_RADIUS,
	DEFAULT_WEBCAM_MARGIN,
	DEFAULT_WEBCAM_POSITION_PRESET,
	DEFAULT_WEBCAM_POSITION_X,
	DEFAULT_WEBCAM_POSITION_Y,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	type WebcamOverlaySettings,
	type WebcamPositionPreset,
} from "../../types";
import { WebcamCropControl } from "../../WebcamCropControl";
import {
	getWebcamPositionForPreset,
	normalizeWebcamCropRegion,
	resolveWebcamCorner,
} from "../../webcamOverlay";
import { WEBCAM_POSITION_PRESETS } from "../constants";
import { SettingsExtensionPanels, type SettingsPanelExtension } from "./ExtensionSettingsSection";

export function WebcamSection({
	tSettings,
	t,
	webcam,
	webcamPreviewSrc,
	webcamPreviewCurrentTime,
	webcamPreviewPlaying,
	onWebcamChange,
	onUploadWebcam,
	onClearWebcam,
	initialEditorPreferences,
	extensionPanels,
	isInitialLoading = false,
}: {
	tSettings: (key: string, fallback?: string) => string;
	t: (key: string, fallback?: string) => string;
	webcam?: WebcamOverlaySettings;
	webcamPreviewSrc?: string | null;
	webcamPreviewCurrentTime?: number;
	webcamPreviewPlaying?: boolean;
	onWebcamChange?: (webcam: WebcamOverlaySettings) => void;
	onUploadWebcam?: () => void;
	onClearWebcam?: () => void;
	initialEditorPreferences: EditorPreferences;
	extensionPanels: SettingsPanelExtension[];
	isInitialLoading?: boolean;
}) {
	const webcamFileName = webcam?.sourcePath?.split(/[\\/]/).pop() ?? null;
	const webcamPositionPreset = webcam?.positionPreset ?? DEFAULT_WEBCAM_POSITION_PRESET;
	const webcamPositionX = webcam?.positionX ?? DEFAULT_WEBCAM_POSITION_X;
	const webcamPositionY = webcam?.positionY ?? DEFAULT_WEBCAM_POSITION_Y;
	const webcamCrop = normalizeWebcamCropRegion(webcam?.cropRegion);

	const resetWebcamSection = () => {
		onWebcamChange?.({ ...initialEditorPreferences.webcam });
	};

	const updateWebcam = (patch: Partial<WebcamOverlaySettings>) => {
		if (!webcam || !onWebcamChange) return;
		onWebcamChange({ ...webcam, ...patch });
	};

	const applyWebcamPositionPreset = (preset: WebcamPositionPreset) => {
		if (!webcam) return;

		if (preset === "custom") {
			updateWebcam({ positionPreset: "custom" });
			return;
		}

		const position = getWebcamPositionForPreset(preset);
		updateWebcam({
			positionPreset: preset,
			positionX: position.x,
			positionY: position.y,
			corner: resolveWebcamCorner(preset, webcam.corner),
		});
	};

	if (isInitialLoading) {
		return (
			<section className="flex flex-col gap-2 animate-in fade-in duration-200">
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-3 w-16" variant="subtle" />
					<Skeleton className="h-3 w-10" variant="subtle" />
				</div>
				<div className="flex flex-col gap-1.5">
					<Skeleton className="h-10 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
					<Skeleton className="h-10 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
					<Skeleton className="h-8 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
					<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-3 space-y-2">
						<Skeleton className="h-3 w-12" variant="subtle" />
						<Skeleton className="h-32 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
					</div>
					<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-3 space-y-3">
						<Skeleton className="h-3 w-14" variant="subtle" />
						<div className="grid grid-cols-3 gap-1.5">
							{[...Array(3)].map((_, i) => (
								<Skeleton key={i} className="h-8 w-full rounded-lg" variant="subtle" animation="shimmer-premium" />
							))}
						</div>
					</div>
				</div>
				<SettingsExtensionPanels
					panels={extensionPanels}
					sections={["webcam"]}
					isInitialLoading={true}
				/>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-2 animate-in fade-in duration-300">
			<div className="flex items-center justify-between gap-3">
				<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
					{tSettings("sections.webcam", "Webcam")}
				</p>
				<button
					type="button"
					onClick={resetWebcamSection}
					className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
				>
					{t("common.actions.reset", "Reset")}
				</button>
			</div>
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
					<span className="text-[10px] text-muted-foreground">
						{tSettings("effects.show", "Show")}
					</span>
					<Switch
						checked={webcam?.enabled ?? false}
						onCheckedChange={(enabled) => updateWebcam({ enabled })}
						className="data-[state=checked]:bg-[#2563EB] scale-75"
					/>
				</div>
				<div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
					<span className="text-[10px] text-muted-foreground">
						{tSettings("effects.webcamReactToZoom")}
					</span>
					<Switch
						checked={webcam?.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM}
						onCheckedChange={(reactToZoom) => updateWebcam({ reactToZoom })}
						className="data-[state=checked]:bg-[#2563EB] scale-75"
					/>
				</div>
				<SliderControl
					label={tSettings("effects.webcamSize")}
					value={webcam?.size ?? DEFAULT_WEBCAM_SIZE}
					defaultValue={DEFAULT_WEBCAM_SIZE}
					min={10}
					max={100}
					step={1}
					onChange={(v) => updateWebcam({ size: v })}
					formatValue={(v) => `${Math.round(v)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
				/>
				<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div className="mb-2 flex items-center justify-between gap-2">
						<div className="text-[10px] text-muted-foreground">
							{tSettings("effects.webcamCrop", "Crop")}
						</div>
						<button
							type="button"
							onClick={() => updateWebcam({ cropRegion: DEFAULT_CROP_REGION })}
							className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80"
						>
							{t("common.actions.reset", "Reset")}
						</button>
					</div>
					<WebcamCropControl
						cropRegion={webcamCrop}
						mirrored={webcam?.mirror ?? true}
						previewSrc={webcamPreviewSrc ?? null}
						previewCurrentTime={webcamPreviewCurrentTime ?? 0}
						previewPlaying={webcamPreviewPlaying ?? false}
						previewTimeOffsetMs={webcam?.timeOffsetMs}
						onCropChange={(cropRegion: CropRegion) => updateWebcam({ cropRegion })}
					/>
				</div>
				<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div className="mb-2 text-[10px] text-muted-foreground">
						{tSettings("effects.webcamPosition", "Position")}
					</div>
					<div className="grid grid-cols-3 gap-1.5">
						{WEBCAM_POSITION_PRESETS.map((option) => {
							const isActive = webcamPositionPreset === option.preset;
							return (
								<Button
									key={option.preset}
									type="button"
									onClick={() => applyWebcamPositionPreset(option.preset)}
									className={cn(
										"h-8 rounded-lg border px-0 text-sm font-semibold transition-all",
										isActive
											? "border-[#2563EB] bg-[#2563EB] text-white"
											: "border-foreground/10 bg-foreground/5 text-muted-foreground hover:border-foreground/20 hover:bg-foreground/10",
									)}
								>
									{option.label}
								</Button>
							);
						})}
					</div>
					<div className="mt-2 flex items-center justify-between rounded-lg bg-black/10 px-2.5 py-1.5">
						<span className="text-[10px] text-muted-foreground">
							{tSettings("effects.webcamCustomPosition", "Custom position")}
						</span>
						<Switch
							checked={webcamPositionPreset === "custom"}
							onCheckedChange={(checked) =>
								applyWebcamPositionPreset(
									checked ? "custom" : DEFAULT_WEBCAM_POSITION_PRESET,
								)
							}
							className="data-[state=checked]:bg-[#2563EB] scale-75"
						/>
					</div>
				</div>
				{webcamPositionPreset === "custom" ? (
					<>
						<SliderControl
							label={tSettings("effects.webcamHorizontal", "Horizontal")}
							value={webcamPositionX * 100}
							defaultValue={DEFAULT_WEBCAM_POSITION_X * 100}
							min={0}
							max={100}
							step={1}
							onChange={(v) =>
								updateWebcam({ positionPreset: "custom", positionX: v / 100 })
							}
							formatValue={(v) => `${Math.round(v)}%`}
							parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
						/>
						<SliderControl
							label={tSettings("effects.webcamVertical", "Vertical")}
							value={webcamPositionY * 100}
							defaultValue={DEFAULT_WEBCAM_POSITION_Y * 100}
							min={0}
							max={100}
							step={1}
							onChange={(v) =>
								updateWebcam({ positionPreset: "custom", positionY: v / 100 })
							}
							formatValue={(v) => `${Math.round(v)}%`}
							parseInput={(text) => parseFloat(text.replace(/%$/, ""))}
						/>
					</>
				) : null}
				<SliderControl
					label={tSettings("effects.webcamMargin", "Margin")}
					value={webcam?.margin ?? DEFAULT_WEBCAM_MARGIN}
					defaultValue={DEFAULT_WEBCAM_MARGIN}
					min={0}
					max={96}
					step={1}
					onChange={(v) => updateWebcam({ margin: v })}
					formatValue={(v) => `${Math.round(v)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
				/>
				<SliderControl
					label={tSettings("effects.webcamRoundness")}
					value={webcam?.cornerRadius ?? DEFAULT_WEBCAM_CORNER_RADIUS}
					defaultValue={DEFAULT_WEBCAM_CORNER_RADIUS}
					min={0}
					max={160}
					step={1}
					onChange={(v) => updateWebcam({ cornerRadius: v })}
					formatValue={(v) => `${Math.round(v)}px`}
					parseInput={(text) => parseFloat(text.replace(/px$/, ""))}
				/>
				<SliderControl
					label={tSettings("effects.webcamShadow")}
					value={webcam?.shadow ?? DEFAULT_WEBCAM_SHADOW}
					defaultValue={DEFAULT_WEBCAM_SHADOW}
					min={0}
					max={1}
					step={0.01}
					onChange={(v) => updateWebcam({ shadow: v })}
					formatValue={(v) => `${Math.round(v * 100)}%`}
					parseInput={(text) => parseFloat(text.replace(/%$/, "")) / 100}
				/>
				<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
					<div className="flex flex-col gap-2">
						<div className="min-w-0">
							<div className="text-[10px] text-muted-foreground">
								{tSettings("effects.webcamFootage")}
							</div>
							<div className="mt-0.5 break-all text-[10px] leading-4 text-muted-foreground/70">
								{webcamFileName ?? tSettings("effects.webcamFootageDescription")}
							</div>
						</div>
						<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
							<Button
								type="button"
								variant="outline"
								onClick={onUploadWebcam}
								className="h-7 min-w-0 gap-1.5 border-foreground/10 bg-foreground/5 px-2 text-[10px] text-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								<Upload className="h-3 w-3" />
								<span className="min-w-0 truncate">
									{webcam?.sourcePath
										? tSettings("effects.replaceWebcamFootage")
										: tSettings("effects.uploadWebcamFootage")}
								</span>
							</Button>
							{webcam?.sourcePath ? (
								<Button
									type="button"
									variant="outline"
									onClick={onClearWebcam}
									className="h-7 min-w-0 gap-1.5 border-foreground/10 bg-foreground/5 px-2 text-[10px] text-foreground hover:bg-foreground/10 hover:text-foreground"
								>
									<Trash2 className="h-3 w-3" />
									<span className="min-w-0 truncate">
										{tSettings("effects.removeWebcamFootage")}
									</span>
								</Button>
							) : null}
						</div>
					</div>
				</div>
				<SettingsExtensionPanels panels={extensionPanels} sections={["webcam"]} />
			</div>
		</section>
	);
}
