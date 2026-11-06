import { Button } from "@/components/ui/button";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { Trash as Trash2, UploadSimple as Upload, VideoCamera } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { SliderControl } from "../SliderControl";
import {
	DEFAULT_CROP_REGION,
	DEFAULT_WEBCAM_MARGIN,
	DEFAULT_WEBCAM_POSITION_PRESET,
	DEFAULT_WEBCAM_POSITION_X,
	DEFAULT_WEBCAM_POSITION_Y,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_ROUNDNESS,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	type WebcamOverlaySettings,
	type WebcamPositionPreset,
} from "../types";
import { WebcamCropControl } from "../WebcamCropControl";
import {
	getCropMatchedWebcamHeightPercent,
	getWebcamPositionForPreset,
	normalizeWebcamCropRegion,
	resolveWebcamCorner,
} from "../webcamOverlay";

interface WebcamSettingsProps {
	advanced: boolean;
	webcam?: WebcamOverlaySettings;
	webcamPreviewSrc: string | null;
	webcamPreviewCurrentTime: number;
	webcamPreviewPlaying: boolean;
	onWebcamChange?: (webcam: WebcamOverlaySettings) => void;
	onUploadWebcam?: () => void;
	onClearWebcam?: () => void;
}

const WEBCAM_POSITION_PRESETS: Array<{
	preset: Exclude<WebcamPositionPreset, "custom">;
	label: string;
}> = [
	{ preset: "top-left", label: "Top left" },
	{ preset: "top-center", label: "Top center" },
	{ preset: "top-right", label: "Top right" },
	{ preset: "center-left", label: "Center left" },
	{ preset: "center", label: "Center" },
	{ preset: "center-right", label: "Center right" },
	{ preset: "bottom-left", label: "Bottom left" },
	{ preset: "bottom-center", label: "Bottom center" },
	{ preset: "bottom-right", label: "Bottom right" },
];

export function WebcamSettings({
	advanced,
	webcam,
	webcamPreviewSrc,
	webcamPreviewCurrentTime,
	webcamPreviewPlaying,
	onWebcamChange,
	onUploadWebcam,
	onClearWebcam,
}: WebcamSettingsProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();
	const webcamFileName = webcam?.sourcePath?.split(/[\\/]/).pop() ?? null;
	const webcamPositionPreset = webcam?.positionPreset ?? DEFAULT_WEBCAM_POSITION_PRESET;
	const webcamPositionX = webcam?.positionX ?? DEFAULT_WEBCAM_POSITION_X;
	const webcamPositionY = webcam?.positionY ?? DEFAULT_WEBCAM_POSITION_Y;
	const webcamWidth = webcam?.width ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
	const webcamHeight = webcam?.height ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
	const webcamCrop = normalizeWebcamCropRegion(webcam?.cropRegion);

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

	const positionLabel =
		webcamPositionPreset === "custom"
			? tSettings("effects.webcamCustomPosition", "Custom position")
			: tSettings(
					`effects.webcamPositions.${webcamPositionPreset}`,
					WEBCAM_POSITION_PRESETS.find((option) => option.preset === webcamPositionPreset)
						?.label ?? "",
				);

	if (!webcam?.sourcePath) {
		return (
			<section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-default/40 px-5 py-6 text-center">
				<div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
					<VideoCamera className="size-5" aria-hidden="true" />
				</div>
				<p className="text-sm font-medium">
					{tSettings("effects.addWebcamVideo", "Add a webcam video")}
				</p>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{tSettings(
						"effects.webcamVideoHint",
						"Use your recorded camera or add a video to appear alongside your screen.",
					)}
				</p>
				<Button
					type="button"
					variant="outline"
					onClick={onUploadWebcam}
					disabled={!onUploadWebcam}
					className="w-full gap-2"
				>
					<Upload className="size-4" aria-hidden="true" />
					{tSettings("effects.uploadWebcamFootage")}
				</Button>
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-5" data-webcam-settings>
			<div className="rounded-xl border border-border p-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
						<VideoCamera className="size-4" aria-hidden="true" />
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-xs font-medium">
							{tSettings("effects.webcamVideo", "Webcam video")}
						</p>
						<p
							className="mt-0.5 truncate text-xs text-muted-foreground"
							title={webcamFileName ?? undefined}
						>
							{webcamFileName}
						</p>
					</div>
					<Switch
						aria-label={tSettings("effects.show", "Show")}
						checked={webcam.enabled}
						onCheckedChange={(enabled) => updateWebcam({ enabled })}
					/>
				</div>
				<div className="mt-3 flex gap-2 border-t border-border pt-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onUploadWebcam}
						disabled={!onUploadWebcam}
						className="min-w-0 flex-1 gap-1.5 px-1 text-xs"
					>
						<Upload className="size-3.5 shrink-0" aria-hidden="true" />
						{tSettings("effects.replaceWebcamFootage")}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onClearWebcam}
						disabled={!onClearWebcam}
						className="min-w-0 flex-1 gap-1.5 px-1 text-xs text-muted-foreground hover:text-danger"
					>
						<Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
						{tSettings("effects.removeWebcamFootage")}
					</Button>
				</div>
			</div>
			<div className="flex flex-col gap-3">
				{advanced && (
					<>
						<div className="flex items-center justify-between py-2">
							<span className="text-xs text-muted-foreground">
								{tSettings("effects.webcamReactToZoom")}
							</span>
							<Switch
								aria-label={tSettings("effects.webcamReactToZoom")}
								checked={webcam?.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM}
								onCheckedChange={(reactToZoom) => updateWebcam({ reactToZoom })}
							/>
						</div>
						<div className="flex items-center justify-between py-2">
							<span className="text-xs text-muted-foreground">
								{tSettings("effects.webcamMirror", "Mirror webcam")}
							</span>
							<Switch
								aria-label={tSettings("effects.webcamMirror", "Mirror webcam")}
								checked={webcam?.mirror ?? true}
								onCheckedChange={(mirror) => updateWebcam({ mirror })}
							/>
						</div>
					</>
				)}
				<div className="flex items-center gap-4 py-1">
					<div className="shrink-0">
						<ChoiceGroup
							aria-label={tSettings("effects.webcamPosition", "Position")}
							value={webcamPositionPreset}
							onValueChange={(value) =>
								applyWebcamPositionPreset(value as WebcamPositionPreset)
							}
							className="grid w-32 grid-cols-3 gap-1 rounded-xl border border-border bg-default/50 p-1.5"
						>
							{WEBCAM_POSITION_PRESETS.map((option) => (
								<ChoiceItem
									key={option.preset}
									value={option.preset}
									aria-label={tSettings(
										`effects.webcamPositions.${option.preset}`,
										option.label,
									)}
									textValue={tSettings(
										`effects.webcamPositions.${option.preset}`,
										option.label,
									)}
									className="!h-6 !min-h-0 !rounded-md !border-0 !p-0"
								>
									<span
										aria-hidden="true"
										className={`size-2 rounded-full ${webcamPositionPreset === option.preset ? "bg-accent" : "bg-foreground/25"}`}
									/>
								</ChoiceItem>
							))}
						</ChoiceGroup>
					</div>
					<div className="min-w-0">
						<p className="text-xs font-medium">
							{tSettings("effects.webcamPosition", "Position")}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">{positionLabel}</p>
						<p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
							{tSettings(
								"effects.webcamDragHint",
								"Or drag the webcam in the preview.",
							)}
						</p>
					</div>
				</div>

				{advanced ? (
					<>
						<SliderControl
							label={tSettings("effects.webcamHorizontal", "Horizontal")}
							value={webcamPositionX * 100}
							min={0}
							max={100}
							step={1}
							onChange={(v) =>
								updateWebcam({
									positionPreset: "custom",
									positionX: v / 100,
								})
							}
							formatValue={(v) => `${Math.round(v)}%`}
						/>
						<SliderControl
							label={tSettings("effects.webcamVertical", "Vertical")}
							value={webcamPositionY * 100}
							min={0}
							max={100}
							step={1}
							onChange={(v) =>
								updateWebcam({
									positionPreset: "custom",
									positionY: v / 100,
								})
							}
							formatValue={(v) => `${Math.round(v)}%`}
						/>
					</>
				) : null}
				<div className="flex flex-col gap-2">
					<ChoiceGroup
						type="single"
						aria-label={tSettings("effects.webcamShape", "Shape")}
						value={webcam?.shape ?? "squircle"}
						className="grid grid-cols-3 gap-2"
						onValueChange={(shape) => {
							if (shape === "circle" || shape === "squircle" || shape === "rectangle")
								updateWebcam({
									shape,
									...(shape === "rectangle"
										? { roundness: 0 }
										: shape === "squircle" &&
												webcam?.shape === "rectangle" &&
												webcam.roundness === 0
											? { roundness: DEFAULT_WEBCAM_ROUNDNESS }
											: {}),
								});
						}}
					>
						<ChoiceItem value="circle">
							{tSettings("effects.webcamCircle", "Circle")}
						</ChoiceItem>
						<ChoiceItem value="squircle">
							{tSettings("effects.webcamSquircle", "Squircle")}
						</ChoiceItem>
						<ChoiceItem value="rectangle">
							{tSettings("effects.webcamRectangle", "Rectangle")}
						</ChoiceItem>
					</ChoiceGroup>
				</div>
				<SliderControl
					label={tSettings("effects.webcamWidth", "Webcam Width")}
					value={webcamWidth}
					min={10}
					max={100}
					step={1}
					onChange={(v) => updateWebcam({ width: v, size: v })}
					formatValue={(v) => `${Math.round(v)}%`}
				/>
				{(advanced || webcam?.shape === "rectangle") && webcam?.shape !== "circle" && (
					<SliderControl
						label={tSettings("effects.webcamHeight", "Webcam Height")}
						value={webcamHeight}
						min={10}
						max={100}
						step={1}
						onChange={(v) => updateWebcam({ height: v })}
						formatValue={(v) => `${Math.round(v)}%`}
					/>
				)}
				{advanced && (
					<div className="py-2">
						<div className="mb-2 flex items-center justify-between gap-2">
							<div className="text-xs text-muted-foreground">
								{tSettings("effects.webcamCrop", "Crop")}
							</div>
							<Button
								className="text-xs text-muted"
								size="sm"
								variant="ghost"
								type="button"
								onClick={() => updateWebcam({ cropRegion: DEFAULT_CROP_REGION })}
							>
								{t("common.actions.reset", "Reset")}
							</Button>
						</div>
						<div className="mx-auto w-full max-w-56">
							<WebcamCropControl
								cropRegion={webcamCrop}
								mirrored={webcam?.mirror ?? true}
								previewSrc={webcamPreviewSrc}
								previewCurrentTime={webcamPreviewCurrentTime}
								previewPlaying={webcamPreviewPlaying}
								previewTimeOffsetMs={webcam?.timeOffsetMs}
								onCropChange={(cropRegion, previewFrame) =>
									updateWebcam({
										cropRegion,
										height: previewFrame
											? getCropMatchedWebcamHeightPercent(
													webcamWidth,
													webcamHeight,
													previewFrame.width,
													previewFrame.height,
													cropRegion,
												)
											: webcamHeight,
									})
								}
							/>
						</div>
					</div>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("effects.webcamMargin", "Margin")}
						value={webcam?.margin ?? DEFAULT_WEBCAM_MARGIN}
						min={0}
						max={96}
						step={1}
						onChange={(v) => updateWebcam({ margin: v })}
						formatValue={(v) => `${Math.round(v)}px`}
					/>
				)}
				{webcam?.shape !== "circle" && (
					<SliderControl
						label={tSettings("effects.webcamRoundness")}
						value={webcam?.roundness ?? DEFAULT_WEBCAM_ROUNDNESS}
						min={0}
						max={100}
						step={1}
						onChange={(v) => updateWebcam({ roundness: v })}
						formatValue={(v) => `${Math.round(v)}%`}
					/>
				)}
				{advanced && (
					<SliderControl
						label={tSettings("effects.webcamShadow")}
						value={webcam?.shadow ?? DEFAULT_WEBCAM_SHADOW}
						min={0}
						max={1}
						step={0.01}
						onChange={(v) => updateWebcam({ shadow: v })}
						formatValue={(v) => `${Math.round(v * 100)}%`}
					/>
				)}
			</div>
		</section>
	);
}
